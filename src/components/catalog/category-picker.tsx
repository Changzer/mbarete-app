"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type CategoryOption = { id: number; nameEn: string; nameZh: string };

/**
 * Category filter, shaped like the supplier filter beside it.
 *
 * A lane of chips showed the whole list at once but pushed the catalog itself
 * below the fold on a phone and scrolled sideways past the fourth category.
 * One line that names the current filter is quieter, and the list still gets
 * to be complete inside the dialog.
 *
 * Tapping the row already selected clears the filter rather than re-applying
 * it, so getting back to everything never needs a hunt for "All".
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  locale,
  emptyValue = "all",
  className,
}: {
  categories: CategoryOption[];
  /** Selected category id as a string; `emptyValue` means no filter. */
  value: string;
  onChange: (value: string) => void;
  locale: string;
  emptyValue?: string;
  className?: string;
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const label = (c: CategoryOption) => (locale === "zh" ? c.nameZh : c.nameEn);
  const selected = categories.find((c) => String(c.id) === value);
  const emptyText = t("allCategories");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) =>
      [c.nameEn, c.nameZh].some((name) => name.toLowerCase().includes(q)),
    );
  }, [categories, query]);

  function pick(next: string) {
    // Choosing what is already chosen means "stop filtering by this".
    onChange(next === value ? emptyValue : next);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="category-filter"
        className={cn(
          "press focus-ring flex h-11 min-w-0 items-center justify-between gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Search className="h-4 w-4 shrink-0 opacity-50" />
          <span className="truncate">{selected ? label(selected) : emptyText}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t("category")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={common("search")}
            data-testid="category-search"
          />
          <div className="-mx-2 flex-1 overflow-y-auto">
            <CategoryRow
              label={emptyText}
              selected={value === emptyValue}
              onClick={() => pick(emptyValue)}
            />
            {filtered.map((c) => (
              <CategoryRow
                key={c.id}
                label={label(c)}
                selected={String(c.id) === value}
                onClick={() => pick(String(c.id))}
              />
            ))}
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-sm text-sub">{t("noCategoryMatches")}</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CategoryRow({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left hover:bg-surface-2"
    >
      <span className={`h-4 w-4 shrink-0 ${selected ? "" : "invisible"}`}>
        <Check className="h-4 w-4" />
      </span>
      <span className="min-w-0 truncate text-sm text-ink">{label}</span>
    </button>
  );
}
