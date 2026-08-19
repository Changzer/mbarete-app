"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { PhotoPicker } from "@/components/catalog/photo-picker";
import {
  computeCbm,
  estimateCartonCbm,
  estimateCartonWeightKg,
  formatCbm,
  DEFAULT_PACKING_ALLOWANCE_PCT,
} from "@/lib/calculations";

type Category = { id: number; nameEn: string; nameZh: string };

/** Unmeasured fields show empty rather than a 0 nobody entered. */
const blankIfZero = (v: number | undefined) => (v ? String(v) : "");


type ProductFormValues = {
  sku: string;
  nameEn: string;
  nameZh: string;
  categoryId: number;
  descriptionEn: string;
  descriptionZh: string;
  price: number;
  sellPrice: number;
  currency: string;
  moq: number;
  qtyPerBox: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  dimensionSource: "carton" | "piece";
  pieceLengthCm: number;
  pieceWidthCm: number;
  pieceHeightCm: number;
  pieceWeightKg: number;
  packingAllowancePct: number;
  active: boolean;
};

export type ExistingImage = { id: number; path: string };

export function ProductForm({
  categories,
  action,
  defaultValues,
  existingImages = [],
  submitLabel,
  showAddAnother = false,
}: {
  categories: Category[];
  action: (prevState: string | undefined, formData: FormData) => Promise<string | undefined>;
  defaultValues?: Partial<ProductFormValues>;
  existingImages?: ExistingImage[];
  submitLabel: string;
  /** Only when registering: lets several products be entered in a row. */
  showAddAnother?: boolean;
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const [removed, setRemoved] = useState<number[]>([]);
  const [categoryId, setCategoryId] = useState(
    defaultValues?.categoryId ? String(defaultValues.categoryId) : categories[0] ? String(categories[0].id) : "",
  );

  // Which figures the supplier actually gave us. Carton is the accurate path;
  // piece estimates a carton when only the product itself has been quoted.
  const [source, setSource] = useState<"carton" | "piece">(
    defaultValues?.dimensionSource ?? "carton",
  );

  // Controlled so the estimate below updates as the numbers are typed.
  const [qtyPerBox, setQtyPerBox] = useState(String(defaultValues?.qtyPerBox ?? 1));
  const [piece, setPiece] = useState({
    lengthCm: String(defaultValues?.pieceLengthCm ?? 0),
    widthCm: String(defaultValues?.pieceWidthCm ?? 0),
    heightCm: String(defaultValues?.pieceHeightCm ?? 0),
    weightKg: String(defaultValues?.pieceWeightKg ?? 0),
  });
  const [allowance, setAllowance] = useState(
    String(defaultValues?.packingAllowancePct ?? DEFAULT_PACKING_ALLOWANCE_PCT),
  );

  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const pieceDims = {
    lengthCm: num(piece.lengthCm),
    widthCm: num(piece.widthCm),
    heightCm: num(piece.heightCm),
  };
  const perBox = num(qtyPerBox);
  const allowancePct = num(allowance);
  const estimatedCbm = estimateCartonCbm(pieceDims, perBox, allowancePct);
  const estimatedWeight = estimateCartonWeightKg(num(piece.weightKg), perBox, allowancePct);
  const bareCbm = computeCbm(pieceDims.lengthCm, pieceDims.widthCm, pieceDims.heightCm) * perBox;

  return (
    <form action={formAction} className="flex flex-col gap-5 pb-20 sm:pb-0">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sku">{t("sku")}</Label>
          <Input id="sku" name="sku" defaultValue={defaultValues?.sku} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="categoryId">{t("category")}</Label>
          <input type="hidden" name="categoryId" value={categoryId} />
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="categoryId">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nameEn} / {c.nameZh}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nameEn">{t("nameEn")}</Label>
          <Input id="nameEn" name="nameEn" defaultValue={defaultValues?.nameEn} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nameZh">{t("nameZh")}</Label>
          <Input id="nameZh" name="nameZh" defaultValue={defaultValues?.nameZh} />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="descriptionEn">{t("descriptionEn")}</Label>
          <Textarea
            id="descriptionEn"
            name="descriptionEn"
            defaultValue={defaultValues?.descriptionEn}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="descriptionZh">{t("descriptionZh")}</Label>
          <Textarea
            id="descriptionZh"
            name="descriptionZh"
            defaultValue={defaultValues?.descriptionZh}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="price">{t("costPrice")}</Label>
          <Input
            id="price"
            name="price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            defaultValue={defaultValues?.price}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sellPrice">{t("sellPrice")}</Label>
          <Input
            id="sellPrice"
            name="sellPrice"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder={t("optionalPlaceholder")}
            defaultValue={defaultValues?.sellPrice ? defaultValues.sellPrice : ""}
          />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("sellPriceHelp")}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currency">{t("currency")}</Label>
          <Input
            id="currency"
            name="currency"
            defaultValue={defaultValues?.currency ?? "USD"}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="moq">{t("moq")}</Label>
          <Input
            id="moq"
            name="moq"
            type="number"
            inputMode="numeric"
            min="1"
            defaultValue={defaultValues?.moq ?? 1}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qtyPerBox">{t("qtyPerBox")}</Label>
          <Input
            id="qtyPerBox"
            name="qtyPerBox"
            type="number"
            inputMode="numeric"
            min="1"
            value={qtyPerBox}
            onChange={(e) => setQtyPerBox(e.target.value)}
            required
          />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label>{t("dimensionSource")}</Label>
          <input type="hidden" name="dimensionSource" value={source} />
          <div className="flex flex-wrap gap-2">
            {(["carton", "piece"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={source === mode}
                onClick={() => setSource(mode)}
                className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                  source === mode
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {mode === "carton" ? t("haveCartonSize") : t("havePieceSizeOnly")}
              </button>
            ))}
          </div>
        </div>

        {source === "carton" ? (
          <>
            <p className="sm:col-span-2 rounded-md bg-neutral-100 dark:bg-neutral-800 px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400">
              {t("cartonHelp")} {t("measurementsOptional")}
            </p>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lengthCm">{t("length")}</Label>
              <Input
                id="lengthCm"
                name="lengthCm"
                placeholder={t("optionalPlaceholder")}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                defaultValue={blankIfZero(defaultValues?.lengthCm)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="widthCm">{t("width")}</Label>
              <Input
                id="widthCm"
                name="widthCm"
                placeholder={t("optionalPlaceholder")}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                defaultValue={blankIfZero(defaultValues?.widthCm)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="heightCm">{t("height")}</Label>
              <Input
                id="heightCm"
                name="heightCm"
                placeholder={t("optionalPlaceholder")}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                defaultValue={blankIfZero(defaultValues?.heightCm)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="weightKg">{t("weight")}</Label>
              <Input
                id="weightKg"
                name="weightKg"
                placeholder={t("optionalPlaceholder")}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                defaultValue={blankIfZero(defaultValues?.weightKg)}
              />
            </div>
          </>
        ) : (
          <>
            <p className="sm:col-span-2 rounded-md bg-neutral-100 dark:bg-neutral-800 px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400">
              {t("pieceHelp")}
            </p>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pieceLengthCm">{t("pieceLength")}</Label>
              <Input
                id="pieceLengthCm"
                name="pieceLengthCm"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={piece.lengthCm}
                onChange={(e) => setPiece((p) => ({ ...p, lengthCm: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pieceWidthCm">{t("pieceWidth")}</Label>
              <Input
                id="pieceWidthCm"
                name="pieceWidthCm"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={piece.widthCm}
                onChange={(e) => setPiece((p) => ({ ...p, widthCm: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pieceHeightCm">{t("pieceHeight")}</Label>
              <Input
                id="pieceHeightCm"
                name="pieceHeightCm"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={piece.heightCm}
                onChange={(e) => setPiece((p) => ({ ...p, heightCm: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pieceWeightKg">{t("pieceWeight")}</Label>
              <Input
                id="pieceWeightKg"
                name="pieceWeightKg"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={piece.weightKg}
                onChange={(e) => setPiece((p) => ({ ...p, weightKg: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="packingAllowancePct">{t("packingAllowance")}</Label>
              <Input
                id="packingAllowancePct"
                name="packingAllowancePct"
                type="number"
                inputMode="decimal"
                step="1"
                min="0"
                max="200"
                value={allowance}
                onChange={(e) => setAllowance(e.target.value)}
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {t("packingAllowanceHelp")}
              </p>
            </div>

            <div
              className="sm:col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm dark:border-amber-900 dark:bg-amber-950"
              data-testid="carton-estimate"
            >
              <p className="font-medium text-amber-900 dark:text-amber-200">
                {t("estimatedCarton")}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-amber-900 dark:text-amber-200">
                <dt>{t("cbm")}</dt>
                <dd className="text-right font-medium" data-testid="estimated-cbm">
                  {formatCbm(estimatedCbm)} m³
                </dd>
                <dt>{t("weight")}</dt>
                <dd className="text-right font-medium" data-testid="estimated-weight">
                  {estimatedWeight.toFixed(2)} kg
                </dd>
              </dl>
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                {t("estimateBreakdown", {
                  pieces: perBox,
                  bare: formatCbm(bareCbm),
                  allowance: allowancePct,
                })}
              </p>
            </div>
          </>
        )}

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="images">{t("images")}</Label>

          {existingImages.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {existingImages.map((img) => {
                const isRemoved = removed.includes(img.id);
                return (
                  <div key={img.id} className="flex flex-col items-center gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.path}
                      alt=""
                      className={`h-24 w-24 rounded-md border border-neutral-200 dark:border-neutral-800 object-contain bg-neutral-100 dark:bg-neutral-800 ${
                        isRemoved ? "opacity-30" : ""
                      }`}
                    />
                    {isRemoved ? (
                      <input type="hidden" name="removeImageIds" value={img.id} />
                    ) : null}
                    <button
                      type="button"
                      className="text-xs text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
                      onClick={() =>
                        setRemoved((prev) =>
                          prev.includes(img.id)
                            ? prev.filter((v) => v !== img.id)
                            : [...prev, img.id],
                        )
                      }
                    >
                      {isRemoved ? common("cancel") : common("delete")}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <PhotoPicker />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="active"
            name="active"
            type="checkbox"
            defaultChecked={defaultValues?.active ?? true}
            className="h-4 w-4"
          />
          <Label htmlFor="active">{t("active")}</Label>
        </div>
      </div>

      {errorMessage ? (
        <p className="text-sm text-red-600" data-testid="form-error">
          {errorMessage === "duplicate-sku"
            ? t("errorDuplicateSku")
            : errorMessage === "image-error"
              ? t("errorImage")
              : t("errorRequiredFields")}
        </p>
      ) : null}

      {/*
        Pinned to the bottom of the screen on a phone so saving never means
        scrolling back down a long form, and a normal row once there is room.
        Fixed rather than sticky: as the form's last child it has nothing left
        to stick within, so `sticky` would just sit off-screen at the end.
      */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950 sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 dark:sm:bg-transparent">
        <Button type="submit" disabled={isPending} className="min-h-11 flex-1 sm:flex-none">
          {submitLabel}
        </Button>
        {showAddAnother ? (
          <Button
            type="submit"
            name="andAnother"
            value="1"
            variant="outline"
            disabled={isPending}
            data-testid="save-and-add-another"
            className="min-h-11 flex-1 sm:flex-none"
          >
            {t("saveAndAddAnother")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
