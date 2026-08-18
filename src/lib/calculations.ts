export type ProductForCalc = {
  price: number;
  currency: string;
  moq: number;
  qtyPerBox: number;
  weightKg: number;
  cbm: number;
};

/** Volume of one carton in m^3, from its outer dimensions in cm. */
export function computeCbm(lengthCm: number, widthCm: number, heightCm: number) {
  return (lengthCm * widthCm * heightCm) / 1_000_000;
}

/**
 * Cartons are often a fraction of a cubic metre, so a fixed 4 decimals rounds
 * a real value like 0.00024 down to "0.0002" — which then fails to reconcile
 * against an order total and looks like a broken calculator.
 */
export function formatCbm(value: number) {
  if (value === 0) return "0.0000";
  return Math.abs(value) < 0.01 ? value.toFixed(6) : value.toFixed(4);
}

/** Cartons a quantity fills, as a fraction — 75 pcs at 50/carton is 1.5. */
export function cartonCount(product: ProductForCalc, quantity: number) {
  if (product.qtyPerBox <= 0) return 0;
  return quantity / product.qtyPerBox;
}

/** Cartons actually shipped: a partly-filled carton still travels as one. */
export function fullCartons(product: ProductForCalc, quantity: number) {
  return Math.ceil(cartonCount(product, quantity));
}

/** True when the quantity leaves a carton part-filled. */
export function isPartialCarton(product: ProductForCalc, quantity: number) {
  if (product.qtyPerBox <= 0 || quantity <= 0) return false;
  return quantity % product.qtyPerBox !== 0;
}

/**
 * Smallest quantity at or above `quantity` that clears MOQ *and* fills whole
 * cartons — the number to actually put on a purchase order.
 */
export function suggestedQuantity(product: ProductForCalc, quantity: number) {
  const atLeast = Math.max(quantity, product.moq);
  if (product.qtyPerBox <= 0) return atLeast;
  return Math.ceil(atLeast / product.qtyPerBox) * product.qtyPerBox;
}

export function isBelowMoq(quantity: number, moq: number) {
  return quantity > 0 && quantity < moq;
}

/**
 * Volume this line occupies in a container, in m^3.
 *
 * Based on whole cartons: a part-filled carton still takes a full carton of
 * space, so 175 pieces at 50/carton ships as 4 cartons and is quoted as 4.
 * Quantities that fill cartons exactly are unaffected.
 */
export function lineCbm(product: ProductForCalc, quantity: number) {
  if (product.qtyPerBox <= 0 || quantity <= 0) return 0;
  return fullCartons(product, quantity) * product.cbm;
}

/**
 * Weight of the goods on this line, in kg.
 *
 * Unlike volume this stays proportional to the pieces ordered — a part-filled
 * carton takes full space but does not weigh a full carton.
 */
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
  /** cartons across the whole order, shown so CBM can be reconciled by eye */
  totalCartons: number;
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
  let totalCartons = 0;
  let hasMoqViolation = false;

  for (const target of targetCurrencies) {
    if (rates[target] === undefined) missing.add(target);
    goods[target] = 0;
  }

  for (const { product, quantity } of lines) {
    if (quantity <= 0) continue;

    totalCbm += lineCbm(product, quantity);
    totalWeightKg += lineWeightKg(product, quantity);
    totalCartons += fullCartons(product, quantity);
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
    totalCartons,
    hasMoqViolation,
    missingRates: [...missing],
  };
}

/**
 * One order line as it was frozen when the order was saved.
 *
 * Volume, weight and carton count are stored per line at save time, so a
 * historical order keeps the logistics it was quoted with even after the
 * product's pack size or dimensions are edited in the catalog.
 */
export type SnapshotLine = {
  quantity: number;
  unitPrice: number;
  currency: string;
  moq: number;
  lineCbm: number;
  lineWeightKg: number;
  cartons: number;
};

/**
 * Totals for an order that has already been saved.
 *
 * Distinct from `computeOrderTotals`, which derives per-line volume, weight
 * and cartons from a live product. Here those values are already stored, so
 * they are summed as-is. Passing snapshot lines through `computeOrderTotals`
 * by way of a synthetic product silently re-derives them and gets cartons and
 * volume badly wrong.
 */
export function computeSnapshotTotals(
  lines: SnapshotLine[],
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
  let totalCartons = 0;
  let hasMoqViolation = false;

  for (const target of targetCurrencies) {
    if (rates[target] === undefined) missing.add(target);
    goods[target] = 0;
  }

  for (const line of lines) {
    if (line.quantity <= 0) continue;

    totalCbm += line.lineCbm;
    totalWeightKg += line.lineWeightKg;
    totalCartons += line.cartons;
    if (isBelowMoq(line.quantity, line.moq)) hasMoqViolation = true;

    const raw = line.unitPrice * line.quantity;
    for (const target of targetCurrencies) {
      try {
        goods[target] += convert(raw, line.currency, target, rates);
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
    totalCartons,
    hasMoqViolation,
    missingRates: [...missing],
  };
}

// --- estimating a carton from a single piece ---------------------------------

/**
 * Extra volume and weight a carton adds over the bare goods, as a percentage.
 *
 * Pieces never tessellate perfectly and the carton itself has walls and
 * weight, so a carton is always bigger and heavier than the sum of what is
 * inside it. 15% is a broadly safe default for mixed goods; irregular or
 * fragile items pack worse and want more.
 */
export const DEFAULT_PACKING_ALLOWANCE_PCT = 15;

export type PieceDimensions = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

/**
 * Approximate carton volume in m^3 from one piece's dimensions.
 *
 * Used when a supplier has quoted the product but not its export carton.
 * Deliberately errs high: under-quoting freight costs money, over-quoting
 * loses a little margin on the quote.
 */
export function estimateCartonCbm(
  piece: PieceDimensions,
  qtyPerBox: number,
  allowancePct: number = DEFAULT_PACKING_ALLOWANCE_PCT,
) {
  if (qtyPerBox <= 0) return 0;
  const pieceCbm = computeCbm(piece.lengthCm, piece.widthCm, piece.heightCm);
  return pieceCbm * qtyPerBox * (1 + allowancePct / 100);
}

/**
 * Approximate carton weight in kg from one piece's weight.
 *
 * Carries the same allowance as the volume estimate, which here stands for
 * the packaging material rather than void space. Freight is charged on gross
 * weight, so the carton's own weight belongs in the figure.
 */
export function estimateCartonWeightKg(
  pieceWeightKg: number,
  qtyPerBox: number,
  allowancePct: number = DEFAULT_PACKING_ALLOWANCE_PCT,
) {
  if (qtyPerBox <= 0) return 0;
  return pieceWeightKg * qtyPerBox * (1 + allowancePct / 100);
}

/**
 * Weight for display, in kg.
 *
 * Estimated weights are the product of several floats and land on values like
 * 5.5200000000000005, so round to the gram and drop trailing zeros. Hand-typed
 * weights come back unchanged.
 */
export function formatWeightKg(value: number) {
  return String(Math.round(value * 1000) / 1000);
}
