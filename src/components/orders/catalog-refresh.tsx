"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  previewCatalogRefresh,
  applyCatalogRefresh,
  type LineRefreshDiff,
} from "@/lib/actions/orders";
import { formatCbm } from "@/lib/calculations";

/**
 * The deliberate half of line snapshots: the button that pulls an order's
 * lines up to date with the catalog. Always preview-then-confirm — a
 * confirmed quote must never move without someone choosing it — and the
 * dialog says exactly what will change before anything does. Quantities and
 * sell prices are not the catalog's to touch and never appear here.
 */
export function CatalogRefresh({ orderId }: { orderId: number }) {
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [diffs, setDiffs] = useState<LineRefreshDiff[] | null>(null);
  const [note, setNote] = useState<"none" | "done" | "failed" | null>(null);

  function check() {
    setNote(null);
    startTransition(async () => {
      const result = await previewCatalogRefresh(orderId);
      if (result.error || !result.diffs) return setNote("failed");
      if (result.diffs.length === 0) return setNote("none");
      setDiffs(result.diffs);
    });
  }

  function apply() {
    startTransition(async () => {
      const result = await applyCatalogRefresh(orderId);
      setDiffs(null);
      setNote(result.error ? "failed" : "done");
      if (!result.error) router.refresh();
    });
  }

  return (
    <>
      {/* A utility, not a workflow step — ghost keeps it out of the way. */}
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={check}
        data-testid="catalog-refresh"
      >
        <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} strokeWidth={1.5} />
        {t("refreshCatalog")}
      </Button>
      {note ? (
        <p
          className={`text-[11.5px] ${note === "failed" ? "text-danger" : "text-sub"}`}
          data-testid="catalog-refresh-note"
        >
          {note === "none" ? t("refreshNoChanges") : note === "done" ? t("refreshApplied") : t("refreshFailed")}
        </p>
      ) : null}

      <Dialog open={diffs !== null} onOpenChange={(open) => !open && setDiffs(null)}>
        <DialogContent data-testid="catalog-refresh-dialog">
          <DialogTitle>{t("refreshTitle")}</DialogTitle>
          <p className="text-[12.5px] leading-relaxed text-sub">{t("refreshHelp")}</p>
          <ul className="flex flex-col gap-3">
            {(diffs ?? []).map((d) => (
              <li key={d.sku} className="rounded-[10px] border border-line bg-surface-2 p-3">
                <div className="text-[13.5px] font-bold text-ink">
                  {d.name} <span className="font-mono text-[11px] font-normal text-sub">{d.sku}</span>
                </div>
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[12px] text-sub">
                  {d.cost ? (
                    <li>
                      {t("refreshCost")}: {d.cost.from.toFixed(2)} {d.cost.fromCurrency} →{" "}
                      <b className="text-ink">
                        {d.cost.to.toFixed(2)} {d.cost.toCurrency}
                      </b>
                    </li>
                  ) : null}
                  {d.cbm ? (
                    <li>
                      CBM: {formatCbm(d.cbm.from)} →{" "}
                      <b className="text-ink">{formatCbm(d.cbm.to)}</b> m³
                    </li>
                  ) : null}
                  {d.weightKg ? (
                    <li>
                      {t("refreshWeight")}: {d.weightKg.from.toFixed(2)} →{" "}
                      <b className="text-ink">{d.weightKg.to.toFixed(2)}</b> kg
                    </li>
                  ) : null}
                  {d.cartons ? (
                    <li>
                      {t("refreshCartons")}: {d.cartons.from} →{" "}
                      <b className="text-ink">{d.cartons.to}</b>
                    </li>
                  ) : null}
                  {d.moq ? (
                    <li>
                      MOQ: {d.moq.from} → <b className="text-ink">{d.moq.to}</b>
                    </li>
                  ) : null}
                </ul>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-sub">{t("refreshKeeps")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDiffs(null)}>
              {common("cancel")}
            </Button>
            <Button size="sm" disabled={isPending} onClick={apply} data-testid="catalog-refresh-apply">
              {t("refreshApply")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
