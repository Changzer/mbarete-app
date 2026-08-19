"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { db } from "@/db";
import { orders, orderItems, products, orderDocuments, bankAccounts } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import {
  isBelowMoq,
  lineCbm,
  lineWeightKg,
  lineTotal,
  fullCartons,
} from "@/lib/calculations";
import { nextOrderNumber, getExchangeRates } from "@/lib/queries/orders";
import { deleteUpload } from "@/lib/uploads";
import { logOrderEvent, diffOrderEdit } from "@/lib/order-log";
import { contacts } from "@/db/schema";

const orderItemInput = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  /** the invoiced price per unit, chosen on the order line */
  sellPrice: z.number().positive(),
});

const orderInput = z.object({
  clientId: z.number().int().positive(),
  displayCurrency: z.string().min(1),
  secondaryCurrency: z.string().min(1),
  commissionPct: z.number().min(0),
  notes: z.string().default(""),
  status: z.enum(["draft", "confirmed"]),
  items: z.array(orderItemInput).min(1),
});

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");
  return session;
}

async function buildOrderItemRows(
  items: { productId: number; quantity: number; sellPrice: number }[],
) {
  const productIds = items.map((i) => i.productId);
  const productRows = await db
    .select()
    .from(products)
    .where(inArray(products.id, productIds))
    .all();
  const productMap = new Map(productRows.map((p) => [p.id, p]));

  const rows = items.map(({ productId, quantity, sellPrice }) => {
    const product = productMap.get(productId);
    if (!product) throw new Error(`product ${productId} not found`);
    return {
      productId,
      quantity,
      unitPriceSnapshot: product.price,
      sellPriceSnapshot: sellPrice,
      currencySnapshot: product.currency,
      moqSnapshot: product.moq,
      lineTotal: lineTotal(product, quantity),
      lineCbm: lineCbm(product, quantity),
      lineWeightKg: lineWeightKg(product, quantity),
      cartonsSnapshot: fullCartons(product, quantity),
    };
  });

  const hasMoqViolation = rows.some((r) => isBelowMoq(r.quantity, r.moqSnapshot));
  return { rows, hasMoqViolation };
}

export type OrderActionResult = { error?: string };

export async function createOrder(input: unknown): Promise<OrderActionResult> {
  await requireSession();
  const session = await auth();

  const parsed = orderInput.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;

  const { rows, hasMoqViolation } = await buildOrderItemRows(data.items);
  if (data.status === "confirmed" && hasMoqViolation) {
    return { error: "moq" };
  }

  // Freeze the rates used, so a saved quote does not move when rates change.
  const ratesSnapshot = JSON.stringify(await getExchangeRates());

  const orderId = db.transaction((tx) => {
    const inserted = tx
      .insert(orders)
      .values({
        orderNumber: nextOrderNumber(),
        clientId: data.clientId,
        status: data.status,
        displayCurrency: data.displayCurrency,
        secondaryCurrency: data.secondaryCurrency,
        commissionPct: data.commissionPct,
        ratesSnapshot,
        notes: data.notes,
        createdBy: Number(session!.user!.id),
        updatedBy: Number(session!.user!.id),
        updatedAt: new Date().toISOString(),
      })
      .run();
    const newOrderId = Number(inserted.lastInsertRowid);

    for (const row of rows) {
      tx.insert(orderItems)
        .values({ orderId: newOrderId, ...row })
        .run();
    }
    return newOrderId;
  });

  logOrderEvent(orderId, Number(session!.user!.id), "created", {});

  revalidatePath("/orders");
  return redirect({ href: `/orders/${orderId}`, locale: (await getLocale()) as Locale });
}

export async function updateOrder(
  id: number,
  input: unknown,
): Promise<OrderActionResult> {
  await requireSession();

  const parsed = orderInput.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;

  const { rows, hasMoqViolation } = await buildOrderItemRows(data.items);
  if (data.status === "confirmed" && hasMoqViolation) {
    return { error: "moq" };
  }

  const ratesSnapshot = JSON.stringify(await getExchangeRates());

  const session = await auth();
  const userId = Number(session!.user!.id);

  // The state being replaced, captured for the changelog before it is gone.
  const before = db.select().from(orders).where(eq(orders.id, id)).get();
  const beforeItems = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id))
    .all();

  db.transaction((tx) => {
    tx.update(orders)
      .set({
        updatedBy: userId,
        clientId: data.clientId,
        status: data.status,
        displayCurrency: data.displayCurrency,
        secondaryCurrency: data.secondaryCurrency,
        commissionPct: data.commissionPct,
        ratesSnapshot,
        notes: data.notes,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(orders.id, id))
      .run();

    tx.delete(orderItems).where(eq(orderItems.orderId, id)).run();
    for (const row of rows) {
      tx.insert(orderItems)
        .values({ orderId: id, ...row })
        .run();
    }
  });

  if (before) {
    const productIds = [
      ...new Set([...beforeItems.map((i) => i.productId), ...rows.map((r) => r.productId)]),
    ];
    const productRows = productIds.length
      ? await db.select().from(products).where(inArray(products.id, productIds)).all()
      : [];
    const skuById = new Map(productRows.map((p) => [p.id, p.sku]));
    const clientIds = [...new Set([before.clientId, data.clientId])];
    const clientRows = await db
      .select()
      .from(contacts)
      .where(inArray(contacts.id, clientIds))
      .all();
    const clientById = new Map(clientRows.map((c) => [c.id, c.companyName]));

    const changes = diffOrderEdit(
      before,
      beforeItems.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        // What was effectively charged: pre-sell-price rows store 0.
        sellPrice: i.sellPriceSnapshot > 0 ? i.sellPriceSnapshot : i.unitPriceSnapshot,
      })),
      data,
      rows.map((r) => ({
        productId: r.productId,
        quantity: r.quantity,
        sellPrice: r.sellPriceSnapshot,
      })),
      (pid) => skuById.get(pid) ?? `#${pid}`,
      (cid) => clientById.get(cid) ?? `#${cid}`,
    );
    // An edit that changed nothing is not history worth keeping.
    if (changes.length > 0) {
      logOrderEvent(id, userId, "edited", { changes });
    }
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${id}`);
  return redirect({ href: `/orders/${id}`, locale: (await getLocale()) as Locale });
}

export async function setOrderStatus(
  id: number,
  status: "draft" | "confirmed" | "shipped" | "cancelled",
): Promise<OrderActionResult> {
  await requireSession();

  if (status === "confirmed") {
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id))
      .all();
    const hasMoqViolation = items.some((i) => isBelowMoq(i.quantity, i.moqSnapshot));
    if (hasMoqViolation) return { error: "moq" };
  }

  const current = db.select().from(orders).where(eq(orders.id, id)).get();
  if (!current) return { error: "not-found" };

  db.update(orders)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(orders.id, id))
    .run();

  if (current.status !== status) {
    const session = await auth();
    logOrderEvent(id, Number(session?.user?.id ?? 0) || null, "status", {
      from: current.status,
      to: status,
    });
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${id}`);
  return {};
}

/**
 * Which bank account the order's proforma prints. Logged like any other
 * edit: the client is told where to pay, so switching accounts is a change
 * worth remembering.
 */
export async function setOrderBankAccount(orderId: number, bankAccountId: number) {
  await requireSession();

  const current = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!current) return;
  const target = db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.id, bankAccountId))
    .get();
  if (!target || current.bankAccountId === bankAccountId) return;

  const before = current.bankAccountId
    ? db.select().from(bankAccounts).where(eq(bankAccounts.id, current.bankAccountId)).get()
    : undefined;

  db.update(orders)
    .set({ bankAccountId, updatedAt: new Date().toISOString() })
    .where(eq(orders.id, orderId))
    .run();

  const session = await auth();
  logOrderEvent(orderId, Number(session?.user?.id ?? 0) || null, "edited", {
    changes: [{ code: "bank", from: before?.label ?? "—", to: target.label }],
  });

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/proforma`);
}

export async function deleteOrder(id: number) {
  await requireSession();

  // Document rows cascade with the order; the files would stay behind in the
  // uploads volume forever if they were not removed here.
  const documents = await db
    .select()
    .from(orderDocuments)
    .where(eq(orderDocuments.orderId, id))
    .all();

  db.delete(orders).where(eq(orders.id, id)).run();
  for (const doc of documents) {
    await deleteUpload(doc.path);
  }

  revalidatePath("/orders");
  redirect({ href: "/orders", locale: (await getLocale()) as Locale });
}
