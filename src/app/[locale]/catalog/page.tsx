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
import { getOffersByProduct, OFFER_BASIS } from "@/lib/queries/offers";
import { getExchangeRates } from "@/lib/queries/orders";
import { comparablePrice } from "@/lib/offers";
import { localizeField } from "@/lib/localize";
import type { Locale } from "@/i18n/routing";
import { CatalogControls } from "@/components/catalog/catalog-controls";
import { type CatalogProduct } from "@/components/catalog/product-card";
import { CatalogList } from "@/components/catalog/catalog-list";
import { CaptureFab } from "@/components/catalog/capture-fab";
import { CatalogSnapshot } from "@/components/offline/catalog-snapshot";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/authz";

/**
 * The name in the language the page is *not* in, so a row can carry both.
 * Empty when a product was registered in one language only, or when the two
 * names are the same string — repeating it would just be noise in the row.
 */
function altName(locale: Locale, nameEn: string, nameZh: string) {
  const other = locale === "zh" ? nameEn : nameZh;
  const primary = localizeField(locale, nameEn, nameZh);
  return other && other !== primary ? other : "";
}

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

  const { companyId } = await requireUser();
  const categories = await getCategories(companyId);
  const openDrafts = await countOpenDrafts(companyId);
  const categoryId = category ? Number(category) : undefined;
  const supplierId = positiveId(supplier);
  const products = await getProducts(companyId, {
    categoryId,
    supplierId,
    sort: sort === "price-asc" ? "price-asc" : "default",
  });

  const productIds = products.map((p) => p.id);
  const [imagesByProduct, userNames, offersByProduct, rates] = await Promise.all([
    getImagesByProduct(productIds),
    getUserNames(companyId),
    getOffersByProduct(companyId, productIds),
    getExchangeRates(companyId),
  ]);
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const suppliers = await getSuppliersForPicker(companyId);
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));

  // The filter offers only suppliers that have products — plus whichever one is
  // currently selected, so a filter that has gone empty still names itself
  // rather than silently reading "all suppliers".
  const supplierIdsInCatalog = await getSupplierIdsInCatalog(companyId);
  const filterSuppliers = suppliers.filter(
    (s) => supplierIdsInCatalog.has(s.id) || s.id === supplierId,
  );

  const catalogProducts: CatalogProduct[] = products.map((p) => {
    const cat = categoryMap.get(p.categoryId);
    return {
      id: p.id,
      sku: p.sku,
      name: localizeField(locale as Locale, p.nameEn, p.nameZh),
      // The other language's name, so a row can carry both and a search can
      // match either — the supplier writes the Chinese one on the box.
      altName: altName(locale as Locale, p.nameEn, p.nameZh),
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
            return s ? localizeField(locale as Locale, s.companyName, s.companyNameZh) : null;
          })()
        : null,
      supplierBooth: p.supplierId
        ? supplierMap.get(p.supplierId)?.boothLocation || null
        : null,
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
    <div className="mx-auto max-w-6xl px-4 py-4 md:py-6">
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[23px] font-extrabold tracking-tight text-ink">{t("title")}</h1>
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
          {/* On a phone the FAB is how a product is registered; this button is
              for the desktop, where nothing floats. */}
          <Button asChild size="sm" className="hidden md:inline-flex">
            <Link href="/catalog/new">{t("addProduct")}</Link>
          </Button>
        </div>
      </div>

      <CatalogList
        products={catalogProducts}
        filters={
          // Keyed because it crosses the server/client boundary as a prop:
          // React reconciles it as a list child on the way through.
          <CatalogControls
            key="catalog-filters"
            categories={categories}
            suppliers={filterSuppliers}
            locale={locale}
          />
        }
      />

      <CaptureFab />
    </div>
  );
}
