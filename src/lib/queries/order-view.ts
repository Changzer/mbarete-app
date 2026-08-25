import { getOrderById, getExchangeRates } from "@/lib/queries/orders";
import { getProducts } from "@/lib/queries/catalog";
import { localizeField } from "@/lib/localize";
import type { Locale } from "@/i18n/routing";
import { computeSnapshotTotals, type OrderTotals } from "@/lib/calculations";

export type OrderViewRow = {
  id: number;
  productId: number;
  sku: string;
  /** the factory's own style/model number; "" when none recorded */
  supplierCode: string;
  name: string;
  quantity: number;
  unitPriceSnapshot: number;
  /** the invoiced price per unit; equals the cost on pre-sell-price orders */
  sellPrice: number;
  /** true when no sell price was set, so customer documents show the cost */
  sellMissing: boolean;
  sellTotal: number;
  currencySnapshot: string;
  /** the currency the sell price was quoted in; the cost currency on old rows */
  sellCurrency: string;
  moqSnapshot: number;
  lineTotal: number;
  lineCbm: number;
  lineWeightKg: number;
  /** Cartons shipped, from the snapshot; recovered from the product for old rows. */
  cartons: number | null;
  perCarton: number;
  below: boolean;
};

export type OrderView = NonNullable<Awaited<ReturnType<typeof getOrderView>>>;

/**
 * One saved order, reconstructed the same way everywhere it is shown.
 *
 * The order detail page and the proforma invoice must never disagree, so the
 * localized rows, effective rates and totals are built once here. Rates are
 * the ones frozen when the order was saved; live rates only fill currencies
 * the snapshot never had, so a quote saved before a rate existed recovers
 * without historical quotes moving.
 */
export async function getOrderView(companyId: number, orderId: number, locale: Locale) {
  const [data, rates, products] = await Promise.all([
    getOrderById(companyId, orderId),
    getExchangeRates(companyId),
    getProducts(companyId),
  ]);
  if (!data) return null;

  const { order, items, client } = data;
  const productMap = new Map(products.map((p) => [p.id, p]));

  let snapshot: Record<string, number> = {};
  try {
    snapshot = JSON.parse(order.ratesSnapshot || "{}");
  } catch {
    snapshot = {};
  }
  const effectiveRates = { ...rates, ...snapshot };

  const rows: OrderViewRow[] = items.map((item) => {
    // The line's own snapshots first; the live product only fills rows from
    // before the snapshots existed. A renamed, repacked or deleted product
    // must not change what a saved order shows.
    const product = productMap.get(item.productId);
    const perCarton =
      item.qtyPerBoxSnapshot > 0 ? item.qtyPerBoxSnapshot : (product?.qtyPerBox ?? 0);
    const cartons =
      item.cartonsSnapshot > 0
        ? item.cartonsSnapshot
        : perCarton > 0
          ? Math.ceil(item.quantity / perCarton)
          : null;
    const snapName = localizeField(locale, item.nameEnSnapshot, item.nameZhSnapshot);
    return {
      id: item.id,
      productId: item.productId,
      sku: item.skuSnapshot || (product?.sku ?? `#${item.productId}`),
      supplierCode: item.supplierCodeSnapshot || (product?.supplierCode ?? ""),
      name:
        snapName ||
        (product ? localizeField(locale, product.nameEn, product.nameZh) : `#${item.productId}`),
      quantity: item.quantity,
      unitPriceSnapshot: item.unitPriceSnapshot,
      sellPrice:
        item.sellPriceSnapshot > 0 ? item.sellPriceSnapshot : item.unitPriceSnapshot,
      sellMissing: !(item.sellPriceSnapshot > 0),
      sellTotal:
        (item.sellPriceSnapshot > 0 ? item.sellPriceSnapshot : item.unitPriceSnapshot) *
        item.quantity,
      currencySnapshot: item.currencySnapshot,
      sellCurrency: item.sellCurrencySnapshot || item.currencySnapshot,
      moqSnapshot: item.moqSnapshot,
      lineTotal: item.lineTotal,
      lineCbm: item.lineCbm,
      lineWeightKg: item.lineWeightKg,
      cartons,
      perCarton,
      below: item.quantity < item.moqSnapshot,
    };
  });

  const targets = [...new Set([order.displayCurrency, order.secondaryCurrency])];
  const totals: OrderTotals = computeSnapshotTotals(
    rows.map((r) => ({
      quantity: r.quantity,
      unitPrice: r.unitPriceSnapshot,
      sellPrice: r.sellPrice,
      currency: r.currencySnapshot,
      sellCurrency: r.sellCurrency,
      moq: r.moqSnapshot,
      lineCbm: r.lineCbm,
      lineWeightKg: r.lineWeightKg,
      cartons: r.cartons ?? 0,
    })),
    targets,
    effectiveRates,
    order.commissionPct,
  );

  return { order, client, rows, targets, totals, effectiveRates };
}
