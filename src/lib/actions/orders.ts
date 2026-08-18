"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { db } from "@/db";
import { orders, orderItems, products } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isBelowMoq, lineCbm, lineWeightKg, lineTotal } from "@/lib/calculations";
import { nextOrderNumber, getExchangeRates } from "@/lib/queries/orders";

const orderItemInput = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive(),
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

async function buildOrderItemRows(items: { productId: number; quantity: number }[]) {
  const productIds = items.map((i) => i.productId);
  const productRows = await db
    .select()
    .from(products)
    .where(inArray(products.id, productIds))
    .all();
  const productMap = new Map(productRows.map((p) => [p.id, p]));

  const rows = items.map(({ productId, quantity }) => {
    const product = productMap.get(productId);
    if (!product) throw new Error(`product ${productId} not found`);
    return {
      productId,
      quantity,
      unitPriceSnapshot: product.price,
      currencySnapshot: product.currency,
      moqSnapshot: product.moq,
      lineTotal: lineTotal(product, quantity),
      lineCbm: lineCbm(product, quantity),
      lineWeightKg: lineWeightKg(product, quantity),
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

  db.transaction((tx) => {
    tx.update(orders)
      .set({
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

  db.update(orders)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(orders.id, id))
    .run();

  revalidatePath("/orders");
  revalidatePath(`/orders/${id}`);
  return {};
}

export async function deleteOrder(id: number) {
  await requireSession();
  db.delete(orders).where(eq(orders.id, id)).run();
  revalidatePath("/orders");
  redirect({ href: "/orders", locale: (await getLocale()) as Locale });
}
