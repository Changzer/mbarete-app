"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Store, Clock, CheckCircle2, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isStaleQuote } from "@/lib/offers";

/**
 * What the catalog shows about who sells this product.
 *
 * Already ranked by the query layer, so the first entry is the one to lead
 * with: its price large, everyone else's small beside it with the gap
 * spelled out as a percentage. The gap is the decision — an 8% saving is
 * worth a phone call, 1% is not worth leaving a factory that has never let
 * you down.
 */

export type CardOffer = {
  id: number;
  supplierId: number | null;
  supplierName: string | null;
  price: number;
  currency: string;
  moq: number;
  leadTimeDays: number;
  quotedOn: string;
  timesOrdered: number;
  /** Comparable value in the ranking basis, for working out the gap. */
  comparable: number;
};

const pct = (best: number, other: number) =>
  best > 0 ? Math.round(((other - best) / best) * 100) : 0;

export function SupplierPrices({
  offers,
  sellPrice,
  compact = false,
}: {
  offers: CardOffer[];
  sellPrice: number;
  /**
   * The card tile: prices only, no controls. The whole tile is already a
   * button that opens the product, and the full comparison lives in there.
   */
  compact?: boolean;
}) {
  const t = useTranslations("catalog");
  const [open, setOpen] = useState(false);

  if (offers.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400" data-testid="no-offers">
        {t("noSuppliers")}
      </p>
    );
  }

  const [best, ...rest] = offers;
  const stale = isStaleQuote(best.quotedOn);

  if (compact) {
    return (
      <div className="flex flex-col gap-0.5" data-testid="supplier-prices">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span
            className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
            data-testid="best-price"
          >
            {best.price.toFixed(2)} {best.currency}
          </span>
          {rest.slice(0, 3).map((o) => (
            <span key={o.id} className="text-[11px] text-neutral-400 dark:text-neutral-500">
              +{pct(best.comparable, o.comparable)}%
            </span>
          ))}
          {rest.length > 3 ? (
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
              +{rest.length - 3}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className="truncate">{best.supplierName ?? t("supplierUnknown")}</span>
          <span>· {t("moq")} {best.moq}</span>
          {offers.length > 1 ? (
            <span className="text-neutral-400 dark:text-neutral-500">
              · {t("supplierCount", { count: offers.length })}
            </span>
          ) : null}
          {best.timesOrdered > 0 ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          ) : null}
          {stale ? <Clock className="h-3 w-3 text-amber-500" /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-testid="supplier-prices-full">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className="text-xl font-semibold text-neutral-900 dark:text-neutral-100"
          data-testid="best-price"
        >
          {best.price.toFixed(2)} {best.currency}
        </span>
        {/* Everyone else, small, with the gap that matters. */}
        {rest.map((o) => (
          <span key={o.id} className="text-xs text-neutral-400 dark:text-neutral-500">
            {o.price.toFixed(2)} (+{pct(best.comparable, o.comparable)}%)
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="inline-flex items-center gap-1">
          <Store className="h-3 w-3" />
          {best.supplierName ?? t("supplierUnknown")}
        </span>
        <span>· {t("moq")} {best.moq}</span>
        {best.leadTimeDays > 0 ? <span>· {t("leadDays", { days: best.leadTimeDays })}</span> : null}
        {best.timesOrdered > 0 ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            {t("orderedBefore")}
          </span>
        ) : null}
        {stale ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <Clock className="h-3 w-3" />
            {t("staleQuote", { date: best.quotedOn })}
          </span>
        ) : null}
      </div>

      {offers.length > 1 ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-1 text-xs"
            onClick={() => setOpen((v) => !v)}
            data-testid="compare-suppliers"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
            {t("compareSuppliers", { count: offers.length })}
          </Button>
        </div>
      ) : null}

      {open ? (
        <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            {t("compareHelp")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="compare-table">
              <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t("supplier")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("cost")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("vsBest")}</th>
                  {sellPrice > 0 ? (
                    <th className="py-2 pr-3 text-right whitespace-nowrap font-medium">
                      {t("marginPerUnit")}
                    </th>
                  ) : null}
                  <th className="py-2 pr-3 text-right font-medium">{t("moq")}</th>
                  <th className="py-2 pr-3 text-right whitespace-nowrap font-medium">{t("leadTime")}</th>
                  <th className="py-2 pr-3 whitespace-nowrap font-medium">{t("quotedOn")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {offers.map((o, i) => (
                  <tr key={o.id} className={i === 0 ? "font-medium" : undefined}>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {o.supplierName ?? t("supplierUnknown")}
                      {o.timesOrdered > 0 ? (
                        <Badge variant="success" className="ml-2">
                          {t("orderedBefore")}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {o.price.toFixed(2)} {o.currency}
                    </td>
                    <td className="py-2 pr-3 text-right text-neutral-500 dark:text-neutral-400">
                      {i === 0 ? "—" : `+${pct(best.comparable, o.comparable)}%`}
                    </td>
                    {/* Margin is the real comparison: cost is only half of it. */}
                    {sellPrice > 0 ? (
                      <td className="py-2 pr-3 text-right whitespace-nowrap font-medium">
                        {(sellPrice - o.price).toFixed(2)}
                      </td>
                    ) : null}
                    <td className="py-2 pr-3 text-right">{o.moq}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                      {o.leadTimeDays > 0 ? t("leadDays", { days: o.leadTimeDays }) : "—"}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-neutral-500 dark:text-neutral-400">
                      {o.quotedOn}
                      {isStaleQuote(o.quotedOn) ? (
                        <Clock className="ml-1 inline h-3 w-3 text-amber-500" />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
