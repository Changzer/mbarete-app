import { db } from "@/db";
import { productSuppliers, contacts, orderItems, orders, products } from "@/db/schema";
import { eq, inArray, asc } from "drizzle-orm";
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
async function orderedProductIds(): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ productId: orderItems.productId })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .all();
  return new Set(rows.map((r) => r.productId));
}

/** Every offer for the given products, grouped by product, best first. */
export async function getOffersByProduct(
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
      .where(inArray(productSuppliers.productId, productIds))
      .orderBy(asc(productSuppliers.id))
      .all(),
    getExchangeRates(),
    orderedProductIds(),
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
    const proven = new Set(
      list.filter((o) => o.timesOrdered > 0 && o.supplierId !== null).map((o) => o.supplierId!),
    );
    grouped.set(
      productId,
      rankOffers(list, { basis: OFFER_BASIS, rates, orderedSupplierIds: proven }),
    );
  }
  return grouped;
}

export async function getOffersForProduct(productId: number): Promise<OfferRow[]> {
  return (await getOffersByProduct([productId])).get(productId) ?? [];
}

/**
 * Every offer on a product, including deactivated ones, best first with the
 * inactive ones last. The management view needs to show what it has switched
 * off — otherwise a deactivated quote is indistinguishable from a deleted
 * one and can never be brought back.
 */
export async function getAllOffersForProduct(productId: number): Promise<OfferRow[]> {
  const [rows, rates] = await Promise.all([
    db
      .select({ offer: productSuppliers, supplierName: contacts.companyName })
      .from(productSuppliers)
      .leftJoin(contacts, eq(productSuppliers.supplierId, contacts.id))
      .where(eq(productSuppliers.productId, productId))
      .orderBy(asc(productSuppliers.id))
      .all(),
    getExchangeRates(),
  ]);
  const ordered = await orderedProductIds();
  const all: OfferRow[] = rows.map((row) => ({
    ...row.offer,
    supplierName: row.supplierName,
    timesOrdered: ordered.has(row.offer.productId) ? 1 : 0,
  }));

  const proven = new Set(
    all.filter((o) => o.timesOrdered > 0 && o.supplierId !== null).map((o) => o.supplierId!),
  );
  const live = rankOffers(all, {
    basis: OFFER_BASIS,
    rates,
    orderedSupplierIds: proven,
  });
  const liveIds = new Set(live.map((o) => o.id));
  return [...live, ...all.filter((o) => !liveIds.has(o.id))];
}

/** The spread across one product's suppliers, for the compare view. */
export async function getOfferSpread(offers: Offer[]) {
  const rates = await getExchangeRates();
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
export async function syncProductFromOffers(productId: number) {
  const [offers, rates] = await Promise.all([
    db
      .select()
      .from(productSuppliers)
      .where(eq(productSuppliers.productId, productId))
      .all(),
    getExchangeRates(),
  ]);
  const winner = pickPrimaryOffer(offers, { basis: OFFER_BASIS, rates });
  if (!winner) return;

  db.update(products)
    .set({
      price: winner.price,
      currency: winner.currency,
      moq: winner.moq,
      // Keeps "filter the catalog by supplier" answering with whoever the
      // product would actually be bought from today.
      supplierId: winner.supplierId,
    })
    .where(eq(products.id, productId))
    .run();
}
