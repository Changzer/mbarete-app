"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SupplierPicker,
  type SupplierOption,
} from "@/components/catalog/supplier-picker";

type Category = { id: number; nameEn: string; nameZh: string };

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
    <div className="flex flex-wrap items-center gap-3">
      <Select value={currentCategory} onValueChange={(v) => updateParam("category", v)}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("allCategories")}</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {locale === "zh" ? c.nameZh : c.nameEn}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Same searchable dialog as the product form — a market run registers
          far too many booths for a plain select to stay usable. */}
      <SupplierPicker
        suppliers={suppliers}
        value={currentSupplier}
        onChange={(v) => updateParam("supplier", v)}
        emptyValue="all"
        emptyLabel={t("allSuppliers")}
        className="w-48 flex-none"
        data-testid="supplier-filter"
      />

      <Select value={currentSort} onValueChange={(v) => updateParam("sort", v)}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{t("sortDefault")}</SelectItem>
          <SelectItem value="price-asc">{t("sortPriceAsc")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
