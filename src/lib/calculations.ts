export type ProductForCalc = {
  price: number;
  currency: string;
  moq: number;
  qtyPerBox: number;
  weightKg: number;
  cbm: number;
};

export function computeCbm(lengthCm: number, widthCm: number, heightCm: number) {
  return (lengthCm * widthCm * heightCm) / 1_000_000;
}

export function isBelowMoq(quantity: number, moq: number) {
  return quantity > 0 && quantity < moq;
}

export function lineCbm(product: ProductForCalc, quantity: number) {
  if (product.qtyPerBox <= 0) return 0;
  return (quantity / product.qtyPerBox) * product.cbm;
}

export function lineWeightKg(product: ProductForCalc, quantity: number) {
  if (product.qtyPerBox <= 0) return 0;
  return (quantity / product.qtyPerBox) * product.weightKg;
}

export function lineTotal(product: ProductForCalc, quantity: number) {
  return product.price * quantity;
}

/** currency code -> how many USD one unit is worth (e.g. CNY: 0.14) */
export type CurrencyRates = Record<string, number>;

export class UnknownCurrencyError extends Error {
  constructor(public readonly currency: string) {
    super(`No exchange rate configured for "${currency}"`);
    this.name = "UnknownCurrencyError";
  }
}

/**
 * Convert between currencies via USD.
 *
 * Throws on an unconfigured currency rather than assuming 1:1. A silent
 * fallback here reads as "10 RMB = 10 USD" on a quote, which is a 7x pricing
 * error, so this must fail loudly.
 */
export function convert(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: CurrencyRates,
) {
  if (fromCurrency === toCurrency) return amount;
  const fromRate = rates[fromCurrency];
  const toRate = rates[toCurrency];
  if (fromRate === undefined) throw new UnknownCurrencyError(fromCurrency);
  if (toRate === undefined) throw new UnknownCurrencyError(toCurrency);
  return (amount * fromRate) / toRate;
}

export type OrderLineInput = {
  product: ProductForCalc;
  quantity: number;
};

export type OrderTotals = {
  /** goods subtotal, keyed by target currency */
  goods: Record<string, number>;
  /** commission amount, keyed by target currency */
  commission: Record<string, number>;
  /** goods + commission, keyed by target currency */
  grandTotal: Record<string, number>;
  totalCbm: number;
  totalWeightKg: number;
  hasMoqViolation: boolean;
  /** currencies used by products but absent from the rate table */
  missingRates: string[];
};

/**
 * Totals for an order, expressed in every requested target currency.
 *
 * Commission is a percentage of the goods subtotal — Mbarete's margin on top
 * of what the supplier charges.
 */
export function computeOrderTotals(
  lines: OrderLineInput[],
  targetCurrencies: string[],
  rates: CurrencyRates,
  commissionPct = 0,
): OrderTotals {
  const goods: Record<string, number> = {};
  const commission: Record<string, number> = {};
  const grandTotal: Record<string, number> = {};
  const missing = new Set<string>();

  let totalCbm = 0;
  let totalWeightKg = 0;
  let hasMoqViolation = false;

  for (const target of targetCurrencies) {
    if (rates[target] === undefined) missing.add(target);
    goods[target] = 0;
  }

  for (const { product, quantity } of lines) {
    if (quantity <= 0) continue;

    totalCbm += lineCbm(product, quantity);
    totalWeightKg += lineWeightKg(product, quantity);
    if (isBelowMoq(quantity, product.moq)) hasMoqViolation = true;

    const raw = lineTotal(product, quantity);
    for (const target of targetCurrencies) {
      try {
        goods[target] += convert(raw, product.currency, target, rates);
      } catch (err) {
        if (err instanceof UnknownCurrencyError) {
          missing.add(err.currency);
        } else {
          throw err;
        }
      }
    }
  }

  for (const target of targetCurrencies) {
    commission[target] = goods[target] * (commissionPct / 100);
    grandTotal[target] = goods[target] + commission[target];
  }

  return {
    goods,
    commission,
    grandTotal,
    totalCbm,
    totalWeightKg,
    hasMoqViolation,
    missingRates: [...missing],
  };
}
