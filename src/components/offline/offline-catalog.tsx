"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  loadCatalogSnapshot,
  type CatalogSnapshot,
} from "@/lib/client/catalog-cache";
import { formatLocalMinute } from "@/lib/format-time";

/**
 * The phone's read-only catalog copy, as a sheet over whatever page is open.
 *
 * A sheet and not a page on purpose: with no connection, no new page can
 * load — this app is served over plain HTTP, where no service worker can
 * stand in for the server — so the offline catalog has to live inside the
 * page the agent already has open. It is reachable from the status strip,
 * which is on every page.
 */
export function OfflineCatalog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("offline");
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null | undefined>(undefined);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadCatalogSnapshot()
      .then((loaded) => {
        if (!cancelled) setSnapshot(loaded ?? null);
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const products = snapshot?.products ?? [];
    if (!needle) return products;
    return products.filter((p) =>
      [p.name, p.sku, p.categoryName, p.supplierName ?? "", p.supplierBooth ?? ""]
        .join("\n")
        .toLowerCase()
        .includes(needle),
    );
  }, [snapshot, needle]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("catalogCopyTitle")}</DialogTitle>
        </DialogHeader>

        {snapshot === null ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {t("catalogCopyEmpty")}
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("catalogCopySearch")}
                className="pl-9"
              />
            </div>
            {snapshot ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {t("catalogCopyAsOf", { time: formatLocalMinute(snapshot.savedAt) })}
              </p>
            ) : null}
            <div className="-mx-1 flex-1 overflow-y-auto px-1" data-testid="offline-catalog-list">
              {rows.map((p) => (
                <div
                  key={p.id}
                  className="border-b border-neutral-100 py-2.5 text-sm last:border-0 dark:border-neutral-800"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-neutral-900 dark:text-neutral-100">
                      {p.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-neutral-900 dark:text-neutral-100">
                      {p.price} {p.currency}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-neutral-500 dark:text-neutral-400">
                    <span>{p.sku}</span>
                    <span>{p.categoryName}</span>
                    <span>{t("catalogCopyMoqBox", { moq: p.moq, qty: p.qtyPerBox })}</span>
                    {p.supplierName ? <span>{p.supplierName}</span> : null}
                    {p.supplierBooth ? <span>{p.supplierBooth}</span> : null}
                  </div>
                </div>
              ))}
              {rows.length === 0 && snapshot ? (
                <p className="py-4 text-sm text-neutral-500 dark:text-neutral-400">
                  {t("catalogCopyNoMatch")}
                </p>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
