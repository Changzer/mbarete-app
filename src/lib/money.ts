const CURRENCY_MARK: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€" };

/**
 * ¥12.50 — the register a buyer compares prices in, not "12.50 CNY".
 *
 * Lives here rather than beside the catalog row that first needed it: the
 * offer comparison, the order builder and the row all format the same figures,
 * and importing it from a component makes a cycle out of what is one function.
 */
export function formatMoney(value: number, currency: string) {
  const mark = CURRENCY_MARK[currency];
  const amount = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return mark ? `${mark}${amount}` : `${amount} ${currency}`;
}
