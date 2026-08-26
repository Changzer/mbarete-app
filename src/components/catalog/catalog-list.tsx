"use client";

import { useMemo, useState } from "react";
import { PackageSearch, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchBar } from "@/components/ui/search-bar";
import { OfflineStrip } from "@/components/offline/offline-strip";
import { ProductCard, type CatalogProduct } from "@/components/catalog/product-card";

/**
 * Search runs on the phone, over the rows already on screen.
 *
 * A round trip per keystroke would be the wrong trade in a market hall where
 * the signal comes and goes: the whole catalog for a filter is already here,
 * so matching it locally is instant and keeps working when the server does not.
 */
function matches(product: CatalogProduct, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    product.name,
    product.altName,
    product.sku,
    product.supplierName ?? "",
    product.supplierBooth ?? "",
  ].some((field) => field.toLowerCase().includes(needle));
}

export function CatalogList({
  products,
  filters,
}: {
  products: CatalogProduct[];
  /** The category/supplier/sort controls, rendered under the search field. */
  filters?: React.ReactNode;
}) {
  const t = useTranslations("catalog");
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () => products.filter((p) => matches(p, query)),
    [products, query],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* One row on a desktop — search stretching, filters trailing — and
          the phone's stack below lg, where width is the scarce thing. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder={t("search")}
          recentKey="mb-catalog-recent"
          recentLabel={t("searchRecent")}
          clearLabel={t("searchClear")}
          className="lg:min-w-0 lg:flex-1"
        />

        {filters}
      </div>

      <OfflineStrip />

      {products.length === 0 ? (
        <EmptyState
          icon={<PackageSearch strokeWidth={1.5} />}
          title={t("emptyTitle")}
          hint={t("emptyHint")}
          data-testid="catalog-empty"
          action={
            <Button asChild size="sm">
              <Link href="/catalog/new">{t("addProduct")}</Link>
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<SearchX strokeWidth={1.5} />}
          title={t("noResultsFor", { query })}
          hint={t("noResultsHint")}
          data-testid="catalog-no-results"
          action={
            <Button variant="outline" size="sm" onClick={() => setQuery("")}>
              {t("searchClear")}
            </Button>
          }
        />
      ) : (
        <>
          {/*
            Rows on a phone; from `md` the same row card pairs up into two
            columns; from `xl` the list becomes a table, which is what a desk
            with a mouse and a wide screen actually wants to scan.
          */}
          <div
            className="flex flex-col gap-2 md:grid md:grid-cols-2 xl:hidden"
            data-testid="catalog-rows"
          >
            {visible.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          <CatalogTable products={visible} />
        </>
      )}
    </div>
  );
}

/**
 * The desktop treatment: the same registers and the same chips as the row,
 * laid out in columns. Each row still opens the same detail dialog, so there
 * is one place a product is edited regardless of how it was found.
 */
function CatalogTable({ products }: { products: CatalogProduct[] }) {
  const t = useTranslations("catalog");
  return (
    <div className="hidden overflow-x-auto rounded-[12px] border border-line bg-surface xl:block">
      {/* Fixed layout: auto-sizing let each column's widest content set its
          width, so the grid shifted with the data — headers seemed to float
          over nothing. Data columns get set widths; the name takes the rest. */}
      <table className="w-full min-w-[880px] table-fixed text-left">
        <thead>
          <tr className="border-b border-line font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-sub">
            <th className="px-3 py-2.5 font-bold">{t("columnProduct")}</th>
            <th className="w-24 px-3 py-2.5 font-bold">{t("sku")}</th>
            <th className="w-28 px-3 py-2.5 font-bold">{t("price")}</th>
            <th className="w-48 whitespace-nowrap px-3 py-2.5 font-bold">
              {t("moq")} · {t("qtyPerBox")}
            </th>
            <th className="w-44 px-3 py-2.5 font-bold">{t("supplier")}</th>
            <th className="w-36 px-3 py-2.5 text-right font-bold">{t("status")}</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <ProductCard key={p.id} product={p} variant="table" />
          ))}
        </tbody>
      </table>
    </div>
  );
}
