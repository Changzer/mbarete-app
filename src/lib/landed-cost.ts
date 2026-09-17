import { convert, type CurrencyRates, UnknownCurrencyError } from "@/lib/calculations";

/**
 * Product + freight + estimated duty, not the full landed cost. Freight
 * is the carton's volume share; duty uses cost plus freight as an incomplete
 * planning base. An estimate for choosing products, never an invoice:
 * it leaves out insurance, port charges and the destination's other import
 * taxes (Brazil's IPI/PIS/COFINS/ICMS, Paraguay's IVA), which the reader
 * adds on their own numbers.
 */

export type Destination = "BR" | "PY";
export const DESTINATIONS: readonly Destination[] = ["BR", "PY"];

/** LCL shares a container with other shippers; FCL books a whole one. */
export type ShippingMode = "lcl" | "fcl";
export const SHIPPING_MODES: readonly ShippingMode[] = ["lcl", "fcl"];

export type ShippingRate = {
  destination: Destination;
  mode: ShippingMode;
  basis: "per_cbm" | "per_40hq";
  amount: number;
  currency: string;
  /** For a whole-container rate: the CBM one container really carries. */
  usableCbm: number;
  effectiveFrom: string;
};

/** The rate as money per cubic metre, whatever basis it was entered on. */
export function ratePerCbm(rate: Pick<ShippingRate, "basis" | "amount" | "usableCbm">): number {
  if (rate.basis === "per_40hq") return rate.usableCbm > 0 ? rate.amount / rate.usableCbm : 0;
  return rate.amount;
}

/** Freight for one piece: its carton's share of a cubic metre. 0 when the carton is unmeasured. */
export function shippingPerUnit(
  rate: Pick<ShippingRate, "basis" | "amount" | "usableCbm">,
  cartonCbm: number,
  qtyPerBox: number,
): number {
  if (!(cartonCbm > 0) || !(qtyPerBox > 0)) return 0;
  return (ratePerCbm(rate) * cartonCbm) / qtyPerBox;
}

/** The key an estimate is in force under: one per destination and mode. */
export function rateKey(destination: string, mode: string): string {
  return `${destination}:${mode}`;
}

/** Newest effective row as of the UTC day; later quotes stay scheduled. */
export function latestRates<T extends { destination: string; mode: string; effectiveFrom: string; id?: number }>(
  rows: T[],
  asOf = new Date().toISOString().slice(0, 10),
): Map<string, T> {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (row.effectiveFrom > asOf) continue;
    const key = rateKey(row.destination, row.mode);
    const cur = best.get(key);
    const newer =
      !cur ||
      row.effectiveFrom > cur.effectiveFrom ||
      (row.effectiveFrom === cur.effectiveFrom && (row.id ?? 0) > (cur.id ?? 0));
    if (newer) best.set(key, row);
  }
  return best;
}

/** The estimates in force for one destination, by mode. */
export type RatesByMode = Partial<Record<ShippingMode, ShippingRate>>;

export type LandedCostInput = {
  unitCost: number;
  costCurrency: string;
  cartonCbm: number;
  qtyPerBox: number;
  /** User-selected duty percentage; null when unknown. */
  dutyPct: number | null;
  rate: ShippingRate | null;
  /** The currency the figure is shown in. */
  target: string;
  rates: CurrencyRates;
};

export type LandedCost = {
  currency: string;
  unitCost: number | null;
  shipping: number | null;
  /** Cost plus freight only, not CIF: insurance is not modelled. */
  costAndFreight: number | null;
  duty: number | null;
  total: number | null;
  /** What could not be included, so the figure is read for what it is. */
  missing: ("price" | "rate" | "carton" | "duty" | "currency")[];
};

/**
 * Landed cost per unit in the target currency. Never throws: a missing
 * piece shows up in `missing`. Dependent amounts stay unknown instead of
 * turning an incomplete estimate into a deceptively low total.
 */
export function landedCost(input: LandedCostInput): LandedCost {
  const missing: LandedCost["missing"] = [];
  const conv = (amount: number, from: string) => {
    try {
      if (from !== input.target) {
        for (const code of [from, input.target]) {
          if (!Number.isFinite(input.rates[code]) || !(input.rates[code] > 0)) {
            throw new UnknownCurrencyError(code);
          }
        }
      }
      return convert(amount, from, input.target, input.rates);
    } catch (err) {
      if (err instanceof UnknownCurrencyError) {
        if (!missing.includes("currency")) missing.push("currency");
        return null;
      }
      throw err;
    }
  };
  const hasPrice = Number.isFinite(input.unitCost) && input.unitCost > 0;
  const unitCost = hasPrice ? conv(input.unitCost, input.costCurrency) : null;
  if (!hasPrice) missing.push("price");
  const hasCarton = Number.isFinite(input.cartonCbm) && input.cartonCbm > 0
    && Number.isFinite(input.qtyPerBox) && input.qtyPerBox > 0;
  const hasRate = input.rate && Number.isFinite(input.rate.amount) && input.rate.amount > 0
    && (input.rate.basis !== "per_40hq" || (Number.isFinite(input.rate.usableCbm) && input.rate.usableCbm > 0));
  let shipping: number | null = null;
  if (!hasRate) missing.push("rate");
  if (!hasCarton) missing.push("carton");
  if (hasRate && hasCarton && input.rate) shipping = conv(shippingPerUnit(input.rate, input.cartonCbm, input.qtyPerBox), input.rate.currency);
  const costAndFreight = unitCost !== null && shipping !== null ? unitCost + shipping : null;
  let duty: number | null = null;
  if (input.dutyPct === null || !Number.isFinite(input.dutyPct) || input.dutyPct < 0 || input.dutyPct > 200) missing.push("duty");
  else if (costAndFreight !== null) duty = (costAndFreight * input.dutyPct) / 100;
  const round = (n: number | null) => n === null ? null : Math.round(n * 10000) / 10000;
  return {
    currency: input.target,
    unitCost: round(unitCost),
    shipping: round(shipping),
    costAndFreight: round(costAndFreight),
    duty: round(duty),
    total: round(costAndFreight !== null && duty !== null ? costAndFreight + duty : null),
    missing,
  };
}

/**
 * The same estimate under both shipping modes, so LCL and FCL can be read
 * side by side. A mode with no rate retains known components but no total.
 */
export function landedCostByMode(input: Omit<LandedCostInput, "rate">, rates: RatesByMode): Record<ShippingMode, LandedCost> {
  return {
    lcl: landedCost({ ...input, rate: rates.lcl ?? null }),
    fcl: landedCost({ ...input, rate: rates.fcl ?? null }),
  };
}
