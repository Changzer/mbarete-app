import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCategories, getProducts, getImagesByProduct } from "@/lib/queries/catalog";
import { getUserNames } from "@/lib/queries/users";
import { getOffersByProduct, OFFER_BASIS } from "@/lib/queries/offers";
import { getExchangeRates } from "@/lib/queries/orders";
import { comparablePrice } from "@/lib/offers";
import { localizeField } from "@/lib/localize";
import type { Locale } from "@/i18n/routing";
import { CatalogControls } from "@/components/catalog/catalog-controls";
import { ProductCard, type CatalogProduct } from "@/components/catalog/product-card";
import { Button } from "@/components/ui/button";

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string; sort?: string }>;
}) {
  const { locale } = await params;
  const { category, sort } = await searchParams;
  const t = await getTranslations("catalog");

  const categories = await getCategories();
  const categoryId = category ? Number(category) : undefined;
  const products = await getProducts({
    categoryId,
    sort: sort === "price-asc" ? "price-asc" : "default",
  });

  const productIds = products.map((p) => p.id);
  const [imagesByProduct, userNames, offersByProduct, rates] = await Promise.all([
    getImagesByProduct(productIds),
    getUserNames(),
    getOffersByProduct(productIds),
    getExchangeRates(),
  ]);
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const catalogProducts: CatalogProduct[] = products.map((p) => {
    const cat = categoryMap.get(p.categoryId);
    return {
      id: p.id,
      sku: p.sku,
      name: localizeField(locale as Locale, p.nameEn, p.nameZh),
      description: localizeField(locale as Locale, p.descriptionEn, p.descriptionZh),
      categoryName: cat
        ? localizeField(locale as Locale, cat.nameEn, cat.nameZh)
        : "",
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/catalog/categories">{t("manageCategories")}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/catalog/new">{t("addProduct")}</Link>
          </Button>
        </div>
      </div>

      <div className="mb-6">
        <CatalogControls categories={categories} locale={locale} />
      </div>

      {catalogProducts.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("noProducts")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {catalogProducts.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
