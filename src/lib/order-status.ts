/**
 * The order lifecycle, written down once and enforced server-side.
 *
 * Shipped records stay locked until explicitly reopened as confirmed. This
 * corrects an accidental shipment without duplicating the order or refreshing
 * its commercial snapshots. Cancelled orders reopen as draft (or confirmed
 * via an edit-save). Deleting is for drafts and cancellations only.
 */

export type OrderStatus = "draft" | "confirmed" | "shipped" | "cancelled";

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["draft", "shipped", "cancelled"],
  shipped: ["confirmed"],
  cancelled: ["draft", "confirmed"],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true; // idempotent no-op, never an error
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** These changes need an explicit acknowledgement as well as a current version. */
export function statusConfirmation(from: OrderStatus, to: OrderStatus): "ship" | "reopen" | null {
  if (from === to) return null;
  if (from === "confirmed" && to === "shipped") return "ship";
  if (from === "shipped" && to === "confirmed") return "reopen";
  return null;
}

/** Whether the order's lines and terms may still be edited. */
export function isEditable(status: OrderStatus): boolean {
  return status !== "shipped";
}

/** Whether the order may be deleted outright (admin only, on top of this). */
export function isDeletable(status: OrderStatus): boolean {
  return status === "draft" || status === "cancelled";
}
