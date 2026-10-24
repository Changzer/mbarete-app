"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Disclosure, Field } from "@/components/ui/disclosure";
import { formatCbm, MAX_PLAUSIBLE_CARTON_CBM } from "@/lib/calculations";
import { blankIfZero, type ProductFormValues } from "./shared";
import type { Packaging } from "./use-packaging";

/**
 * Folded away by default. The carton/piece modes inside are unchanged —
 * only their placement is: a tape measure is not something a buyer has in
 * the aisle, and these ten fields used to sit between the price and the
 * Save button.
 */
export function PackagingSection({ defaults, packaging }: { defaults?: Partial<ProductFormValues>; packaging: Packaging }) {
  const t = useTranslations("catalog");
  const { source, setSource, piece, setPiece, allowance, setAllowance, cartonCbm } = packaging;

  // Editing something that has already been measured opens the disclosure: it
  // folds to keep a *new* capture short, not to hide figures already there.
  const hasDimensions = Boolean(
    defaults &&
      (defaults.lengthCm ||
        defaults.widthCm ||
        defaults.heightCm ||
        defaults.weightKg ||
        defaults.cbmOverride ||
        defaults.dimensionSource === "piece"),
  );

  return (
    <div className="lg:col-span-2">
      <Disclosure
        title={t("dimensionsDisclosure")}
        hint={t("dimensionsHint")}
        data-testid="dimensions-disclosure"
        defaultOpen={hasDimensions}
        keepMounted
      >
        <div className="flex flex-col gap-3">
          <Field label={t("dimensionSource")}>
            <input type="hidden" name="dimensionSource" value={source} />
            <div className="flex gap-1 rounded-[10px] border border-line bg-surface-2 p-1">
              {(["carton", "piece"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={source === mode}
                  onClick={() => setSource(mode)}
                  className={`press focus-ring min-h-11 flex-1 rounded-[8px] px-3 py-2 text-[12.5px] font-semibold ${
                    source === mode
                      ? "bg-action text-white"
                      : "text-sub hover:text-ink"
                  }`}
                >
                  {mode === "carton" ? t("haveCartonSize") : t("havePieceSizeOnly")}
                </button>
              ))}
            </div>
          </Field>

          <fieldset disabled={source !== "carton"} hidden={source !== "carton"} className="min-w-0 space-y-3">
              <p className="rounded-[10px] bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-sub">
                {t("cartonHelp")} {t("measurementsOptional")}
              </p>
              <div className="grid grid-cols-2 gap-3" onInput={packaging.updateCartonCbm}>
                {(
                  [
                    ["lengthCm", t("length"), defaults?.lengthCm, "cm"],
                    ["widthCm", t("width"), defaults?.widthCm, "cm"],
                    ["heightCm", t("height"), defaults?.heightCm, "cm"],
                    ["weightKg", t("weight"), defaults?.weightKg, "kg"],
                  ] as const
                ).map(([name, label, value, unit]) => (
                  <Field key={name} label={label} htmlFor={name}>
                    <Input
                      id={name}
                      name={name}
                      placeholder={t("optionalPlaceholder")}
                      type="text"
                      numeric
                      suffix={unit}
                      inputMode="decimal"
                      defaultValue={blankIfZero(value)}
                    />
                  </Field>
                ))}
                <Field
                  label={t("cbmOverride")}
                  htmlFor="cbmOverride"
                  hint={t("cbmOverrideHelp")}
                  className="col-span-2"
                >
                  <Input
                    id="cbmOverride"
                    name="cbmOverride"
                    placeholder={t("optionalPlaceholder")}
                    type="text"
                    numeric
                    suffix="m³"
                    inputMode="decimal"
                    defaultValue={blankIfZero(defaults?.cbmOverride)}
                  />
                </Field>
              </div>
              {cartonCbm > MAX_PLAUSIBLE_CARTON_CBM ? (
                <p
                  className="rounded-[10px] bg-warn-soft px-3 py-2 text-[11px] leading-relaxed text-warn"
                  data-testid="cbm-implausible"
                >
                  {t("cbmImplausible", { cbm: formatCbm(cartonCbm) })}
                </p>
              ) : null}
          </fieldset>
          <fieldset disabled={source !== "piece"} hidden={source !== "piece"} className="min-w-0 space-y-3">
              <p className="rounded-[10px] bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-sub">
                {t("pieceHelp")}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ["lengthCm", "pieceLengthCm", t("pieceLength"), "cm"],
                    ["widthCm", "pieceWidthCm", t("pieceWidth"), "cm"],
                    ["heightCm", "pieceHeightCm", t("pieceHeight"), "cm"],
                    ["weightKg", "pieceWeightKg", t("pieceWeight"), "kg"],
                  ] as const
                ).map(([key, name, label, unit]) => (
                  <Field key={name} label={label} htmlFor={name}>
                    <Input
                      id={name}
                      name={name}
                      type="text"
                      numeric
                      suffix={unit}
                      inputMode="decimal"
                      value={piece[key]}
                      onChange={(e) =>
                        setPiece((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                    />
                  </Field>
                ))}
                <Field
                  label={t("packingAllowance")}
                  htmlFor="packingAllowancePct"
                  hint={t("packingAllowanceHelp")}
                  className="col-span-2"
                >
                  <Input
                    id="packingAllowancePct"
                    name="packingAllowancePct"
                    type="text"
                    numeric
                    suffix="%"
                    inputMode="decimal"
                    value={allowance}
                    onChange={(e) => setAllowance(e.target.value)}
                  />
                </Field>
              </div>

              <div
                className="rounded-[10px] bg-warn-soft px-3 py-3 text-[13px] text-warn"
                data-testid="carton-estimate"
              >
                <p className="font-bold">{t("estimatedCarton")}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  <dt>{t("cbm")}</dt>
                  <dd className="text-right font-mono font-semibold" data-testid="estimated-cbm">
                    {formatCbm(packaging.estimatedCbm)} m³
                  </dd>
                  <dt>{t("weight")}</dt>
                  <dd className="text-right font-mono font-semibold" data-testid="estimated-weight">
                    {packaging.estimatedWeight.toFixed(2)} kg
                  </dd>
                </dl>
                <p className="mt-2 text-[11px] leading-relaxed">
                  {t("estimateBreakdown", {
                    pieces: packaging.perBox,
                    bare: formatCbm(packaging.bareCbm),
                    allowance: packaging.allowancePct,
                  })}
                </p>
              </div>
          </fieldset>
        </div>
      </Disclosure>
    </div>
  );
}
