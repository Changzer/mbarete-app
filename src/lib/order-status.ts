/**
 * The order lifecycle, written down once and enforced server-side.
 *
 * Shipped is terminal: goods left, the record is history. Cancelled is NOT —
 * a client who changes their mind reopens the same order instead of forcing
 * a duplicate; reopening lands back in draft (or straight to confirmed via
 * an edit-save). Deleting is for orders that never became business: drafts
 * and cancellations. The UI hides what the matrix forbids, but the matrix
 * is what actually refuses — a crafted request gets the same no.
 */

export type OrderStatus = "draft" | "confirmed" | "shipped" | "cancelled";

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["draft", "shipped", "cancelled"],
  shipped: [],
  cancelled: ["draft", "confirmed"],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true; // idempotent no-op, never an error
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Whether the order's lines and terms may still be edited. */
export function isEditable(status: OrderStatus): boolean {
  return status !== "shipped";
}

/** Whether the order may be deleted outright (admin only, on top of this). */
export function isDeletable(status: OrderStatus): boolean {
  return status === "draft" || status === "cancelled";
}
