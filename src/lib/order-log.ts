import { db, one } from "@/db";
import { orderEvents, orders } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * The order changelog's write side.
 *
 * Events carry structured payloads; the changelog renders them in the
 * reader's language. Values that name things (clients, SKUs) are captured
 * here as display strings, because the log must keep saying what happened
 * even after the thing it points at is renamed or gone.
 */

export type OrderEventKind =
  | "created"
  | "edited"
  | "status"
  | "payment_added"
  | "payment_removed"
  | "expense_added"
  | "expense_removed"
  | "document_added"
  | "document_removed";

/** One field-level difference inside an "edited" event. */
export type OrderChange =
  | { code: "client"; from: string; to: string }
  | { code: "commission"; from: number; to: number }
  | { code: "currency"; from: string; to: string }
  | { code: "notes" }
  | { code: "bank"; from: string; to: string }
  | { code: "line_added"; sku: string; qty: number }
  | { code: "line_removed"; sku: string }
  | { code: "line_qty"; sku: string; from: number; to: number }
  | { code: "line_price"; sku: string; from: number; to: number };

export async function logOrderEvent(
  orderId: number,
  userId: number | null,
  kind: OrderEventKind,
  payload: unknown = {},
) {
  // The event carries the order's company so it lives behind the same wall as
  // the order. Derived here rather than threaded through fifteen call sites;
  // an event for a vanished order is simply not written.
  const order = await db
    .select({ companyId: orders.companyId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
    .then(one);
  if (!order) return;
  await db
    .insert(orderEvents)
    .values({ companyId: order.companyId, orderId, userId, kind, payload: JSON.stringify(payload) });
}

type OrderShape = {
  clientId: number;
  commissionPct: number;
  displayCurrency: string;
  notes: string;
};

type LineShape = {
  productId: number;
  quantity: number;
  sellPrice: number;
};

/**
 * What actually changed in an edit, as structured entries.
 *
 * Pure so it can be tested without a database. Lines are matched by product;
 * `skuOf` and `clientNameOf` turn ids into the display strings the log keeps.
 */
export function diffOrderEdit(
  before: OrderShape,
  beforeLines: LineShape[],
  after: OrderShape,
  afterLines: LineShape[],
  skuOf: (productId: number) => string,
  clientNameOf: (clientId: number) => string,
): OrderChange[] {
  const changes: OrderChange[] = [];

  if (before.clientId !== after.clientId) {
    changes.push({
      code: "client",
      from: clientNameOf(before.clientId),
      to: clientNameOf(after.clientId),
    });
  }
  if (before.commissionPct !== after.commissionPct) {
    changes.push({ code: "commission", from: before.commissionPct, to: after.commissionPct });
  }
  if (before.displayCurrency !== after.displayCurrency) {
    changes.push({ code: "currency", from: before.displayCurrency, to: after.displayCurrency });
  }
  if (before.notes !== after.notes) {
    changes.push({ code: "notes" });
  }

  const beforeByProduct = new Map(beforeLines.map((l) => [l.productId, l]));
  const afterByProduct = new Map(afterLines.map((l) => [l.productId, l]));

  for (const line of afterLines) {
    const was = beforeByProduct.get(line.productId);
    if (!was) {
      changes.push({ code: "line_added", sku: skuOf(line.productId), qty: line.quantity });
      continue;
    }
    if (was.quantity !== line.quantity) {
      changes.push({
        code: "line_qty",
        sku: skuOf(line.productId),
        from: was.quantity,
        to: line.quantity,
      });
    }
    // Pre-sell-price rows store 0, which reads as "at the supplier price";
    // compare what was effectively charged, not the raw stored zero.
    if (was.sellPrice !== line.sellPrice) {
      changes.push({
        code: "line_price",
        sku: skuOf(line.productId),
        from: was.sellPrice,
        to: line.sellPrice,
      });
    }
  }
  for (const line of beforeLines) {
    if (!afterByProduct.has(line.productId)) {
      changes.push({ code: "line_removed", sku: skuOf(line.productId) });
    }
  }

  return changes;
}
