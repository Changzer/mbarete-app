"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowDownNarrowWide } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { CategoryPicker } from "@/components/catalog/category-picker";
import {
  SupplierPicker,
  type SupplierOption,
} from "@/components/catalog/supplier-picker";

type Category = { id: number; nameEn: string; nameZh: string };

/**
 * The catalog's filters: category, supplier, and one sort.
 *
 * Category and supplier are both searchable pickers, so the two filters read
 * as a pair and neither pushes the catalog below the fold on a phone — a lane
 * of chips scrolled sideways past the fourth category and cost most of the
 * first screen. Sort stays a single chip, because there are only two orders
 * worth having.
 */
export function CatalogControls({
  categories,
  suppliers,
  locale,
}: {
  categories: Category[];
  suppliers: SupplierOption[];
  locale: string;
}) {
  const t = useTranslations("catalog");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The filters stay tappable while the catalog behind them re-renders;
  // without this the controls go inert for a moment after every change.
  const [, startTransition] = useTransition();

  const currentCategory = searchParams.get("category") ?? "all";
  const currentSupplier = searchParams.get("supplier") ?? "all";
  const currentSort = searchParams.get("sort") ?? "default";

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all" || value === "default") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <CategoryPicker
        categories={categories}
        value={currentCategory}
        onChange={(v) => updateParam("category", v)}
        locale={locale}
        className="w-full"
      />

      <div className="flex items-center gap-2">
        {/* Same searchable dialog as the product form — a market run registers
            far too many booths for a plain select to stay usable. */}
        <SupplierPicker
          suppliers={suppliers}
          value={currentSupplier}
          onChange={(v) => updateParam("supplier", v)}
          emptyValue="all"
          emptyLabel={t("allSuppliersChip")}
          className="min-w-0 flex-1 md:max-w-64"
          data-testid="supplier-filter"
        />
        <Chip
          selected={currentSort === "price-asc"}
          data-testid="sort-price"
          aria-label={t("sortPriceAsc")}
          onClick={() =>
            updateParam("sort", currentSort === "price-asc" ? "default" : "price-asc")
          }
        >
          <ArrowDownNarrowWide strokeWidth={1.5} />
          {t("price")}
        </Chip>
      </div>
    </div>
  );
}
