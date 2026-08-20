"use client";

import { useActionState, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PhotoPicker } from "@/components/catalog/photo-picker";
import { ContactForm } from "@/components/contacts/contact-form";
import { createContact, type ContactActionResult } from "@/lib/actions/contacts";
import type { TranscribeResult, TranscribedFields } from "@/lib/transcribe-product";
import type { CardTranscribeResult } from "@/lib/transcribe-card";
import type { MatchCandidate } from "@/lib/contact-match";
import {
  computeCbm,
  estimateCartonCbm,
  estimateCartonWeightKg,
  formatCbm,
  DEFAULT_PACKING_ALLOWANCE_PCT,
} from "@/lib/calculations";
import { normalizeDecimalInput } from "@/lib/decimal-input";

type Category = { id: number; nameEn: string; nameZh: string };

export type SupplierOption = {
  id: number;
  companyName: string;
  companyNameZh: string;
  phone: string;
  boothLocation: string;
};

/**
 * How a supplier reads in the picker: just the company name (whichever
 * language exists). Booth and details stay on the contacts page and the
 * product card — a long label overflows the select trigger on a phone.
 */
function supplierLabel(s: SupplierOption) {
  return s.companyName || s.companyNameZh;
}

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
  cbmOverride: number;
  supplierId: number;
  duplicatedFromId: number;
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
  transcribe,
  suppliers = [],
  transcribeCard,
}: {
  categories: Category[];
  action: (prevState: string | undefined, formData: FormData) => Promise<string | undefined>;
  defaultValues?: Partial<ProductFormValues>;
  existingImages?: ExistingImage[];
  submitLabel: string;
  /** Only when registering: lets several products be entered in a row. */
  showAddAnother?: boolean;
  /** Reads the picked photos into draft field values; absent when no AI key is set. */
  transcribe?: (formData: FormData) => Promise<TranscribeResult>;
  /** Suppliers to pick from, newest first. */
  suppliers?: SupplierOption[];
  /** Card transcription for the inline new-supplier dialog. */
  transcribeCard?: (formData: FormData) => Promise<CardTranscribeResult>;
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const [removed, setRemoved] = useState<number[]>([]);
  const [categoryId, setCategoryId] = useState(
    defaultValues?.categoryId ? String(defaultValues.categoryId) : categories[0] ? String(categories[0].id) : "",
  );

  const formRef = useRef<HTMLFormElement>(null);
  // What the category started as, so a suggestion never overrides a manual pick.
  const initialCategoryId = useRef(categoryId);
  // A category that arrived in defaultValues (edit, duplicate, sticky "add
  // another") is deliberate data — the AI suggestion must not replace it.
  const categoryLocked = useRef(Boolean(defaultValues?.categoryId));
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<"no-photos" | "failed" | null>(null);
  const [aiNotes, setAiNotes] = useState<string | null>(null);

  // "0" is the no-supplier option: Radix Select items cannot carry an empty value.
  const [supplierId, setSupplierId] = useState(
    defaultValues?.supplierId ? String(defaultValues.supplierId) : "0",
  );
  // Suppliers registered from this very form, shown first: at the market the
  // vendor just photographed is the one about to be picked.
  const [createdSuppliers, setCreatedSuppliers] = useState<SupplierOption[]>([]);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const allSuppliers = [...createdSuppliers, ...suppliers];

  /** Wraps createContact so the new supplier lands in the picker, selected. */
  async function createSupplierInline(
    prevState: ContactActionResult | undefined,
    formData: FormData,
  ): Promise<ContactActionResult> {
    const result = await createContact(prevState, formData);
    if (!result.error && result.id) {
      const created: SupplierOption = {
        id: result.id,
        companyName: String(formData.get("companyName") ?? ""),
        companyNameZh: String(formData.get("companyNameZh") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        boothLocation: String(formData.get("boothLocation") ?? ""),
      };
      setCreatedSuppliers((prev) => [created, ...prev]);
      setSupplierId(String(created.id));
      setSupplierDialogOpen(false);
    }
    return result;
  }

  /** The card matched a vendor already on file: pick them instead of duplicating. */
  function useExistingSupplier(candidate: MatchCandidate) {
    setSupplierId(String(candidate.id));
    setSupplierDialogOpen(false);
  }

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

  /**
   * Fills fields the user has not touched: empty ones, plus those still on
   * their pristine defaults (currency USD, MOQ 1, 1 per box, the initial
   * category). Anything already typed is theirs and stays.
   */
  function applyTranscription(fields: TranscribedFields) {
    const form = formRef.current;
    if (!form) return;

    const setIfUntouched = (
      name: string,
      value: string | number | undefined,
      pristine: string[] = [],
    ) => {
      if (value === undefined) return;
      const el = form.elements.namedItem(name);
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      if (el.value.trim() !== "" && !pristine.includes(el.value.trim())) return;
      el.value = String(value);
    };

    setIfUntouched("nameEn", fields.nameEn);
    setIfUntouched("nameZh", fields.nameZh);
    setIfUntouched("descriptionEn", fields.descriptionEn);
    setIfUntouched("descriptionZh", fields.descriptionZh);
    setIfUntouched("price", fields.price);
    setIfUntouched("currency", fields.currency, ["USD"]);
    setIfUntouched("moq", fields.moq, ["1"]);
    // Carton figures off the board. These inputs only exist in carton mode;
    // in piece mode namedItem() finds nothing and the values are skipped.
    setIfUntouched("lengthCm", fields.lengthCm);
    setIfUntouched("widthCm", fields.widthCm);
    setIfUntouched("heightCm", fields.heightCm);
    setIfUntouched("weightKg", fields.weightKg);
    setIfUntouched("cbmOverride", fields.cbm);
    if (fields.qtyPerBox !== undefined) {
      setQtyPerBox((prev) => (prev === "" || prev === "1" ? String(fields.qtyPerBox) : prev));
    }
    if (
      !categoryLocked.current &&
      fields.categoryId !== undefined &&
      categories.some((c) => c.id === fields.categoryId)
    ) {
      setCategoryId((prev) =>
        prev === initialCategoryId.current ? String(fields.categoryId) : prev,
      );
    }
  }

  // Which transcription request is current: a photo added mid-flight starts a
  // newer run, and the stale response must not land after (or between) it.
  const aiRun = useRef(0);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleTranscribe(auto = false) {
    if (!transcribe) return;
    const input = formRef.current?.elements.namedItem("images");
    const files = input instanceof HTMLInputElement ? Array.from(input.files ?? []) : [];
    if (files.length === 0) {
      // Auto runs fire from photo-set changes; an emptied set is not an error.
      if (!auto) setAiError("no-photos");
      return;
    }

    const run = ++aiRun.current;
    setAiError(null);
    setAiNotes(null);
    setAiPending(true);
    try {
      const data = new FormData();
      for (const file of files) data.append("images", file);
      const result = await transcribe(data);
      if (run !== aiRun.current) return; // superseded by a newer run
      if (result.ok) {
        applyTranscription(result.fields);
        setAiNotes(result.notes);
      } else if (result.error === "no-photos") {
        setAiError("no-photos");
      } else {
        setAiError("failed");
      }
    } catch {
      if (run === aiRun.current) setAiError("failed");
    } finally {
      if (run === aiRun.current) setAiPending(false);
    }
  }

  /**
   * Reads start on their own as soon as photos are added — the fields fill
   * while the user keeps working on the rest of the form. Debounced so that
   * product photo + price board taken back-to-back become one request.
   */
  function schedulePhotoTranscribe(files: File[]) {
    if (!transcribe || files.length === 0) return;
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => {
      void handleTranscribe(true);
    }, 1500);
  }

  const num = (v: string) => {
    const n = Number(normalizeDecimalInput(v));
    return Number.isFinite(n) ? n : 0;
  };
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
    <form ref={formRef} action={formAction} className="flex flex-col gap-5 pb-20 sm:pb-0">
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

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="supplierId">{t("supplier")}</Label>
          <input
            type="hidden"
            name="supplierId"
            value={supplierId === "0" ? "" : supplierId}
          />
          {defaultValues?.duplicatedFromId ? (
            <input type="hidden" name="duplicatedFromId" value={defaultValues.duplicatedFromId} />
          ) : null}
          <div className="flex gap-2">
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger id="supplierId" className="min-w-0 flex-1 [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">{t("noSupplier")}</SelectItem>
                {allSuppliers.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {supplierLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSupplierDialogOpen(true)}
              data-testid="new-supplier"
            >
              {t("newSupplier")}
            </Button>
          </div>
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
            type="text"
            inputMode="decimal"
            defaultValue={defaultValues?.price}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sellPrice">{t("sellPrice")}</Label>
          <Input
            id="sellPrice"
            name="sellPrice"
            type="text"
            inputMode="decimal"
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
                type="text"
                inputMode="decimal"
                defaultValue={blankIfZero(defaultValues?.lengthCm)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="widthCm">{t("width")}</Label>
              <Input
                id="widthCm"
                name="widthCm"
                placeholder={t("optionalPlaceholder")}
                type="text"
                inputMode="decimal"
                defaultValue={blankIfZero(defaultValues?.widthCm)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="heightCm">{t("height")}</Label>
              <Input
                id="heightCm"
                name="heightCm"
                placeholder={t("optionalPlaceholder")}
                type="text"
                inputMode="decimal"
                defaultValue={blankIfZero(defaultValues?.heightCm)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="weightKg">{t("weight")}</Label>
              <Input
                id="weightKg"
                name="weightKg"
                placeholder={t("optionalPlaceholder")}
                type="text"
                inputMode="decimal"
                defaultValue={blankIfZero(defaultValues?.weightKg)}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="cbmOverride">{t("cbmOverride")}</Label>
              <Input
                id="cbmOverride"
                name="cbmOverride"
                placeholder={t("optionalPlaceholder")}
                type="text"
                inputMode="decimal"
                defaultValue={blankIfZero(defaultValues?.cbmOverride)}
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {t("cbmOverrideHelp")}
              </p>
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
                type="text"
                inputMode="decimal"
                value={piece.lengthCm}
                onChange={(e) => setPiece((p) => ({ ...p, lengthCm: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pieceWidthCm">{t("pieceWidth")}</Label>
              <Input
                id="pieceWidthCm"
                name="pieceWidthCm"
                type="text"
                inputMode="decimal"
                value={piece.widthCm}
                onChange={(e) => setPiece((p) => ({ ...p, widthCm: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pieceHeightCm">{t("pieceHeight")}</Label>
              <Input
                id="pieceHeightCm"
                name="pieceHeightCm"
                type="text"
                inputMode="decimal"
                value={piece.heightCm}
                onChange={(e) => setPiece((p) => ({ ...p, heightCm: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pieceWeightKg">{t("pieceWeight")}</Label>
              <Input
                id="pieceWeightKg"
                name="pieceWeightKg"
                type="text"
                inputMode="decimal"
                value={piece.weightKg}
                onChange={(e) => setPiece((p) => ({ ...p, weightKg: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="packingAllowancePct">{t("packingAllowance")}</Label>
              <Input
                id="packingAllowancePct"
                name="packingAllowancePct"
                type="text"
                inputMode="decimal"
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

          <PhotoPicker onFilesChanged={schedulePhotoTranscribe} />

          {transcribe ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={aiPending}
                onClick={() => handleTranscribe()}
                data-testid="fill-from-photos"
                className="min-h-11 justify-center gap-2"
              >
                {aiPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {aiPending ? t("aiFilling") : t("aiFill")}
              </Button>
              {aiError ? (
                <p className="text-sm text-red-600" data-testid="ai-error">
                  {aiError === "no-photos" ? t("aiErrorNoPhotos") : t("aiErrorFailed")}
                </p>
              ) : aiNotes ? (
                <p
                  className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                  data-testid="ai-notes"
                >
                  {t("aiNotes")}: {aiNotes}
                </p>
              ) : (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("aiFillHelp")}</p>
              )}
            </div>
          ) : null}
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
      <div className="fixed inset-x-0 bottom-14 z-30 flex gap-2 border-t border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950 sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 dark:sm:bg-transparent">
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

      {/* Registering the vendor without leaving the product: photograph the
          business card, proofread, save — the new supplier arrives selected.
          The dialog portals out of the DOM, so the forms never nest. */}
      <Dialog open={supplierDialogOpen} onOpenChange={setSupplierDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("newSupplier")}</DialogTitle>
          </DialogHeader>
          <ContactForm
            type="supplier"
            action={createSupplierInline}
            submitLabel={common("save")}
            transcribe={transcribeCard}
            candidates={allSuppliers.map((s) => ({
              id: s.id,
              companyName: s.companyName,
              companyNameZh: s.companyNameZh,
              phone: s.phone,
            }))}
            onUseExisting={useExistingSupplier}
          />
        </DialogContent>
      </Dialog>
    </form>
  );
}
