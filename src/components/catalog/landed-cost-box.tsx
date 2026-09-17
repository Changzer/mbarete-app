"use client";

import { useTranslations } from "next-intl";
import { SHIPPING_MODES, landedCostByMode, type RatesByMode, type ShippingMode } from "@/lib/landed-cost";
import type { CurrencyRates } from "@/lib/calculations";
import { formatMoney } from "@/lib/money";
import { normalizeDecimalInput } from "@/lib/decimal-input";

/**
 * The arriving cost per piece, as the four inputs stand right now, with
 * what it is made of and what it could not include.
 */
export function LandedCostBox({
  priceText,
  currency,
  cartonCbm,
  qtyPerBox,
  dutyText,
  shipping: byMode,
  rates,
  target,
  estimatedCarton = false,
}: {
  priceText: string;
  currency: string;
  cartonCbm: number;
  qtyPerBox: number;
  dutyText: string;
  shipping: RatesByMode;
  rates: CurrencyRates;
  target: string;
  estimatedCarton?: boolean;
}) {
  const t = useTranslations("catalog");
  const unitCost = Number(normalizeDecimalInput(priceText)) || 0;
  const dutyNum = dutyText.trim() === "" ? null : Number(normalizeDecimalInput(dutyText));
  const result = landedCostByMode(
    {
      unitCost,
      costCurrency: currency,
      cartonCbm,
      qtyPerBox,
      dutyPct: dutyNum !== null && Number.isFinite(dutyNum) ? dutyNum : null,
      target,
      rates,
    },
    byMode,
  );
  const money = (n: number | null) => n === null ? "—" : `${n.toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 4,
  })} ${target}`;
  // What is missing for both modes alike is said once; a missing rate is said per mode.
  const shared = result.lcl.missing.filter((x) => x !== "rate" && result.fcl.missing.includes(x));
  const withRate = SHIPPING_MODES.filter((m) => byMode[m]);
  const cheaper: ShippingMode | null =
    result.lcl.total !== null && result.fcl.total !== null && result.lcl.total !== result.fcl.total
      ? (result.lcl.total < result.fcl.total ? "lcl" : "fcl") : null;
  return (
    <div
      className="flex min-w-0 flex-col gap-3 rounded-[10px] border border-line bg-surface-2 p-3 sm:col-span-2"
      data-testid="landed-cost"
    >
      <span className="text-[13px] font-semibold text-ink">{t("landedCost")}</span>
      <table className="w-full table-fixed text-[12px] text-sub">
        <thead>
          <tr>
            <th scope="col" className="w-[36%] text-left font-normal">
              <span className="sr-only">{t("landedLine")}</span>
            </th>
            {SHIPPING_MODES.map((m) => (
              <th key={m} scope="col" className="pb-0.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">
                {t(`mode_${m}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="text-left font-normal">
              {t("landedUnitCost")}
            </th>
            {SHIPPING_MODES.map((m) => (
              <td key={m} className="text-right tabular-nums">
                {money(result[m].unitCost)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="text-left font-normal">
              {t("landedShipping")}
            </th>
            {SHIPPING_MODES.map((m) => (
              <td key={m} className="text-right tabular-nums" data-testid={`landed-shipping-${m}`}>
                {money(result[m].shipping)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="text-left font-normal">
              {t("landedDuty")}
            </th>
            {SHIPPING_MODES.map((m) => (
              <td key={m} className="text-right tabular-nums">
                {money(result[m].duty)}
              </td>
            ))}
          </tr>
          <tr className="border-t border-line">
            <th scope="row" className="pt-1 text-left font-semibold text-ink">
              {t("landedTotal")}
            </th>
            {SHIPPING_MODES.map((m) => (
              <td key={m} className="pt-1 text-right">
                <span
                  className={`break-words text-[14px] font-extrabold tabular-nums sm:text-[17px] ${result[m].total !== null ? "text-ink" : "text-faint"}`}
                  data-testid={`landed-total-${m}`}
                >
                  {money(result[m].total)}
                </span>
                {cheaper === m ? (
                  <span className="mt-1 block text-[10px] font-semibold text-ok" data-testid="landed-cheaper">
                    {t("landedCheaper")}
                  </span>
                ) : null}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {SHIPPING_MODES.some((m) => result[m].missing.length > 0) ? (
        <p className="text-[11px] leading-snug text-warn" data-testid="landed-missing">
          {[
            ...shared.map((m) => t(`landedMissing_${m}`)),
            ...SHIPPING_MODES.flatMap((mode) => result[mode].missing.filter((item) => !shared.includes(item)).map((item) =>
              item === "rate" ? t("landedMissing_rate", { mode: t(`mode_${mode}`) })
                : `${t(`mode_${mode}`)}: ${t(`landedMissing_${item}`)}`,
            )),
          ].join(" · ")}
        </p>
      ) : null}
      <p className="text-[12px] leading-relaxed text-sub" data-testid="landed-scope">{t("landedScope")}</p>
      {byMode.fcl ? <p className="text-[12px] leading-relaxed text-sub" data-testid="landed-fcl-assumption">
        {t("landedFclAssumption", { cbm: byMode.fcl.usableCbm })}
      </p> : null}
      {estimatedCarton ? <p className="text-[12px] text-warn">{t("landedEstimatedCarton")}</p> : null}
      {withRate.length > 0 ? (
        <p className="text-[10.5px] leading-snug text-faint">
          {withRate
            .map((m) => {
              const rate = byMode[m]!;
              return t("landedRateNote", {
                mode: t(`mode_${m}`),
                amount: formatMoney(rate.amount, rate.currency),
                basis: t(`basis_${rate.basis}`),
                date: rate.effectiveFrom,
              });
            })
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
