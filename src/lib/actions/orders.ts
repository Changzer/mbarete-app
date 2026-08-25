"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { db, one } from "@/db";
import {
  orders,
  orderItems,
  products,
  orderDocuments,
  orderPayments,
  orderExpenses,
  bankAccounts,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireUser, requireAdmin, requireModuleAction } from "@/lib/authz";
import {
  isBelowMoq,
  lineCbm,
  lineWeightKg,
  lineTotal,
  fullCartons,
} from "@/lib/calculations";
import { nextOrderNumber, getExchangeRates } from "@/lib/queries/orders";
import { deleteUpload } from "@/lib/uploads";
import { logOrderEvent, diffOrderEdit, type OrderChange } from "@/lib/order-log";
import { defaultBankAccount } from "@/lib/proforma-bank";
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
  const user = await requireUser();
  // The whole file is the orders module; a company without it gets refusals,
  // not writes, whatever the UI claimed.
  await requireModuleAction(user, "orders");
  return user;
}

async function buildOrderItemRows(
  companyId: number,
  items: { productId: number; quantity: number; sellPrice: number }[],
) {
  const productIds = items.map((i) => i.productId);
  const productRows = await db
    .select()
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, productIds)));
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
  const user = await requireSession();

  const parsed = orderInput.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;

  // The client must be this company's contact — a form can post any id.
  const client = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.companyId, user.companyId), eq(contacts.id, data.clientId)))
    .limit(1)
    .then(one);
  if (!client) return { error: "invalid" };

  const { rows, hasMoqViolation } = await buildOrderItemRows(user.companyId, data.items);
  if (data.status === "confirmed" && hasMoqViolation) {
    return { error: "moq" };
  }

  // Freeze the rates used, so a saved quote does not move when rates change.
  const ratesSnapshot = JSON.stringify(await getExchangeRates(user.companyId));
  // Freeze the bank too: the proforma must keep printing the same account
  // even if Settings later changes which one is the default.
  const companyBanks = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.companyId, user.companyId));
  const defaultBank = defaultBankAccount(companyBanks);

  const orderId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(orders)
      .values({
        companyId: user.companyId,
        orderNumber: nextOrderNumber(),
        clientId: data.clientId,
        status: data.status,
        displayCurrency: data.displayCurrency,
        secondaryCurrency: data.secondaryCurrency,
        commissionPct: data.commissionPct,
        ratesSnapshot,
        bankAccountId: defaultBank?.id ?? null,
        notes: data.notes,
        createdBy: user.id,
        updatedBy: user.id,
        updatedAt: new Date().toISOString(),
      })
      .returning({ id: orders.id });

    for (const row of rows) {
      await tx.insert(orderItems).values({ companyId: user.companyId, orderId: inserted.id, ...row });
    }
    return inserted.id;
  });

  await logOrderEvent(orderId, user.id, "created", {});

  revalidatePath("/orders");
  return redirect({ href: `/orders/${orderId}`, locale: (await getLocale()) as Locale });
}

export async function updateOrder(
  id: number,
  input: unknown,
): Promise<OrderActionResult> {
  const user = await requireSession();
  const userId = user.id;

  const parsed = orderInput.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;

  const { rows, hasMoqViolation } = await buildOrderItemRows(user.companyId, data.items);
  if (data.status === "confirmed" && hasMoqViolation) {
    return { error: "moq" };
  }

  const ratesSnapshot = JSON.stringify(await getExchangeRates(user.companyId));

  // The client must be this company's contact — a form can post any id, and
  // the composite FK would otherwise reject the write with a raw 500.
  const client = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.companyId, user.companyId), eq(contacts.id, data.clientId)))
    .limit(1)
    .then(one);
  if (!client) return { error: "invalid" };

  // The state being replaced, captured for the changelog before it is gone.
  // Scoped: this is also what stops an id from another company being edited.
  const before = await db
    .select()
    .from(orders)
    .where(and(eq(orders.companyId, user.companyId), eq(orders.id, id)))
    .limit(1)
    .then(one);
  if (!before) return { error: "not-found" };
  const beforeItems = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id));

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
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
      .where(and(eq(orders.companyId, user.companyId), eq(orders.id, id)));

    await tx.delete(orderItems).where(eq(orderItems.orderId, id));
    for (const row of rows) {
      await tx.insert(orderItems).values({ companyId: user.companyId, orderId: id, ...row });
    }
  });

  {
    const productIds = [
      ...new Set([...beforeItems.map((i) => i.productId), ...rows.map((r) => r.productId)]),
    ];
    const productRows = productIds.length
      ? await db.select().from(products).where(inArray(products.id, productIds))
      : [];
    const skuById = new Map(productRows.map((p) => [p.id, p.sku]));
    const clientIds = [...new Set([before.clientId, data.clientId])];
    const clientRows = await db
      .select()
      .from(contacts)
      .where(inArray(contacts.id, clientIds));
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
      await logOrderEvent(id, userId, "edited", { changes });
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
  const user = await requireSession();

  // The order must be this company's before anything is read off it or written
  // to it — a serial id from another tenant must never be found here.
  const current = await db
    .select()
    .from(orders)
    .where(and(eq(orders.companyId, user.companyId), eq(orders.id, id)))
    .limit(1)
    .then(one);
  if (!current) return { error: "not-found" };

  if (status === "confirmed") {
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id));
    const hasMoqViolation = items.some((i) => isBelowMoq(i.quantity, i.moqSnapshot));
    if (hasMoqViolation) return { error: "moq" };
  }

  await db
    .update(orders)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(and(eq(orders.companyId, user.companyId), eq(orders.id, id)));

  if (current.status !== status) {
    await logOrderEvent(id, user.id, "status", {
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
  const user = await requireSession();

  const current = await db
    .select()
    .from(orders)
    .where(and(eq(orders.companyId, user.companyId), eq(orders.id, orderId)))
    .limit(1)
    .then(one);
  if (!current) return;
  const target = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, user.companyId), eq(bankAccounts.id, bankAccountId)))
    .limit(1)
    .then(one);
  if (!target || current.bankAccountId === bankAccountId) return;

  const before = current.bankAccountId
    ? await db
        .select()
        .from(bankAccounts)
        .where(eq(bankAccounts.id, current.bankAccountId))
        .limit(1)
        .then(one)
    : undefined;

  await db.update(orders)
    .set({ bankAccountId, updatedAt: new Date().toISOString() })
    .where(eq(orders.id, orderId));

  await logOrderEvent(orderId, user.id, "edited", {
    changes: [{ code: "bank", from: before?.label ?? "—", to: target.label }],
  });

  // Pattern form — the real routes are locale-prefixed, so literal
  // locale-less paths would name pages that do not exist.
  revalidatePath("/[locale]/orders/[id]", "page");
  revalidatePath("/[locale]/orders/[id]/proforma", "page");
}

export async function deleteOrder(id: number) {
  const admin = await requireAdmin();
  await requireModuleAction(admin, "orders");

  const existing = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.companyId, admin.companyId), eq(orders.id, id)))
    .limit(1)
    .then(one);
  if (!existing) return;

  // Document and receipt rows cascade with the order; the files would stay
  // behind in the uploads volume forever if they were not removed here.
  const [documents, payments, expenses] = await Promise.all([
    db.select().from(orderDocuments).where(eq(orderDocuments.orderId, id)),
    db.select().from(orderPayments).where(eq(orderPayments.orderId, id)),
    db.select().from(orderExpenses).where(eq(orderExpenses.orderId, id)),
  ]);

  await db.delete(orders).where(and(eq(orders.companyId, admin.companyId), eq(orders.id, id)));
  for (const doc of documents) {
    await deleteUpload(doc.path);
  }
  for (const row of [...payments, ...expenses]) {
    if (row.receiptPath) await deleteUpload(row.receiptPath);
  }

  revalidatePath("/orders");
  redirect({ href: "/orders", locale: (await getLocale()) as Locale });
}

/**
 * Update-from-catalog: the deliberate counterpart to line snapshots.
 *
 * Lines freeze the product at add time so a confirmed, paid quote can never
 * drift when the catalog moves — but a product registered incomplete (no
 * carton data yet) used to force delete-and-re-add once the supplier filled
 * it in. This pulls the CATALOG'S half of a line up to date — unit cost,
 * currency, MOQ, carton count, CBM, weight — and never touches the DEAL'S
 * half: the quantity and the sell price quoted to the client stay exactly
 * as agreed. Preview first, apply on confirmation, every change logged.
 */

export type LineRefreshDiff = {
  sku: string;
  name: string;
  cost?: { from: number; to: number; fromCurrency: string; toCurrency: string };
  moq?: { from: number; to: number };
  cbm?: { from: number; to: number };
  weightKg?: { from: number; to: number };
  cartons?: { from: number; to: number };
};

const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;

async function computeCatalogRefresh(companyId: number, orderId: number) {
  const order = await db
    .select()
    .from(orders)
    .where(and(eq(orders.companyId, companyId), eq(orders.id, orderId)))
    .limit(1)
    .then(one);
  if (!order) return { error: "invalid" as const };
  // Shipped and cancelled orders are records of what happened; they hold.
  if (order.status !== "draft" && order.status !== "confirmed") {
    return { error: "frozen" as const };
  }

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const productRows = await db
    .select()
    .from(products)
    .where(
      and(eq(products.companyId, companyId), inArray(products.id, items.map((i) => i.productId))),
    );
  const productMap = new Map(productRows.map((p) => [p.id, p]));

  const updates: { itemId: number; fresh: Record<string, number | string>; diff: LineRefreshDiff }[] = [];
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) continue; // a deleted product has nothing fresh to offer

    const fresh = {
      unitPriceSnapshot: product.price,
      currencySnapshot: product.currency,
      moqSnapshot: product.moq,
      lineTotal: lineTotal(product, item.quantity),
      lineCbm: lineCbm(product, item.quantity),
      lineWeightKg: lineWeightKg(product, item.quantity),
      cartonsSnapshot: fullCartons(product, item.quantity),
    };

    const diff: LineRefreshDiff = { sku: product.sku, name: product.nameEn || product.nameZh };
    if (!near(item.unitPriceSnapshot, fresh.unitPriceSnapshot) || item.currencySnapshot !== fresh.currencySnapshot) {
      diff.cost = {
        from: item.unitPriceSnapshot,
        to: fresh.unitPriceSnapshot,
        fromCurrency: item.currencySnapshot,
        toCurrency: fresh.currencySnapshot,
      };
    }
    if (item.moqSnapshot !== fresh.moqSnapshot) diff.moq = { from: item.moqSnapshot, to: fresh.moqSnapshot };
    if (!near(item.lineCbm, fresh.lineCbm)) diff.cbm = { from: item.lineCbm, to: fresh.lineCbm };
    if (!near(item.lineWeightKg, fresh.lineWeightKg)) {
      diff.weightKg = { from: item.lineWeightKg, to: fresh.lineWeightKg };
    }
    if (item.cartonsSnapshot !== fresh.cartonsSnapshot) {
      diff.cartons = { from: item.cartonsSnapshot, to: fresh.cartonsSnapshot };
    }

    if (diff.cost || diff.moq || diff.cbm || diff.weightKg || diff.cartons) {
      updates.push({ itemId: item.id, fresh, diff });
    }
  }
  return { updates };
}

/** What an update would change, line by line — nothing is written. */
export async function previewCatalogRefresh(
  orderId: number,
): Promise<{ error?: string; diffs?: LineRefreshDiff[] }> {
  const user = await requireSession();
  const result = await computeCatalogRefresh(user.companyId, orderId);
  if ("error" in result) return { error: result.error };
  return { diffs: result.updates.map((u) => u.diff) };
}

/** Applies the refresh. Recomputed here — a stale preview never gets written. */
export async function applyCatalogRefresh(
  orderId: number,
): Promise<{ error?: string; updated?: number }> {
  const user = await requireSession();
  const result = await computeCatalogRefresh(user.companyId, orderId);
  if ("error" in result) return { error: result.error };
  if (result.updates.length === 0) return { updated: 0 };

  const changes: OrderChange[] = [];
  for (const { itemId, fresh, diff } of result.updates) {
    await db.update(orderItems).set(fresh).where(eq(orderItems.id, itemId));
    if (diff.cost) {
      changes.push({
        code: "line_cost",
        sku: diff.sku,
        from: `${diff.cost.from.toFixed(2)} ${diff.cost.fromCurrency}`,
        to: `${diff.cost.to.toFixed(2)} ${diff.cost.toCurrency}`,
      });
    }
    if (diff.cbm || diff.weightKg || diff.cartons) {
      changes.push({
        code: "line_specs",
        sku: diff.sku,
        cbmFrom: diff.cbm?.from ?? null,
        cbmTo: diff.cbm?.to ?? null,
        kgFrom: diff.weightKg?.from ?? null,
        kgTo: diff.weightKg?.to ?? null,
      });
    }
    if (diff.moq) changes.push({ code: "line_moq", sku: diff.sku, from: diff.moq.from, to: diff.moq.to });
  }

  await db.update(orders).set({ updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));
  await logOrderEvent(orderId, user.id, "refreshed", { changes });

  revalidatePath("/[locale]/orders/[id]", "page");
  revalidatePath("/[locale]/orders/[id]/proforma", "page");
  revalidatePath("/orders");
  return { updated: result.updates.length };
}
