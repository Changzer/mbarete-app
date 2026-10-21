import { db } from "@/db";
import { productSuppliers, contacts, orderItems, orders, products } from "@/db/schema";
import { and, eq, inArray, asc } from "drizzle-orm";
import { getExchangeRates } from "@/lib/queries/orders";
import { pickPrimaryOffer, rankOffers, offerSpread, type Offer } from "@/lib/offers";

export type OfferRow = typeof productSuppliers.$inferSelect & {
  supplierName: string | null;
  /** How many orders this product has been bought on from this supplier. */
  timesOrdered: number;
};

/** The comparison basis: what most sourcing is priced in. */
export const OFFER_BASIS = "RMB";

/**
 * Which suppliers a product has actually been ordered from.
 *
 * Order lines do not yet name a supplier — that arrives with stage 2 — so
 * until they do, history is read at the product level: every supplier of a
 * product that has appeared on an order counts as proven. It is a coarse
 * signal deliberately, and it becomes exact the moment lines carry offers.
 */
async function orderedProductIds(companyId: number): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ productId: orderItems.productId })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(eq(orders.companyId, companyId));
  return new Set(rows.map((r) => r.productId));
}

/**
 * The suppliers a tie should favour. Order lines do not record which offer
 * they were bought on, so a product that has been ordered at all counts all
 * its named suppliers as proven — coarse on purpose, and the same everywhere
 * offers are ranked.
 */
function provenSuppliers(offers: { supplierId: number | null }[], productOrdered: boolean): Set<number> {
  if (!productOrdered) return new Set();
  return new Set(offers.filter((o) => o.supplierId !== null).map((o) => o.supplierId!));
}

/** Every offer for the given products, grouped by product, best first. */
export async function getOffersByProduct(
  companyId: number,
  productIds: number[],
): Promise<Map<number, OfferRow[]>> {
  const grouped = new Map<number, OfferRow[]>();
  if (productIds.length === 0) return grouped;

  const [rows, rates, ordered] = await Promise.all([
    db
      .select({
        offer: productSuppliers,
        supplierName: contacts.companyName,
      })
      .from(productSuppliers)
      .leftJoin(contacts, eq(productSuppliers.supplierId, contacts.id))
      .where(
        and(
          eq(productSuppliers.companyId, companyId),
          inArray(productSuppliers.productId, productIds),
        ),
      )
      .orderBy(asc(productSuppliers.id)),
    getExchangeRates(companyId),
    orderedProductIds(companyId),
  ]);

  for (const row of rows) {
    const list = grouped.get(row.offer.productId) ?? [];
    list.push({
      ...row.offer,
      supplierName: row.supplierName,
      timesOrdered: ordered.has(row.offer.productId) ? 1 : 0,
    });
    grouped.set(row.offer.productId, list);
  }

  // Each product's offers arrive ranked, so every caller shows the same order.
  for (const [productId, list] of grouped) {
    grouped.set(
      productId,
      rankOffers(list, { basis: OFFER_BASIS, rates, orderedSupplierIds: provenSuppliers(list, ordered.has(productId)) }),
    );
  }
  return grouped;
}

export async function getOffersForProduct(
  companyId: number,
  productId: number,
): Promise<OfferRow[]> {
  return (await getOffersByProduct(companyId, [productId])).get(productId) ?? [];
}

/**
 * Every offer on a product, including deactivated ones, best first with the
 * inactive ones last. The management view needs to show what it has switched
 * off — otherwise a deactivated quote is indistinguishable from a deleted
 * one and can never be brought back.
 */
export async function getAllOffersForProduct(
  companyId: number,
  productId: number,
): Promise<OfferRow[]> {
  const [rows, rates] = await Promise.all([
    db
      .select({ offer: productSuppliers, supplierName: contacts.companyName })
      .from(productSuppliers)
      .leftJoin(contacts, eq(productSuppliers.supplierId, contacts.id))
      .where(
        and(
          eq(productSuppliers.companyId, companyId),
          eq(productSuppliers.productId, productId),
        ),
      )
      .orderBy(asc(productSuppliers.id)),
    getExchangeRates(companyId),
  ]);
  const ordered = await orderedProductIds(companyId);
  const all: OfferRow[] = rows.map((row) => ({
    ...row.offer,
    supplierName: row.supplierName,
    timesOrdered: ordered.has(row.offer.productId) ? 1 : 0,
  }));

  const live = rankOffers(all, {
    basis: OFFER_BASIS,
    rates,
    orderedSupplierIds: provenSuppliers(all, ordered.has(productId)),
  });
  const liveIds = new Set(live.map((o) => o.id));
  return [...live, ...all.filter((o) => !liveIds.has(o.id))];
}

/** The spread across one product's suppliers, for the compare view. */
export async function getOfferSpread(companyId: number, offers: Offer[]) {
  const rates = await getExchangeRates(companyId);
  return offerSpread(offers, { basis: OFFER_BASIS, rates });
}

/**
 * Copies the winning offer's terms onto the product row.
 *
 * The offers are the truth; `products.price`, `.currency`, `.moq` and
 * `.supplierId` are a cache of whichever one currently wins, so catalog
 * sorting, the supplier filter, the order builder and every other existing
 * reader keep working unchanged. Called after every write that could change
 * which offer leads. A product whose last offer was deactivated keeps its
 * final known price rather than dropping to zero and pretending it is free.
 */
export async function syncProductFromOffers(
  companyId: number,
  productId: number,
  /** The company's ordered products, when the caller already has them. */
  ordered?: Set<number>,
) {
  const [offers, rates, orderedIds] = await Promise.all([
    db
      .select()
      .from(productSuppliers)
      .where(
        and(
          eq(productSuppliers.companyId, companyId),
          eq(productSuppliers.productId, productId),
        ),
      ),
    getExchangeRates(companyId),
    ordered ?? orderedProductIds(companyId),
  ]);
  // The same ranking the catalog shows, "ordered before" included: the cache
  // the order builder reads must name the supplier the product page leads
  // with, or a line lands under "no supplier" while the catalog shows one.
  const winner = pickPrimaryOffer(offers, {
    basis: OFFER_BASIS,
    rates,
    orderedSupplierIds: provenSuppliers(offers, orderedIds.has(productId)),
  });
  if (!winner) return;

  await db.update(products)
    .set({
      price: winner.price,
      supplierVatPct: winner.supplierVatPct,
      currency: winner.currency,
      moq: winner.moq,
      // Keeps "filter the catalog by supplier" answering with whoever the
      // product would actually be bought from today.
      supplierId: winner.supplierId,
    })
    .where(eq(products.id, productId));
}

/**
 * Re-derives several products' cached supplier, price and MOQ from their
 * offers before an order reads them, so a cache left behind by an older
 * ranking can never put a line under the wrong supplier.
 */
export async function syncProductsFromOffers(companyId: number, productIds: number[]) {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return;
  const ordered = await orderedProductIds(companyId);
  for (const id of ids) await syncProductFromOffers(companyId, id, ordered);
}
