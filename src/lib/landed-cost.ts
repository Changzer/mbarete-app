import { convert, type CurrencyRates, UnknownCurrencyError } from "@/lib/calculations";

/**
 * What a product costs once it has arrived: the supplier's price, the sea
 * freight for its share of a carton, and the destination's import duty on
 * the two together. An estimate for choosing products, never an invoice:
 * it leaves out insurance, port charges and the destination's other import
 * taxes (Brazil's IPI/PIS/COFINS/ICMS, Paraguay's IVA), which the reader
 * adds on their own numbers.
 */

export type Destination = "BR" | "PY";
export const DESTINATIONS: readonly Destination[] = ["BR", "PY"];

export type ShippingRate = {
  destination: Destination;
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

/** The newest row per destination is the estimate in force. */
export function latestPerDestination<T extends { destination: string; effectiveFrom: string; id?: number }>(
  rows: T[],
): Map<string, T> {
  const best = new Map<string, T>();
  for (const row of rows) {
    const cur = best.get(row.destination);
    const newer =
      !cur ||
      row.effectiveFrom > cur.effectiveFrom ||
      (row.effectiveFrom === cur.effectiveFrom && (row.id ?? 0) > (cur.id ?? 0));
    if (newer) best.set(row.destination, row);
  }
  return best;
}

export type LandedCostInput = {
  unitCost: number;
  costCurrency: string;
  cartonCbm: number;
  qtyPerBox: number;
  /** Ad valorem import duty on the CIF value, in percent; null when unknown. */
  dutyPct: number | null;
  rate: ShippingRate | null;
  /** The currency the figure is shown in. */
  target: string;
  rates: CurrencyRates;
};

export type LandedCost = {
  currency: string;
  unitCost: number;
  shipping: number;
  /** Cost plus freight — the duty base (insurance left out). */
  cif: number;
  duty: number;
  total: number;
  /** What could not be included, so the figure is read for what it is. */
  missing: ("price" | "rate" | "carton" | "duty" | "currency")[];
};

/**
 * Landed cost per unit in the target currency. Never throws: a missing
 * piece shows up in `missing` and contributes zero, so the reader sees a
 * partial figure labelled as partial rather than nothing.
 */
export function landedCost(input: LandedCostInput): LandedCost {
  const missing: LandedCost["missing"] = [];
  const conv = (amount: number, from: string) => {
    try {
      return convert(amount, from, input.target, input.rates);
    } catch (err) {
      if (err instanceof UnknownCurrencyError) {
        if (!missing.includes("currency")) missing.push("currency");
        return 0;
      }
      throw err;
    }
  };
  const unitCost = input.unitCost > 0 ? conv(input.unitCost, input.costCurrency) : 0;
  if (!(input.unitCost > 0)) missing.push("price");
  let shipping = 0;
  if (!input.rate) missing.push("rate");
  else if (!(input.cartonCbm > 0) || !(input.qtyPerBox > 0)) missing.push("carton");
  else shipping = conv(shippingPerUnit(input.rate, input.cartonCbm, input.qtyPerBox), input.rate.currency);
  const cif = unitCost + shipping;
  let duty = 0;
  if (input.dutyPct === null || !Number.isFinite(input.dutyPct)) missing.push("duty");
  else duty = (cif * input.dutyPct) / 100;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return {
    currency: input.target,
    unitCost: round(unitCost),
    shipping: round(shipping),
    cif: round(cif),
    duty: round(duty),
    total: round(cif + duty),
    missing,
  };
}
