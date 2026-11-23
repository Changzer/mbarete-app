import { convert, roundMoney, UnknownCurrencyError, type CurrencyRates } from "@/lib/calculations";
import { canonicalCurrencyCode } from "@/lib/currency";

export type SupplierBalanceLineInput = {
  supplierId: number | null;
  supplierName: string | null;
  lineTotal: number;
  currency: string;
};

export type SupplierBalancePaymentInput = {
  supplierId: number | null;
  amount: number;
  currency: string;
  rates?: CurrencyRates;
};

export type SupplierBalanceCurrency = {
  currency: string;
  cost: number;
  paid: number;
  /** Cost minus paid; negative is an overpayment and must remain visible. */
  balance: number;
  unconvertible: { amount: number; currency: string }[];
};

export type SupplierBalance = {
  supplierId: number | null;
  name: string | null;
  currencies: SupplierBalanceCurrency[];
};

type Group = SupplierBalance & {
  lines: Map<string, number>;
  payments: SupplierBalancePaymentInput[];
};

/**
 * Supplier-side money for one mixed order. Costs use the lines' frozen totals;
 * payments convert at their own day's rates, with the order's rates only as a
 * legacy fallback. Unknown rates stay visible instead of becoming paid zero.
 */
export function computeSupplierBalances(
  lines: SupplierBalanceLineInput[],
  payments: SupplierBalancePaymentInput[],
  fallbackRates: CurrencyRates,
  supplierNames: Record<number, string> = {},
): SupplierBalance[] {
  const groups = new Map<number | null, Group>();
  const groupFor = (supplierId: number | null): Group => {
    const existing = groups.get(supplierId);
    if (existing) return existing;
    const created: Group = {
      supplierId,
      name: supplierId === null ? null : supplierNames[supplierId] ?? null,
      currencies: [],
      lines: new Map(),
      payments: [],
    };
    groups.set(supplierId, created);
    return created;
  };

  for (const line of lines) {
    if (line.supplierId === null) continue;
    const group = groupFor(line.supplierId);
    group.name = line.supplierName || group.name;
    const currency = canonicalCurrencyCode(line.currency);
    group.lines.set(currency, roundMoney((group.lines.get(currency) ?? 0) + line.lineTotal));
  }
  for (const payment of payments) {
    groupFor(payment.supplierId).payments.push({ ...payment, currency: canonicalCurrencyCode(payment.currency) });
  }

  return [...groups.values()].map((group) => {
    const currencies = new Set<string>(group.lines.keys());
    for (const payment of group.payments) currencies.add(payment.currency);
    return {
      supplierId: group.supplierId,
      name: group.name,
      currencies: [...currencies].map((currency) => {
        const cost = group.lines.get(currency) ?? 0;
        let paid = 0;
        const unconvertible: SupplierBalanceCurrency["unconvertible"] = [];
        for (const payment of group.payments) {
          try {
            paid += convert(payment.amount, payment.currency, currency, {
              ...fallbackRates,
              ...payment.rates,
            });
          } catch (error) {
            if (error instanceof UnknownCurrencyError) {
              unconvertible.push({ amount: payment.amount, currency: payment.currency });
            } else {
              throw error;
            }
          }
        }
        return {
          currency,
          cost: roundMoney(cost),
          paid: roundMoney(paid),
          balance: roundMoney(cost - paid),
          unconvertible,
        };
      }),
    };
  });
}
