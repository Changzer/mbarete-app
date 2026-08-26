"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Disclosure, Field, FormSection } from "@/components/ui/disclosure";
import { CurrencyField } from "@/components/catalog/currency-field";
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
import {
  SupplierPicker,
  type SupplierOption,
} from "@/components/catalog/supplier-picker";
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
import { useOutbox, probeServer } from "@/components/offline/outbox";

type Category = { id: number; nameEn: string; nameZh: string };

export type { SupplierOption } from "@/components/catalog/supplier-picker";

/** Unmeasured fields show empty rather than a 0 nobody entered. */
const blankIfZero = (v: number | undefined) => (v ? String(v) : "");


type ProductFormValues = {
  sku: string;
  supplierCode: string;
  thumbPath: string;
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
  lockCategory = false,
  draftId,
  draftImages = [],
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
  /**
   * Keep the given category no matter what the photos say. True when the
   * category is real data (editing a product, or duplicating one). False for
   * the sticky category carried by "save & add another", which is only a
   * convenience default: the next item at the same booth is often a different
   * kind of product, so the photos should be allowed to change it.
   */
  lockCategory?: boolean;
  /** Saving promotes this capture draft: its photos attach, it leaves the queue. */
  draftId?: number;
  /** The draft's photos, already on the server — shown, not re-uploaded. */
  draftImages?: { id: number; path: string }[];
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");

  const outbox = useOutbox();
  // "saved": the capture is on the phone and the form has been cleared for
  // the next item. "store-failed": the phone refused to store it (private
  // mode, no space) — nothing was saved anywhere, so the form must stay put.
  const [offlineSaved, setOfflineSaved] = useState<null | "saved" | "store-failed">(null);
  // Remounts the PhotoPicker after a local save: its picked list is private
  // state, and carrying photos from one booth into the next capture is the
  // one mistake this flow cannot afford.
  const [captureEpoch, setCaptureEpoch] = useState(0);

  const [removed, setRemoved] = useState<number[]>([]);
  // New products start in General when it exists — the list is alphabetical,
  // so "first category" would mean whatever sorts first (Apparel, today).
  const fallbackCategory =
    categories.find(
      (c) => c.nameEn.trim().toLowerCase() === "general" || c.nameZh.trim() === "综合",
    ) ?? categories[0];
  const [categoryId, setCategoryId] = useState(
    defaultValues?.categoryId
      ? String(defaultValues.categoryId)
      : fallbackCategory
        ? String(fallbackCategory.id)
        : "",
  );
  // Categories the AI created during this registration, deduped against the
  // server list for the same reason as suppliers below.
  const [createdCategories, setCreatedCategories] = useState<Category[]>([]);
  const allCategories = [
    ...categories,
    ...createdCategories.filter((c) => !categories.some((p) => p.id === c.id)),
  ];

  const formRef = useRef<HTMLFormElement>(null);
  // What the category started as, so a suggestion never overrides a manual pick.
  const initialCategoryId = useRef(categoryId);

  // The cropped product shot the AI pass produced. Posted with the save; the
  // server re-verifies it names a real thumb file in this company's folder.
  const [thumbPath, setThumbPath] = useState(defaultValues?.thumbPath ?? "");

  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<"no-photos" | "failed" | null>(null);
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  // What the model read off the price board, shown so a wrong figure can be
  // spotted against the handwriting instead of trusted blindly.
  const [aiBoardText, setAiBoardText] = useState<string | null>(null);

  // "0" is the no-supplier option: Radix Select items cannot carry an empty value.
  const [supplierId, setSupplierId] = useState(
    defaultValues?.supplierId ? String(defaultValues.supplierId) : "0",
  );
  // Suppliers registered from this very form, shown first: at the market the
  // vendor just photographed is the one about to be picked.
  const [createdSuppliers, setCreatedSuppliers] = useState<SupplierOption[]>([]);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  // Deduped by id: a supplier created inline is also delivered by the server
  // re-render that follows the create action, and the same id twice renders
  // as two checked entries with doubled trigger text.
  const allSuppliers = [
    ...createdSuppliers,
    ...suppliers.filter((s) => !createdSuppliers.some((c) => c.id === s.id)),
  ];

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
  // A segmented control rather than a text field, so it is state, not a DOM
  // value the AI pass can poke at — see applyTranscription.
  const [currency, setCurrency] = useState(defaultValues?.currency ?? "USD");
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
  /**
   * `overwrite` separates the two ways a read arrives. An automatic run
   * (photos just added) must never clobber what the agent already typed. An
   * explicit press of "Fill from photos" is the agent ASKING for the
   * reading — on the edit page every field already holds its stored value,
   * so without overwrite the button would visibly do nothing.
   */
  function applyTranscription(
    fields: TranscribedFields,
    justCreated?: Category,
    overwrite = false,
  ) {
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
      if (!overwrite && el.value.trim() !== "" && !pristine.includes(el.value.trim())) return;
      el.value = String(value);
    };

    setIfUntouched("supplierCode", fields.supplierCode);
    setIfUntouched("nameEn", fields.nameEn);
    setIfUntouched("nameZh", fields.nameZh);
    setIfUntouched("descriptionEn", fields.descriptionEn);
    setIfUntouched("descriptionZh", fields.descriptionZh);
    setIfUntouched("price", fields.price);
    // Currency is state, so it takes the same "only if untouched" rule by
    // hand: USD is the pristine default nobody chose.
    if (fields.currency) {
      setCurrency((prev) => (overwrite || prev === "USD" ? String(fields.currency) : prev));
    }
    setIfUntouched("moq", fields.moq, ["1"]);
    // Carton figures off the board. These inputs only exist in carton mode;
    // in piece mode namedItem() finds nothing and the values are skipped.
    setIfUntouched("lengthCm", fields.lengthCm);
    setIfUntouched("widthCm", fields.widthCm);
    setIfUntouched("heightCm", fields.heightCm);
    setIfUntouched("weightKg", fields.weightKg);
    setIfUntouched("cbmOverride", fields.cbm);
    if (fields.qtyPerBox !== undefined) {
      setQtyPerBox((prev) =>
        overwrite || prev === "" || prev === "1" ? String(fields.qtyPerBox) : prev,
      );
    }
    // `justCreated` is passed explicitly because setCreatedCategories has not
    // re-rendered yet when this runs: `allCategories` is still the array from
    // the render that started the request, so a brand-new category would fail
    // the check and the select would keep its old value.
    const selectable = justCreated ? [...allCategories, justCreated] : allCategories;
    if (
      !lockCategory &&
      fields.categoryId !== undefined &&
      selectable.some((c) => c.id === fields.categoryId)
    ) {
      setCategoryId((prev) =>
        overwrite || prev === initialCategoryId.current ? String(fields.categoryId) : prev,
      );
    }
  }

  // Which transcription request is current: a photo added mid-flight starts a
  // newer run, and the stale response must not land after (or between) it.
  const aiRun = useRef(0);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Registering with no connection: the capture goes to the phone's outbox
   * instead of the server, exactly as filled in. The one adjustment is a SKU
   * still on its server-suggested default — every capture in a dead hall
   * would carry that same suggestion, so it is blanked and assigned at
   * promotion the same way a hand-cleared SKU is.
   */
  async function saveToPhone(formData: FormData): Promise<undefined> {
    if (!outbox) return undefined;
    if (formData.get("sku") === defaultValues?.sku) formData.set("sku", "");
    // An unchecked checkbox posts nothing, which a draft cannot tell apart
    // from "never captured" — so the box's state is written down explicitly.
    formData.set("active", formData.get("active") === "on" ? "on" : "off");
    const files = formData
      .getAll("images")
      .filter((f): f is File => f instanceof File && f.size > 0)
      .map((file) => ({ file, field: "images" as const }));
    try {
      await outbox.enqueue("product", formData, files);
    } catch {
      setOfflineSaved("store-failed");
      return undefined;
    }

    // Clear for the next booth in place — the online flow's redirect needs a
    // server. Category and supplier stay, mirroring what "save & add another"
    // carries in its querystring; everything else returns to its defaults.
    formRef.current?.reset();
    setCaptureEpoch((epoch) => epoch + 1);
    setSource(defaultValues?.dimensionSource ?? "carton");
    setQtyPerBox(String(defaultValues?.qtyPerBox ?? 1));
    setPiece({
      lengthCm: String(defaultValues?.pieceLengthCm ?? 0),
      widthCm: String(defaultValues?.pieceWidthCm ?? 0),
      heightCm: String(defaultValues?.pieceHeightCm ?? 0),
      weightKg: String(defaultValues?.pieceWeightKg ?? 0),
    });
    setAllowance(String(defaultValues?.packingAllowancePct ?? DEFAULT_PACKING_ALLOWANCE_PCT));
    aiRun.current++;
    if (aiTimer.current) clearTimeout(aiTimer.current);
    setAiPending(false);
    setAiError(null);
    setAiNotes(null);
    setAiBoardText(null);
    setOfflineSaved("saved");
    window.scrollTo({ top: 0 });
    return undefined;
  }

  /**
   * Decides where a save goes before anything is sent. Server actions are
   * addressed by build-scoped ids and cannot be queued for later, so the
   * choice has to happen here: reachable server → the normal action;
   * unreachable → the outbox. The probe asks the server itself because
   * `navigator.onLine` believes any wi-fi, including one with no way out.
   */
  async function submitAction(formData: FormData): Promise<string | undefined> {
    setOfflineSaved(null);
    // Only untouched registration captures offline. An edit delivered later
    // could land on top of someone else's newer edit, and a draft under
    // review lives on the server (photos included) — going to the phone from
    // either would fork the data, so both stay online-only.
    if (!showAddAnother || !outbox || draftId) return action(undefined, formData);

    if (!(await probeServer())) return saveToPhone(formData);

    try {
      return await action(undefined, formData);
    } catch (error) {
      // The link died mid-save. If the request did reach the server, this
      // re-save makes a duplicate draft — which review catches. The reverse
      // failure, dropping the capture, would be silent and permanent.
      if (
        error &&
        typeof error === "object" &&
        "digest" in error &&
        typeof error.digest === "string" &&
        error.digest.startsWith("NEXT_")
      ) {
        throw error; // a redirect, not a failure
      }
      return saveToPhone(formData);
    }
  }

  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  // The required fields the last failed save found empty — highlighted so
  // the culprit is visible from the error message five screens below it.
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  /**
   * Submitted by hand rather than through `<form action>`: React 19 resets
   * every uncontrolled field when a form action settles, which on any failed
   * save — a duplicate SKU, and above all "could not save to this phone" —
   * wiped the very capture the error message was telling the user to keep.
   * Dispatching from onSubmit leaves the fields exactly as typed; the one
   * reset this form wants (a successful save to the phone) stays explicit in
   * saveToPhone. Browser validation still runs first, and the clicked
   * button rides along so "save & add another" keeps its meaning.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    // Browsers before Chrome 112 / Safari 16.4 silently ignore the submitter
    // argument, which would strip "save & add another" of its meaning.
    if (
      submitter instanceof HTMLButtonElement &&
      submitter.name &&
      !formData.has(submitter.name)
    ) {
      formData.append(submitter.name, submitter.value);
    }
    startTransition(async () => {
      const error = await submitAction(formData);
      setErrorMessage(error);
      if (error === "invalid") {
        // Point at the empty required fields instead of making the user
        // hunt: the first live test failed on a name field five screens
        // above a message that named four candidates.
        const empty = new Set<string>();
        const nameEn = String(formData.get("nameEn") ?? "").trim();
        const nameZh = String(formData.get("nameZh") ?? "").trim();
        if (!nameEn && !nameZh) {
          empty.add("nameEn");
          empty.add("nameZh");
        }
        // Price is deliberately absent: a product photographed before the
        // supplier has quoted saves at 0 and gets priced when the quote
        // lands — the floor is a name.
        for (const field of ["moq", "qtyPerBox"]) {
          if (!String(formData.get(field) ?? "").trim()) empty.add(field);
        }
        setMissing(empty);
        const first = ["nameEn", "nameZh", "moq", "qtyPerBox"].find((f) => empty.has(f));
        if (first) {
          document.getElementById(first)?.scrollIntoView({ behavior: "smooth", block: "center" });
          document.getElementById(first)?.focus({ preventScroll: true });
        }
      } else {
        setMissing(new Set());
      }
    });
  }

  async function handleTranscribe(auto = false) {
    if (!transcribe) return;
    const input = formRef.current?.elements.namedItem("images");
    const files = input instanceof HTMLInputElement ? Array.from(input.files ?? []) : [];
    if (files.length === 0 && existingImages.length === 0) {
      // Auto runs fire from photo-set changes; an emptied set is not an error.
      if (!auto) setAiError("no-photos");
      return;
    }

    const run = ++aiRun.current;
    setAiError(null);
    setAiNotes(null);
    setAiBoardText(null);
    setAiPending(true);
    try {
      const data = new FormData();
      for (const file of files) data.append("images", file);
      // Editing an existing product: its photos live on the server, not in
      // the file input — send their paths and let the server read them.
      if (files.length === 0) {
        for (const img of existingImages) data.append("existingPaths", img.path);
      }
      const result = await transcribe(data);
      if (run !== aiRun.current) return; // superseded by a newer run
      if (result.ok) {
        if (result.newCategory) {
          // Must be in the list before the select can show it.
          const created = result.newCategory;
          setCreatedCategories((prev) =>
            prev.some((c) => c.id === created.id) ? prev : [...prev, created],
          );
        }
        applyTranscription(result.fields, result.newCategory, !auto);
        if (result.thumbPath) setThumbPath(result.thumbPath);
        setAiNotes(result.notes);
        setAiBoardText(result.boardText);
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
    // No connection means every read would fail 1.5s after every photo —
    // exactly where the app must feel calm. The draft is read server-side
    // once the capture is delivered instead. `outbox.offline` covers what
    // navigator.onLine cannot: hall wi-fi with no path to the NAS.
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (outbox?.offline) return;
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

  // Editing something that has already been measured opens the disclosure: it
  // folds to keep a *new* capture short, not to hide figures already there.
  const hasDimensions = Boolean(
    defaultValues &&
      (defaultValues.lengthCm ||
        defaultValues.widthCm ||
        defaultValues.heightCm ||
        defaultValues.weightKg ||
        defaultValues.cbmOverride ||
        defaultValues.dimensionSource === "piece"),
  );

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 pb-36 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6 lg:pb-0"
    >
      {/*
        Photos first, and not as a courtesy: at a booth the phone comes out,
        the product is photographed, and everything else on this form is
        either read off those photos by the AI pass or filled in afterwards.
      */}
      <FormSection kicker={t("images")} className="lg:col-span-2">
          {draftId ? <input type="hidden" name="draftId" value={draftId} /> : null}
          {/* Photos captured at the booth, already stored on the server under
              the draft. Saving attaches them to the product as they are. */}
          {draftImages.length > 0 ? (
            <div className="flex flex-wrap gap-3" data-testid="draft-photos">
              {draftImages.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={img.id}
                  src={img.path}
                  alt=""
                  className="h-24 w-24 rounded-[8px] border border-line bg-surface-2 object-contain"
                />
              ))}
            </div>
          ) : null}

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
                      className={`h-24 w-24 rounded-[8px] border border-line bg-surface-2 object-contain ${
                        isRemoved ? "opacity-30" : ""
                      }`}
                    />
                    {isRemoved ? (
                      <input type="hidden" name="removeImageIds" value={img.id} />
                    ) : null}
                    <button
                      type="button"
                      className="focus-ring min-h-11 px-2 text-[11px] font-semibold text-sub hover:text-danger"
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

          <PhotoPicker key={captureEpoch} onFilesChanged={schedulePhotoTranscribe} />

          {transcribe ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={aiPending}
                onClick={() => handleTranscribe()}
                data-testid="fill-from-photos"
                className="w-full justify-center"
              >
                {aiPending ? (
                  <Loader2 className="h-4 w-4 animate-[spin_2.4s_linear_infinite]" strokeWidth={1.5} />
                ) : (
                  <Sparkles className="h-4 w-4" strokeWidth={1.5} />
                )}
                {aiPending ? t("aiFilling") : t("aiFill")}
              </Button>
              {aiError ? (
                <p className="text-[12px] font-semibold text-danger" data-testid="ai-error">
                  {aiError === "no-photos" ? t("aiErrorNoPhotos") : t("aiErrorFailed")}
                </p>
              ) : aiNotes || aiBoardText ? (
                <div className="flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-sub">
                  {aiBoardText ? (
                    <p data-testid="ai-board-text">
                      <span className="font-semibold">{t("aiBoardRead")}:</span>{" "}
                      <span className="whitespace-pre-wrap font-mono">{aiBoardText}</span>
                    </p>
                  ) : null}
                  {aiNotes ? (
                    <p data-testid="ai-notes">
                      {t("aiNotes")}: {aiNotes}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-[11px] leading-relaxed text-sub">{t("aiFillHelp")}</p>
              )}
            </div>
          ) : null}
      </FormSection>

      {/*
        Supplier sits directly under the photos on purpose: choosing one — or
        registering one from a business card — is the one job that needs a
        person while the transcription reads the board, so the wait costs
        nothing.
      */}
      <FormSection kicker={t("supplier")} className="lg:col-span-2">
        <Field label={t("supplier")} htmlFor="supplierId">
          <input
            type="hidden"
            name="supplierId"
            value={supplierId === "0" ? "" : supplierId}
          />
          {defaultValues?.duplicatedFromId ? (
            <input type="hidden" name="duplicatedFromId" value={defaultValues.duplicatedFromId} />
          ) : null}
          <div className="flex gap-2">
            <SupplierPicker
              suppliers={allSuppliers}
              value={supplierId}
              onChange={setSupplierId}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setSupplierDialogOpen(true)}
              data-testid="new-supplier"
            >
              {t("newSupplier")}
            </Button>
          </div>
        </Field>
      </FormSection>

      {/*
        The commercial group — what a buyer is actually deciding with. It sits
        under the supplier so a capture can legitimately stop here.
      */}
      <FormSection kicker={t("commercial")} className="lg:col-span-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("costPrice")} htmlFor="price" hint={t("costPriceHint")}>
            <Input
              id="price"
              name="price"
              type="text"
              numeric
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={defaultValues?.price}
            />
          </Field>
          <CurrencyField
            value={currency}
            onChange={setCurrency}
            label={t("currency")}
            otherLabel={t("currencyOther")}
          />

          <Field label={t("moq")} htmlFor="moq" required>
            <Input
              id="moq"
              name="moq"
              className={missing.has("moq") ? "border-danger" : undefined}
              type="text"
              numeric
              inputMode="numeric"
              suffix={t("unitPcs")}
              defaultValue={defaultValues?.moq ?? 1}
            />
          </Field>
          <Field label={t("qtyPerBox")} htmlFor="qtyPerBox" required>
            <Input
              id="qtyPerBox"
              name="qtyPerBox"
              className={missing.has("qtyPerBox") ? "border-danger" : undefined}
              type="text"
              numeric
              inputMode="numeric"
              suffix={t("perCarton")}
              value={qtyPerBox}
              onChange={(e) => setQtyPerBox(e.target.value)}
            />
          </Field>

          <Field
            label={t("sellPrice")}
            htmlFor="sellPrice"
            hint={t("sellPriceHelp")}
            className="col-span-2"
          >
            <Input
              id="sellPrice"
              name="sellPrice"
              type="text"
              numeric
              inputMode="decimal"
              placeholder={t("optionalPlaceholder")}
              defaultValue={defaultValues?.sellPrice ? defaultValues.sellPrice : ""}
            />
          </Field>
        </div>

        {/* Both names, stacked: the supplier reads the Chinese one off the box
            and the client reads the English one off the quote. */}
        <Field label={t("nameEn")} htmlFor="nameEn" required>
          <Input
            id="nameEn"
            name="nameEn"
            defaultValue={defaultValues?.nameEn}
            className={missing.has("nameEn") ? "border-danger" : undefined}
          />
        </Field>
        <Field label={t("nameZh")} htmlFor="nameZh" required>
          <Input
            id="nameZh"
            name="nameZh"
            defaultValue={defaultValues?.nameZh}
            className={missing.has("nameZh") ? "border-danger" : undefined}
          />
        </Field>
      </FormSection>

      <FormSection kicker={t("identityGroup")} className="lg:col-span-2">
        <input type="hidden" name="thumbPath" value={thumbPath} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("sku")} htmlFor="sku">
            <Input id="sku" name="sku" numeric defaultValue={defaultValues?.sku} />
          </Field>
          <Field label={t("supplierCode")} htmlFor="supplierCode" hint={t("supplierCodeHelp")}>
            <Input
              id="supplierCode"
              name="supplierCode"
              defaultValue={defaultValues?.supplierCode}
              data-testid="supplier-code"
            />
          </Field>
          <Field label={t("category")} htmlFor="categoryId">
            <input type="hidden" name="categoryId" value={categoryId} />
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="categoryId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allCategories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nameEn} / {c.nameZh}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

      </FormSection>

      <FormSection kicker={t("description")} className="lg:col-span-2">
        <Field label={t("descriptionEn")} htmlFor="descriptionEn">
          <Textarea
            id="descriptionEn"
            name="descriptionEn"
            defaultValue={defaultValues?.descriptionEn}
          />
        </Field>
        <Field label={t("descriptionZh")} htmlFor="descriptionZh">
          <Textarea
            id="descriptionZh"
            name="descriptionZh"
            defaultValue={defaultValues?.descriptionZh}
          />
        </Field>
      </FormSection>

      {/*
        Folded away by default. The carton/piece modes inside are unchanged —
        only their placement is: a tape measure is not something a buyer has
        in the aisle, and these ten fields used to sit between the price and
        the Save button.
      */}
      <div className="lg:col-span-2">
        <Disclosure
          title={t("dimensionsDisclosure")}
          hint={t("dimensionsHint")}
          data-testid="dimensions-disclosure"
          defaultOpen={hasDimensions}
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

            {source === "carton" ? (
              <>
                <p className="rounded-[10px] bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-sub">
                  {t("cartonHelp")} {t("measurementsOptional")}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      ["lengthCm", t("length"), defaultValues?.lengthCm, "cm"],
                      ["widthCm", t("width"), defaultValues?.widthCm, "cm"],
                      ["heightCm", t("height"), defaultValues?.heightCm, "cm"],
                      ["weightKg", t("weight"), defaultValues?.weightKg, "kg"],
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
                      defaultValue={blankIfZero(defaultValues?.cbmOverride)}
                    />
                  </Field>
                </div>
              </>
            ) : (
              <>
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
                      {formatCbm(estimatedCbm)} m³
                    </dd>
                    <dt>{t("weight")}</dt>
                    <dd className="text-right font-mono font-semibold" data-testid="estimated-weight">
                      {estimatedWeight.toFixed(2)} kg
                    </dd>
                  </dl>
                  <p className="mt-2 text-[11px] leading-relaxed">
                    {t("estimateBreakdown", {
                      pieces: perBox,
                      bare: formatCbm(bareCbm),
                      allowance: allowancePct,
                    })}
                  </p>
                </div>
              </>
            )}
          </div>
        </Disclosure>
      </div>

      <label className="flex min-h-11 items-center gap-2.5 text-[13px] font-semibold text-ink lg:col-span-2">
        <input
          id="active"
          name="active"
          type="checkbox"
          defaultChecked={defaultValues?.active ?? true}
          className="h-5 w-5 accent-[var(--mb-action)]"
        />
        {t("active")}
      </label>

      {errorMessage ? (
        <p className="text-[13px] font-semibold text-danger lg:col-span-2" data-testid="form-error">
          {errorMessage === "duplicate-sku"
            ? t("errorDuplicateSku")
            : errorMessage === "image-error"
              ? t("errorImage")
              : errorMessage === "limit-products"
                ? t("errorPlanLimit")
                : t("errorRequiredFields")}
        </p>
      ) : null}

      {/* After a local save the words are "saved" and "waiting" — never an
          error. Nothing has been lost; it is simply still on the phone. */}
      {offlineSaved === "saved" ? (
        <p
          className="flex items-center gap-2 rounded-[10px] bg-ok-soft px-3 py-2.5 text-[13px] font-semibold text-ok lg:col-span-2"
          data-testid="saved-offline"
        >
          <Check className="h-4 w-4 shrink-0" strokeWidth={1.5} />
          {t("savedOffline", { count: outbox?.pending ?? 1 })}
        </p>
      ) : null}
      {offlineSaved === "store-failed" ? (
        <p className="text-[13px] font-semibold text-danger lg:col-span-2" data-testid="offline-store-failed">
          {t("offlineStoreFailed")}
        </p>
      ) : null}

      {/*
        Pinned above the tab bar on a phone so saving never means scrolling
        back down a long form, and a normal row once there is room. Fixed
        rather than sticky: as the form's last child it has nothing left to
        stick within, so `sticky` would just sit off-screen at the end.
      */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 flex flex-col gap-2 border-t border-line bg-surface px-4 py-3 lg:static lg:z-auto lg:col-span-2 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
        <div className="flex gap-2">
          <Button type="submit" disabled={isPending} data-testid="save-product" className="flex-1 lg:flex-none">
            {isPending ? <Loader2 className="animate-spin" /> : null}
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
              className="flex-1 lg:flex-none"
            >
              {t("saveAndAddAnother")}
            </Button>
          ) : null}
        </div>
        {/* The one line that makes a market aisle bearable: it is already safe. */}
        <p className="text-[11px] leading-snug text-sub lg:hidden">{t("saveReassurance")}</p>
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
            // Offline, the card is captured to the phone; the product being
            // registered simply stays unlinked and the supplier is attached
            // once both have reached the server.
            offlineCapture
            onSavedOffline={() => setSupplierDialogOpen(false)}
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
