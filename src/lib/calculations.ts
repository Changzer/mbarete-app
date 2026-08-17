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

export type CurrencyRates = Record<string, number>; // currency -> rate to USD

export function convert(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: CurrencyRates,
) {
  if (fromCurrency === toCurrency) return amount;
  const fromRate = rates[fromCurrency] ?? 1;
  const toRate = rates[toCurrency] ?? 1;
  const usd = amount * fromRate;
  return usd / toRate;
}

export type OrderLineInput = {
  product: ProductForCalc;
  quantity: number;
};

export type OrderTotals = {
  totalPrice: number;
  totalCbm: number;
  totalWeightKg: number;
  hasMoqViolation: boolean;
};

export function computeOrderTotals(
  lines: OrderLineInput[],
  displayCurrency: string,
  rates: CurrencyRates,
): OrderTotals {
  let totalPrice = 0;
  let totalCbm = 0;
  let totalWeightKg = 0;
  let hasMoqViolation = false;

  for (const { product, quantity } of lines) {
    if (quantity <= 0) continue;
    const raw = lineTotal(product, quantity);
    totalPrice += convert(raw, product.currency, displayCurrency, rates);
    totalCbm += lineCbm(product, quantity);
    totalWeightKg += lineWeightKg(product, quantity);
    if (isBelowMoq(quantity, product.moq)) hasMoqViolation = true;
  }

  return { totalPrice, totalCbm, totalWeightKg, hasMoqViolation };
}
