"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowDownNarrowWide } from "lucide-react";
import { Chip, ChipRow } from "@/components/ui/chip";
import {
  SupplierPicker,
  type SupplierOption,
} from "@/components/catalog/supplier-picker";

type Category = { id: number; nameEn: string; nameZh: string };

/**
 * Categories as a scrolling lane of chips rather than a dropdown.
 *
 * A dropdown hides how many categories there are and costs two taps to change;
 * chips show the shape of the catalog and cost one. Supplier stays a searchable
 * picker — a market run registers far more booths than a lane can hold — and
 * sort is a single chip, because there are only two orders worth having.
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
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <ChipRow data-testid="category-chips">
        <Chip
          selected={currentCategory === "all"}
          onClick={() => updateParam("category", "all")}
        >
          {t("allCategoriesChip")}
        </Chip>
        {categories.map((c) => (
          <Chip
            key={c.id}
            selected={currentCategory === String(c.id)}
            onClick={() => updateParam("category", String(c.id))}
          >
            {locale === "zh" ? c.nameZh : c.nameEn}
          </Chip>
        ))}
      </ChipRow>

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
