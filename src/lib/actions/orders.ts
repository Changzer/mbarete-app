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
  deriveLineFigures,
} from "@/lib/calculations";
import { buildPartiesSnapshot, parsePartiesSnapshot } from "@/lib/parties-snapshot";
import { nextOrderNumber, getExchangeRates } from "@/lib/queries/orders";
import { canTransition, isEditable, isDeletable } from "@/lib/order-status";
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
      // The line's own copy of everything it will ever need — identity for
      // the documents, carton inputs for quantity edits, and the currency
      // this sell price was quoted in (the cost currency at add time).
      skuSnapshot: product.sku,
      nameEnSnapshot: product.nameEn,
      nameZhSnapshot: product.nameZh,
      supplierCodeSnapshot: product.supplierCode ?? "",
      qtyPerBoxSnapshot: product.qtyPerBox,
      cartonCbmSnapshot: product.cbm,
      cartonWeightSnapshot: product.weightKg,
      sellCurrencySnapshot: product.currency,
    };
  });

  const hasMoqViolation = rows.some((r) => isBelowMoq(r.quantity, r.moqSnapshot));
  return { rows, hasMoqViolation };
}

type OrderItemRow = Awaited<ReturnType<typeof buildOrderItemRows>>["rows"][number];
type StoredItem = typeof orderItems.$inferSelect;

/**
 * An ordinary edit's line rows: existing lines KEEP their stored snapshots —
 * only quantity and sell price belong to the edit, and quantity-derived
 * figures recompute from the line's own frozen inputs, never from the live
 * catalog (that is what the deliberate Update-from-catalog is for). Lines
 * new to the order snapshot the catalog now, exactly as at creation.
 */
async function buildEditedItemRows(
  companyId: number,
  before: StoredItem[],
  items: { productId: number; quantity: number; sellPrice: number }[],
): Promise<{ rows: OrderItemRow[]; hasMoqViolation: boolean }> {
  const beforeByProduct = new Map(before.map((i) => [i.productId, i]));
  const added = items.filter((i) => !beforeByProduct.has(i.productId));
  const freshByProduct = new Map<number, OrderItemRow>();
  if (added.length > 0) {
    const { rows } = await buildOrderItemRows(companyId, added);
    for (const row of rows) freshByProduct.set(row.productId, row);
  }

  const rows = items.map(({ productId, quantity, sellPrice }) => {
    const prior = beforeByProduct.get(productId);
    if (!prior) return freshByProduct.get(productId)!;
    const derived = deriveLineFigures(
      {
        unitPrice: prior.unitPriceSnapshot,
        qtyPerBox: prior.qtyPerBoxSnapshot,
        cartonCbm: prior.cartonCbmSnapshot,
        cartonWeightKg: prior.cartonWeightSnapshot,
      },
      quantity,
    );
    return {
      productId,
      quantity,
      unitPriceSnapshot: prior.unitPriceSnapshot,
      sellPriceSnapshot: sellPrice,
      currencySnapshot: prior.currencySnapshot,
      moqSnapshot: prior.moqSnapshot,
      lineTotal: derived.lineTotal,
      // A line without carton inputs (product deleted before the backfill,
      // or registered without packing) keeps its stored figures — deriving
      // from zeros would erase logistics the quote was made with.
      lineCbm: prior.qtyPerBoxSnapshot > 0 ? derived.lineCbm : prior.lineCbm,
      lineWeightKg: prior.qtyPerBoxSnapshot > 0 ? derived.lineWeightKg : prior.lineWeightKg,
      cartonsSnapshot: prior.qtyPerBoxSnapshot > 0 ? derived.cartons : prior.cartonsSnapshot,
      skuSnapshot: prior.skuSnapshot,
      nameEnSnapshot: prior.nameEnSnapshot,
      nameZhSnapshot: prior.nameZhSnapshot,
      supplierCodeSnapshot: prior.supplierCodeSnapshot,
      qtyPerBoxSnapshot: prior.qtyPerBoxSnapshot,
      cartonCbmSnapshot: prior.cartonCbmSnapshot,
      cartonWeightSnapshot: prior.cartonWeightSnapshot,
      sellCurrencySnapshot: prior.sellCurrencySnapshot || prior.currencySnapshot,
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

  // Born confirmed — the parties freeze immediately, same as any confirm.
  const partiesSnapshot =
    data.status === "confirmed"
      ? await buildPartiesSnapshot(user.companyId, data.clientId, defaultBank?.id ?? null)
      : null;

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
        partiesSnapshot,
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

  const parsed = orderInput.extend({ version: z.number().int().min(1) }).safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;

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
  // Shipped is history: the goods left, the record holds. Cancelled edits
  // fine — saving reopens it as whatever the builder chose.
  if (!isEditable(before.status)) return { error: "frozen" };
  if (!canTransition(before.status, data.status)) return { error: "frozen" };
  const beforeItems = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id));

  // Existing lines keep their snapshots; only new lines read the catalog.
  const { rows, hasMoqViolation } = await buildEditedItemRows(
    user.companyId,
    beforeItems,
    data.items,
  );
  if (data.status === "confirmed" && hasMoqViolation) {
    return { error: "moq" };
  }

  // The parties freeze when an order becomes confirmed, and re-freeze when
  // a confirmed order deliberately changes client. Landing in draft thaws
  // it — drafts render live data, re-confirming takes a fresh copy.
  const partiesSnapshot =
    data.status === "draft"
      ? null
      : before.status !== "confirmed" || before.clientId !== data.clientId
        ? await buildPartiesSnapshot(user.companyId, data.clientId, before.bankAccountId)
        : before.partiesSnapshot;

  const conflicted = await db.transaction(async (tx) => {
    const won = await tx
      .update(orders)
      .set({
        updatedBy: userId,
        clientId: data.clientId,
        status: data.status,
        displayCurrency: data.displayCurrency,
        secondaryCurrency: data.secondaryCurrency,
        commissionPct: data.commissionPct,
        // ratesSnapshot deliberately untouched: the quote's rates froze
        // when it was created, and an edit must not move its conversions.
        partiesSnapshot,
        notes: data.notes,
        version: data.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(orders.companyId, user.companyId),
          eq(orders.id, id),
          // Optimistic concurrency: this edit was built on the version the
          // builder loaded. If the order moved since, nothing is written.
          eq(orders.version, data.version),
        ),
      )
      .returning({ id: orders.id });
    if (won.length === 0) return true;

    await tx.delete(orderItems).where(eq(orderItems.orderId, id));
    for (const row of rows) {
      await tx.insert(orderItems).values({ companyId: user.companyId, orderId: id, ...row });
    }
    return false;
  });
  if (conflicted) return { error: "conflict" };

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
  expectedVersion?: number,
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

  if (!canTransition(current.status, status)) return { error: "frozen" };

  if (status === "confirmed") {
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id));
    const hasMoqViolation = items.some((i) => isBelowMoq(i.quantity, i.moqSnapshot));
    if (hasMoqViolation) return { error: "moq" };
  }

  // Confirming freezes the parties; landing back in draft thaws them.
  // Ship and cancel carry the confirmed copy forward untouched.
  const partiesSnapshot =
    status === "confirmed"
      ? await buildPartiesSnapshot(user.companyId, current.clientId, current.bankAccountId)
      : status === "draft"
        ? null
        : current.partiesSnapshot;

  const won = await db
    .update(orders)
    .set({
      status,
      partiesSnapshot,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(orders.companyId, user.companyId),
        eq(orders.id, id),
        // The page the button lived on saw this version; a transition that
        // raced another mutation refuses instead of compounding it. Callers
        // not yet passing a version keep the previous last-write behavior.
        eq(orders.version, expectedVersion ?? current.version),
      ),
    )
    .returning({ id: orders.id });
  if (won.length === 0) return { error: "conflict" };

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
  // A shipped order's proforma is a record of where the money was asked to
  // go — its payment details do not change after the fact.
  if (!isEditable(current.status)) return;
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

  // A confirmed order's frozen parties follow this deliberate, logged
  // choice: the bank block updates to the newly selected account as it
  // stands now, everything else in the freeze stays put.
  let partiesSnapshot = current.partiesSnapshot;
  const parsed = parsePartiesSnapshot(current.partiesSnapshot);
  if (parsed) {
    const { bankName, accountName, accountNumber, swift, bankAddress } = target;
    parsed.bank = { bankName, accountName, accountNumber, swift, bankAddress };
    partiesSnapshot = JSON.stringify(parsed);
  }

  const won = await db.update(orders)
    .set({
      bankAccountId,
      partiesSnapshot,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(orders.companyId, user.companyId),
        eq(orders.id, orderId),
        // Optimistic concurrency, same as updateOrder: the snapshot spliced
        // above came from the row as read. If the order moved since, writing
        // it would silently undo the concurrent edit's freeze — so nothing
        // is written and no event is logged.
        eq(orders.version, current.version),
      ),
    )
    .returning({ id: orders.id });
  if (won.length === 0) return;

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
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(and(eq(orders.companyId, admin.companyId), eq(orders.id, id)))
    .limit(1)
    .then(one);
  if (!existing) return;
  // Confirmed and shipped orders are business records: cancel first, then
  // delete — never straight from live to gone.
  if (!isDeletable(existing.status)) return;

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
      // The catalog's half of the line refreshes whole: identity and carton
      // inputs come along with the figures. The DEAL's half — quantity,
      // sell price, sell currency — is never touched here.
      skuSnapshot: product.sku,
      nameEnSnapshot: product.nameEn,
      nameZhSnapshot: product.nameZh,
      supplierCodeSnapshot: product.supplierCode ?? "",
      qtyPerBoxSnapshot: product.qtyPerBox,
      cartonCbmSnapshot: product.cbm,
      cartonWeightSnapshot: product.weightKg,
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

    // A renamed or re-SKU'd product is also the catalog's half: the refresh
    // carries it onto the line (the coded diffs below stay money/logistics —
    // the refresh event itself is the log entry for identity).
    const identityChanged =
      fresh.skuSnapshot !== item.skuSnapshot ||
      fresh.nameEnSnapshot !== item.nameEnSnapshot ||
      fresh.nameZhSnapshot !== item.nameZhSnapshot ||
      fresh.supplierCodeSnapshot !== item.supplierCodeSnapshot ||
      fresh.qtyPerBoxSnapshot !== item.qtyPerBoxSnapshot ||
      !near(fresh.cartonCbmSnapshot, item.cartonCbmSnapshot) ||
      !near(fresh.cartonWeightSnapshot, item.cartonWeightSnapshot);

    if (diff.cost || diff.moq || diff.cbm || diff.weightKg || diff.cartons || identityChanged) {
      updates.push({ itemId: item.id, fresh, diff });
    }
  }
  return { order, updates };
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
  for (const { diff } of result.updates) {
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

  // One transaction, entered by winning the version race: the refresh was
  // computed against the order as read above, so an edit landing in between
  // makes this computation stale — that's a conflict, never a half-applied
  // mix of old and new lines. Winning also moves the version, so a stale
  // editor's later save conflicts in turn instead of overwriting the refresh.
  const conflicted = await db.transaction(async (tx) => {
    const won = await tx
      .update(orders)
      .set({ version: result.order.version + 1, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(orders.companyId, user.companyId),
          eq(orders.id, orderId),
          eq(orders.version, result.order.version),
        ),
      )
      .returning({ id: orders.id });
    if (won.length === 0) return true;
    for (const { itemId, fresh } of result.updates) {
      await tx.update(orderItems).set(fresh).where(eq(orderItems.id, itemId));
    }
    return false;
  });
  if (conflicted) return { error: "conflict" };
  await logOrderEvent(orderId, user.id, "refreshed", { changes });

  revalidatePath("/[locale]/orders/[id]", "page");
  revalidatePath("/[locale]/orders/[id]/proforma", "page");
  revalidatePath("/orders");
  return { updated: result.updates.length };
}
