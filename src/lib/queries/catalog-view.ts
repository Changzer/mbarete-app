import type { Locale } from "@/i18n/routing";
import type { CatalogProduct } from "@/components/catalog/product-card";
import { getCategories, getImagesByProduct, getProductById, type ProductFilters, getProducts } from "@/lib/queries/catalog";
import { getSuppliersForPicker } from "@/lib/queries/contacts";
import { getUserNames } from "@/lib/queries/users";
import { getOffersByProduct, OFFER_BASIS } from "@/lib/queries/offers";
import { getExchangeRates } from "@/lib/queries/orders";
import { comparablePrice } from "@/lib/offers";
import { localizeField } from "@/lib/localize";

type ProductRow = Awaited<ReturnType<typeof getProducts>>[number];

/** The other language's name, when it differs — the supplier writes the Chinese one on the box. */
export function altName(locale: Locale, nameEn: string, nameZh: string) {
  const other = locale === "zh" ? nameEn : nameZh;
  const primary = localizeField(locale, nameEn, nameZh);
  return other && other !== primary ? other : "";
}

/**
 * Product rows as the catalog card shows them: localized names, images,
 * the ranked supplier quotes, who touched them. One place, so the catalog
 * list and a single product opened from elsewhere (an order line) read
 * the same way.
 */
export async function toCatalogProducts(
  companyId: number,
  locale: Locale,
  rows: ProductRow[],
): Promise<CatalogProduct[]> {
  const productIds = rows.map((p) => p.id);
  const [categories, imagesByProduct, userNames, offersByProduct, rates, suppliers] = await Promise.all([
    getCategories(companyId),
    getImagesByProduct(productIds),
    getUserNames(companyId),
    getOffersByProduct(companyId, productIds),
    getExchangeRates(companyId),
    getSuppliersForPicker(companyId),
  ]);
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));

  return rows.map((p) => {
    const cat = categoryMap.get(p.categoryId);
    const supplier = p.supplierId ? supplierMap.get(p.supplierId) : undefined;
    return {
      id: p.id,
      sku: p.sku,
      name: localizeField(locale, p.nameEn, p.nameZh),
      altName: altName(locale, p.nameEn, p.nameZh),
      description: localizeField(locale, p.descriptionEn, p.descriptionZh),
      boardText: p.boardText,
      aiNotes: p.aiNotes,
      categoryName: cat ? localizeField(locale, cat.nameEn, cat.nameZh) : "",
      price: p.price,
      sellPrice: p.sellPrice,
      currency: p.currency,
      moq: p.moq,
      qtyPerBox: p.qtyPerBox,
      lengthCm: p.lengthCm,
      widthCm: p.widthCm,
      heightCm: p.heightCm,
      weightKg: p.weightKg,
      cbm: p.cbm,
      dimensionSource: p.dimensionSource,
      createdByName: p.createdBy ? userNames.get(p.createdBy) ?? null : null,
      updatedByName: p.updatedBy ? userNames.get(p.updatedBy) ?? null : null,
      pieceLengthCm: p.pieceLengthCm,
      pieceWidthCm: p.pieceWidthCm,
      pieceHeightCm: p.pieceHeightCm,
      images: imagesByProduct.get(p.id) ?? [],
      active: p.active,
      supplierName: supplier ? localizeField(locale, supplier.companyName, supplier.companyNameZh) : null,
      supplierBooth: supplier?.boothLocation || null,
      // Already ranked; the card only needs each offer's comparable value to
      // work out how far behind the cheapest the others sit.
      offers: (offersByProduct.get(p.id) ?? []).map((o) => ({
        id: o.id,
        supplierId: o.supplierId,
        supplierName: o.supplierName,
        price: o.price,
        currency: o.currency,
        moq: o.moq,
        leadTimeDays: o.leadTimeDays,
        quotedOn: o.quotedOn,
        timesOrdered: o.timesOrdered,
        comparable: comparablePrice(o, OFFER_BASIS, rates),
      })),
    };
  });
}

/** One product as the catalog would show it, or null when it is not this company's. */
export async function getCatalogProduct(
  companyId: number,
  locale: Locale,
  productId: number,
): Promise<CatalogProduct | null> {
  const row = await getProductById(companyId, productId);
  if (!row) return null;
  const [view] = await toCatalogProducts(companyId, locale, [row as ProductRow]);
  return view ?? null;
}

export type { ProductFilters };
