export const BANK_STATEMENT_KINDS = [
  "client_payment",
  "supplier_payment",
  "order_expense",
  "operating_expense",
  "other_income",
  "other_expense",
  "exchange",
  "unknown",
] as const;

export const ORDER_EXPENSE_CATEGORIES = ["freight", "customs", "inspection", "local_transport", "bank_fees", "other"] as const;
export const OPERATING_EXPENSE_CATEGORIES = ["rent", "utilities", "payroll", "taxes", "professional_fees", "software", "marketing", "travel", "office", "bank_fees", "other"] as const;

export function bankStatementDirection(kind: (typeof BANK_STATEMENT_KINDS)[number]): "in" | "out" | "" {
  if (kind === "client_payment" || kind === "other_income") return "in";
  return kind === "unknown" ? "" : "out";
}
