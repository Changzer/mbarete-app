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

export type SupplierOption = {
  id: number;
  companyName: string;
  companyNameZh: string;
  phone: string;
  boothLocation: string;
};

/** The company name in whichever language exists. */
export function supplierLabel(s: SupplierOption) {
  return s.companyName || s.companyNameZh;
}

/**
 * Searchable supplier picker. A plain select breaks down past a dozen
 * suppliers on a phone: this opens a dialog with a search box filtering by
 * name (either language), booth or phone. The trigger shows only the company
 * name; the booth appears as a second line inside the list, where there is
 * room for it.
 *
 * Serves both jobs the app has for a supplier list: assigning one to a product
 * (where the empty choice is "no supplier", value "0") and filtering the
 * catalog by one (where it is "all suppliers") — hence the configurable empty
 * row.
 */
export function SupplierPicker({
  suppliers,
  value,
  onChange,
  emptyValue = "0",
  emptyLabel,
  className,
  "data-testid": testId = "supplier-picker",
}: {
  suppliers: SupplierOption[];
  /** Selected supplier id as a string; `emptyValue` means none selected. */
  value: string;
  onChange: (value: string) => void;
  /** Value standing for "nothing selected". Defaults to "0". */
  emptyValue?: string;
  /** Label for that choice. Defaults to "No supplier". */
  emptyLabel?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = suppliers.find((s) => String(s.id) === value);
  const emptyText = emptyLabel ?? t("noSupplier");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) =>
      [s.companyName, s.companyNameZh, s.boothLocation, s.phone].some((field) =>
        field.toLowerCase().includes(q),
      ),
    );
  }, [suppliers, query]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={testId}
        className={cn(
          "flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 text-sm text-ink",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Search className="h-4 w-4 shrink-0 opacity-50" />
          <span className="truncate">
            {selected ? supplierLabel(selected) : emptyText}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t("supplier")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={common("search")}
            data-testid="supplier-search"
          />
          <div className="-mx-2 flex-1 overflow-y-auto">
            <SupplierRow
              label={emptyText}
              selected={value === emptyValue}
              onClick={() => pick(emptyValue)}
            />
            {filtered.map((s) => (
              <SupplierRow
                key={s.id}
                label={supplierLabel(s)}
                detail={s.boothLocation || s.phone}
                selected={String(s.id) === value}
                onClick={() => pick(String(s.id))}
              />
            ))}
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-sm text-sub">
                {t("noSupplierMatches")}
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SupplierRow({
  label,
  detail,
  selected,
  onClick,
}: {
  label: string;
  detail?: string;
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
      <span className="min-w-0">
        <span className="block truncate text-sm text-ink">
          {label}
        </span>
        {detail ? (
          <span className="block truncate text-xs text-sub">
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}
