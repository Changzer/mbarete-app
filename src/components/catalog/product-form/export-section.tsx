"use client";

import type { RefObject } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/disclosure";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LandedCostBox } from "@/components/catalog/landed-cost-box";
import { DESTINATIONS, type Destination, type RatesByMode } from "@/lib/landed-cost";
import type { CurrencyRates } from "@/lib/calculations";
import { readErrorKey } from "./submit-checks";
import type { DutySuggestions, ProductFormValues } from "./shared";
import type { PhotoReading } from "./use-photo-reading";

export type CustomsUnit = "pcs" | "set" | "pair";

/**
 * Optional office work: the import side (NCM, destination, duty, the landed
 * cost it adds up to) and the Chinese export declaration. Mounted fields keep
 * their values while folded.
 */
export function ExportSection({
  detailsRef,
  defaults,
  canSuggestNcm,
  reading,
  destination,
  onDestinationChange,
  dutyBr,
  onDutyBrChange,
  dutyPy,
  onDutyPyChange,
  suggestedDuties,
  onSuggestedDutiesChange,
  customsUnit,
  onCustomsUnitChange,
  landedCost,
}: {
  detailsRef: RefObject<HTMLDetailsElement | null>;
  defaults?: Partial<ProductFormValues>;
  /** "Suggest NCM" needs photos already stored and a reader to read them. */
  canSuggestNcm: boolean;
  reading: PhotoReading;
  destination: "" | Destination;
  onDestinationChange: (value: "" | Destination) => void;
  dutyBr: string;
  onDutyBrChange: (value: string) => void;
  dutyPy: string;
  onDutyPyChange: (value: string) => void;
  suggestedDuties: DutySuggestions;
  onSuggestedDutiesChange: (next: DutySuggestions | ((prev: DutySuggestions) => DutySuggestions)) => void;
  customsUnit: CustomsUnit;
  onCustomsUnitChange: (value: CustomsUnit) => void;
  landedCost: {
    priceText: string;
    currency: string;
    cartonCbm: number;
    estimatedCarton: boolean;
    qtyPerBox: number;
    shippingRates: Partial<Record<Destination, RatesByMode>>;
    rates: CurrencyRates;
    target: string;
  };
}) {
  const t = useTranslations("catalog");
  const setDuty = destination === "BR" ? onDutyBrChange : onDutyPyChange;

  return (
    <details ref={detailsRef} className="group rounded-[12px] border border-line bg-surface lg:col-span-2" data-testid="export-details">
      <summary className="focus-ring flex min-h-14 cursor-pointer list-none items-center gap-3 px-3.5 [&::-webkit-details-marker]:hidden" data-testid="export-disclosure">
        <span className="min-w-0 flex-1 py-2">
          <span className="block text-[13.5px] font-bold text-ink">{t("exportGroup")}</span>
          <span className="block text-[11px] text-sub">{t("exportHint")}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-faint group-open:rotate-180" />
      </summary>
      <div className="grid grid-cols-1 gap-4 border-t border-line p-3.5 sm:grid-cols-2">
        <Field label={t("hsCode")} htmlFor="hsCode" hint={t("hsCodeHelp")}>
          <Input
            id="hsCode"
            name="hsCode"
            inputMode="numeric"
            placeholder={t("optionalPlaceholder")}
            defaultValue={defaults?.hsCode}
            className="font-mono"
            onChange={() => onSuggestedDutiesChange({})}
            data-testid="hs-code"
          />
          {canSuggestNcm ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={reading.ncmPending || reading.pending}
                onClick={reading.suggestNcm}
                data-testid="suggest-ncm"
                className="mt-1 w-fit"
              >
                {reading.ncmPending ? (
                  <Loader2 className="h-4 w-4 animate-[spin_2.4s_linear_infinite]" strokeWidth={1.5} />
                ) : (
                  <Sparkles className="h-4 w-4" strokeWidth={1.5} />
                )}
                {reading.ncmPending ? t("suggestNcmPending") : t("suggestNcm")}
              </Button>
              {reading.ncmError ? (
                <p className="text-[12px] font-semibold text-danger" data-testid="suggest-ncm-error">
                  {t(readErrorKey(reading.ncmError))}
                </p>
              ) : null}
            </>
          ) : null}
        </Field>
        <Field label={t("destination")} htmlFor="exportDestination">
          <input type="hidden" name="exportDestination" value={destination} />
          <Select value={destination || "none"} onValueChange={(v) => onDestinationChange(v === "BR" || v === "PY" ? v : "")}>
            <SelectTrigger id="exportDestination" data-testid="export-destination">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("chooseDestination")}</SelectItem>
              {DESTINATIONS.map((d) => (
                <SelectItem key={d} value={d}>
                  {t(`destination_${d}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <input type="hidden" name="importDutyPctBr" value={dutyBr} />
        <input type="hidden" name="importDutyPctPy" value={dutyPy} />
        {destination ? <Field label={t("importDuty", { destination: t(`destination_${destination}`) })} htmlFor="importDuty" hint={t("importDutyHelp")}>
          <Input
            id="importDuty"
            type="text"
            numeric
            inputMode="decimal"
            suffix="%"
            placeholder="18"
            value={destination === "BR" ? dutyBr : dutyPy}
            onChange={(e) => setDuty(e.target.value)}
            data-testid="import-duty"
          />
          {suggestedDuties[destination] !== undefined ? (
            <div className="rounded-lg bg-surface-2 p-2.5 text-[12px] text-sub" data-testid="duty-suggestion">
              <p>{t("dutySuggestion", { pct: suggestedDuties[destination]! })}</p>
              <Button type="button" variant="outline" className="mt-2 min-h-11" data-testid="use-duty-suggestion"
                onClick={() => {
                  setDuty(String(suggestedDuties[destination]));
                  onSuggestedDutiesChange((previous) => ({ ...previous, [destination]: undefined }));
                }}>
                {t("useDutySuggestion")}
              </Button>
            </div>
          ) : null}
        </Field> : null}
        {destination ? <LandedCostBox
          priceText={landedCost.priceText}
          currency={landedCost.currency}
          cartonCbm={landedCost.cartonCbm}
          estimatedCarton={landedCost.estimatedCarton}
          qtyPerBox={landedCost.qtyPerBox}
          dutyText={destination === "BR" ? dutyBr : dutyPy}
          shipping={landedCost.shippingRates[destination] ?? {}}
          rates={landedCost.rates}
          target={landedCost.target}
        /> : null}
        {/* What the Chinese side of the border files: China's own code,
            the declaration elements and the unit the quantity is declared
            in. They feed the customs pack's 报关单. */}
        <div className="flex flex-col gap-3 border-t border-line pt-3 sm:col-span-2" data-testid="cn-declaration">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-sub">{t("cnDeclarationGroup")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("cnHsCode")} htmlFor="cnHsCode" hint={t("cnHsCodeHelp")}>
              <Input
                id="cnHsCode"
                name="cnHsCode"
                inputMode="numeric"
                placeholder={t("optionalPlaceholder")}
                defaultValue={defaults?.cnHsCode}
                className="font-mono"
                data-testid="cn-hs-code"
              />
            </Field>
            <Field label={t("customsUnit")} htmlFor="customsUnit">
              <input type="hidden" name="customsUnit" value={customsUnit} />
              <Select value={customsUnit} onValueChange={(v) => onCustomsUnitChange(v === "set" || v === "pair" ? v : "pcs")}>
                <SelectTrigger id="customsUnit" data-testid="customs-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["pcs", "set", "pair"] as const).map((u) => (
                    <SelectItem key={u} value={u}>
                      {t(`customsUnit_${u}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("declarationElements")} htmlFor="declarationElements" hint={t("declarationElementsHelp")} className="sm:col-span-2">
              <Textarea
                id="declarationElements"
                name="declarationElements"
                rows={2}
                maxLength={500}
                placeholder={t("optionalPlaceholder")}
                defaultValue={defaults?.declarationElements}
                data-testid="declaration-elements"
              />
            </Field>
          </div>
        </div>
      </div>
    </details>
  );
}
