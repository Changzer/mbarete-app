import { convert, UnknownCurrencyError, type CurrencyRates } from "@/lib/calculations";

/**
 * Choosing between suppliers for the same product.
 *
 * Five factories quoting one electric scooter is the normal case for a
 * sourcing company, and the catalog's job is to make that comparison
 * immediate: who is cheapest, is that price still current, and have we
 * actually dealt with them before. Pure functions so the rules are testable
 * without a database — the same discipline the money maths uses.
 */

export type Offer = {
  id: number;
  supplierId: number | null;
  price: number;
  currency: string;
  moq: number;
  leadTimeDays: number;
  /** ISO date the price was quoted. */
  quotedOn: string;
  active: boolean;
};

/** A quote older than this is shown as aged: factory prices have moved. */
export const STALE_QUOTE_DAYS = 180;

/**
 * Prices are compared in one currency before being ranked.
 *
 * Sourcing is almost always from China and almost every offer is RMB, so
 * this rarely does anything. It exists because ranking raw numbers across
 * currencies is silently wrong — 1.42 USD would sort below 10.20 RMB — and
 * three lines here mean a Japanese or Korean supplier is a non-event later.
 * An unknown currency keeps its own number rather than vanishing from the
 * comparison.
 */
export function comparablePrice(
  offer: Pick<Offer, "price" | "currency">,
  basis: string,
  rates: CurrencyRates,
): number {
  try {
    return convert(offer.price, offer.currency, basis, rates);
  } catch (err) {
    if (err instanceof UnknownCurrencyError) return offer.price;
    throw err;
  }
}

export type RankContext = {
  /** Suppliers this product has actually been ordered from before. */
  orderedSupplierIds?: Set<number>;
  /** Currency the comparison happens in; offers are converted to it. */
  basis: string;
  rates: CurrencyRates;
};

/**
 * Every active offer, best first.
 *
 * Cheapest wins. When two quotes tie, a supplier this product has already
 * been ordered from beats a stranger — a proven factory is worth more than a
 * rounding difference. Failing that the fresher quote wins, because the
 * newer price is the one more likely to still be honoured; and failing that
 * the more recently added offer, which keeps the order stable.
 */
export function rankOffers<T extends Offer>(offers: T[], ctx: RankContext): T[] {
  const ordered = ctx.orderedSupplierIds ?? new Set<number>();
  return offers
    .filter((o) => o.active)
    .map((o) => ({
      offer: o,
      value: comparablePrice(o, ctx.basis, ctx.rates),
      known: o.supplierId !== null && ordered.has(o.supplierId),
    }))
    .sort((a, b) => {
      if (a.value !== b.value) return a.value - b.value;
      if (a.known !== b.known) return a.known ? -1 : 1;
      const byQuote = b.offer.quotedOn.localeCompare(a.offer.quotedOn);
      if (byQuote !== 0) return byQuote;
      return b.offer.id - a.offer.id;
    })
    .map((row) => row.offer);
}

/** The offer the catalog leads with, or undefined when a product has none active. */
export function pickPrimaryOffer<T extends Offer>(
  offers: T[],
  ctx: RankContext,
): T | undefined {
  return rankOffers(offers, ctx)[0];
}

export type OfferSpread = {
  /** How many active offers there are. */
  count: number;
  lowest: number;
  highest: number;
  /**
   * How far the best price sits below the next best, as a percentage of the
   * next best. Null with fewer than two offers. This is the number that says
   * whether there is a real winner or the difference is noise not worth
   * leaving a trusted factory over.
   */
  advantagePct: number | null;
};

/**
 * The overall picture across a product's suppliers.
 *
 * Deliberately not an average: nobody ever pays the average, and quoting it
 * would invite decisions based on a price that does not exist. The spread
 * shows negotiating room, and the advantage says whether the cheapest quote
 * is meaningfully cheaper.
 */
export function offerSpread(offers: Offer[], ctx: RankContext): OfferSpread | null {
  const ranked = rankOffers(offers, ctx);
  if (ranked.length === 0) return null;
  const values = ranked.map((o) => comparablePrice(o, ctx.basis, ctx.rates));
  const lowest = values[0];
  const highest = Math.max(...values);
  const next = values[1];
  return {
    count: ranked.length,
    lowest,
    highest,
    advantagePct: next !== undefined && next > 0 ? ((next - lowest) / next) * 100 : null,
  };
}

/** True when a quote is old enough that it should be treated as unconfirmed. */
export function isStaleQuote(quotedOn: string, today = new Date()): boolean {
  const quoted = new Date(`${quotedOn}T00:00:00Z`);
  if (Number.isNaN(quoted.getTime())) return false;
  const days = (today.getTime() - quoted.getTime()) / 86_400_000;
  return days > STALE_QUOTE_DAYS;
}
