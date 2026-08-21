import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  getCategories,
  getProducts,
  getImagesByProduct,
  getSupplierIdsInCatalog,
} from "@/lib/queries/catalog";
import { getSuppliersForPicker } from "@/lib/queries/contacts";
import { countOpenDrafts } from "@/lib/queries/drafts";
import { getUserNames } from "@/lib/queries/users";
import { localizeField } from "@/lib/localize";
import type { Locale } from "@/i18n/routing";
import { CatalogControls } from "@/components/catalog/catalog-controls";
import { ProductCard, type CatalogProduct } from "@/components/catalog/product-card";
import { CatalogSnapshot } from "@/components/offline/catalog-snapshot";
import { Button } from "@/components/ui/button";

/** A search param that must be a real row id, or nothing. */
function positiveId(value: string | undefined) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string; supplier?: string; sort?: string }>;
}) {
  const { locale } = await params;
  const { category, supplier, sort } = await searchParams;
  const t = await getTranslations("catalog");

  const categories = await getCategories();
  const openDrafts = await countOpenDrafts();
  const categoryId = category ? Number(category) : undefined;
  const supplierId = positiveId(supplier);
  const products = await getProducts({
    categoryId,
    supplierId,
    sort: sort === "price-asc" ? "price-asc" : "default",
  });

  const imagesByProduct = await getImagesByProduct(products.map((p) => p.id));
  const userNames = await getUserNames();
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const suppliers = await getSuppliersForPicker();
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));

  // The filter offers only suppliers that have products — plus whichever one is
  // currently selected, so a filter that has gone empty still names itself
  // rather than silently reading "all suppliers".
  const supplierIdsInCatalog = await getSupplierIdsInCatalog();
  const filterSuppliers = suppliers.filter(
    (s) => supplierIdsInCatalog.has(s.id) || s.id === supplierId,
  );

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
      supplierName: p.supplierId
        ? (() => {
            const s = supplierMap.get(p.supplierId);
            return s ? s.companyName || s.companyNameZh : null;
          })()
        : null,
      supplierBooth: p.supplierId
        ? supplierMap.get(p.supplierId)?.boothLocation || null
        : null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Every full catalog view refreshes the phone's offline copy. */}
      <CatalogSnapshot
        complete={!categoryId && !supplierId}
        products={catalogProducts.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          categoryName: p.categoryName,
          price: p.price,
          sellPrice: p.sellPrice,
          currency: p.currency,
          moq: p.moq,
          qtyPerBox: p.qtyPerBox,
          supplierName: p.supplierName,
          supplierBooth: p.supplierBooth,
        }))}
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h1>
        <div className="flex items-center gap-2">
          {/* Only exists while there is something to review, so the button
              doubles as the signal that captures have arrived. */}
          {openDrafts > 0 ? (
            <Button asChild variant="outline" size="sm" data-testid="drafts-chip">
              <Link href="/catalog/drafts">{t("draftsWaiting", { count: openDrafts })}</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href="/catalog/categories">{t("manageCategories")}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/catalog/new">{t("addProduct")}</Link>
          </Button>
        </div>
      </div>

      <div className="mb-6">
        <CatalogControls
          categories={categories}
          suppliers={filterSuppliers}
          locale={locale}
        />
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
