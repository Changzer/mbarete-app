import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  getCategories,
  getProducts,
  getSupplierIdsInCatalog,
} from "@/lib/queries/catalog";
import { getSuppliersForPicker } from "@/lib/queries/contacts";
import { countOpenDrafts } from "@/lib/queries/drafts";
import { toCatalogProducts } from "@/lib/queries/catalog-view";
import type { Locale } from "@/i18n/routing";
import { CatalogControls } from "@/components/catalog/catalog-controls";
import { type CatalogProduct } from "@/components/catalog/product-card";
import { CatalogList } from "@/components/catalog/catalog-list";
import { CaptureFab } from "@/components/catalog/capture-fab";
import { CatalogSnapshot } from "@/components/offline/catalog-snapshot";
import { Button } from "@/components/ui/button";
import { SavedToast } from "@/components/ui/saved-toast";
import { requireUser } from "@/lib/authz";

/**
 * The name in the language the page is *not* in, so a row can carry both.
 * Empty when a product was registered in one language only, or when the two
 * names are the same string — repeating it would just be noise in the row.
 */
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

  const { companyId, id: userId } = await requireUser();
  const categories = await getCategories(companyId);
  const openDrafts = await countOpenDrafts(companyId);
  const categoryId = category ? Number(category) : undefined;
  const supplierId = positiveId(supplier);
  const products = await getProducts(companyId, {
    categoryId,
    supplierId,
    sort: sort === "price-asc" ? "price-asc" : "default",
  });

  const suppliers = await getSuppliersForPicker(companyId);

  // The filter offers only suppliers that have products — plus whichever one is
  // currently selected, so a filter that has gone empty still names itself
  // rather than silently reading "all suppliers".
  const supplierIdsInCatalog = await getSupplierIdsInCatalog(companyId);
  const filterSuppliers = suppliers.filter(
    (s) => supplierIdsInCatalog.has(s.id) || s.id === supplierId,
  );

  const catalogProducts: CatalogProduct[] = await toCatalogProducts(companyId, locale as Locale, products);

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 md:py-6">
      {/* Landing here from a save (?saved=1) confirms it out loud. */}
      <SavedToast message={t("productSaved")} />
      {/* Every full catalog view refreshes the phone's offline copy. */}
      <CatalogSnapshot
        storageScope={`${companyId}:${userId}`}
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
