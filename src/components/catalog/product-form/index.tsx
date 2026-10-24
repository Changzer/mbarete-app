"use client";

import { useRef, useState, useTransition } from "react";
import type { SupplierOption } from "@/components/catalog/supplier-picker";
import type { TranscribeResult, TranscribedFields } from "@/lib/transcribe-product";
import type { Destination, RatesByMode } from "@/lib/landed-cost";
import type { CurrencyRates } from "@/lib/calculations";
import { supplierUnitCost } from "@/lib/calculations";
import { normalizeHsCode } from "@/lib/customs";
import type { CardTranscribeResult } from "@/lib/transcribe-card";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { supplierVatPctSchema } from "@/lib/validators";
import { useOutbox, probeServer } from "@/components/offline/outbox";
import { blankIfZero, type Category, type DutySuggestions, type ExistingImage, type ProductFormValues } from "./shared";
import { emptyRequired, localProblem, REQUIRED_FIELDS } from "./submit-checks";
import { inputValue, writeReading } from "./fill-from-reading";
import { usePackaging } from "./use-packaging";
import { usePhotoReading } from "./use-photo-reading";
import { PhotosSection } from "./photos-section";
import { SupplierSection } from "./supplier-section";
import { CommercialSection } from "./commercial-section";
import { IdentitySection } from "./identity-section";
import { DescriptionSection } from "./description-section";
import { PackagingSection } from "./packaging-section";
import { ExportSection, type CustomsUnit } from "./export-section";
import { FormFooter } from "./form-footer";

export type { SupplierOption } from "@/components/catalog/supplier-picker";
export type { ExistingImage } from "./shared";

/**
 * Registering and editing a product. This file holds what the parts share —
 * the values several sections read, the photo reading landing in them, and
 * the save (online, or to the phone) — and lays the sections out in order.
 * Each section, in this folder, is one part of the form on screen.
 */
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
  shippingRates = {},
  rates = {},
  functionalCurrency = "USD",
  dutySuggestions = {},
  returnQuery,
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
  /** For the landed-cost estimate: the shipping rate in force per destination. */
  shippingRates?: Partial<Record<Destination, RatesByMode>>;
  /** Exchange rates and the currency the estimate is shown in. */
  rates?: CurrencyRates;
  functionalCurrency?: string;
  dutySuggestions?: Partial<Record<Destination, number>>;
  /** The catalog view (its query string) to land on after saving an edit. */
  returnQuery?: string;
}) {
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
  // server list: the create action's re-render delivers them too.
  const [createdCategories, setCreatedCategories] = useState<Category[]>([]);
  const allCategories = [
    ...categories,
    ...createdCategories.filter((c) => !categories.some((p) => p.id === c.id)),
  ];

  const formRef = useRef<HTMLFormElement>(null);
  // What the category started as, so a suggestion never overrides a manual pick.
  const initialCategoryId = useRef(categoryId);

  // A segmented control rather than a text field, so it is state, not a DOM
  // value the AI pass can poke at — see applyReading.
  const [currency, setCurrency] = useState(defaultValues?.currency ?? "USD");
  // The selling side has its own currency: a trading company buys in RMB
  // and quotes in USD. A new product starts in USD when the company has a
  // rate for it, else in whatever the cost is in.
  const [sellCurrency, setSellCurrency] = useState(
    defaultValues?.sellCurrency || (rates.USD !== undefined ? "USD" : (defaultValues?.currency ?? "USD")),
  );
  // The landed-cost estimate follows the price as it is typed; the input
  // itself stays uncontrolled so the AI can still write into it.
  const [priceText, setPriceText] = useState(defaultValues?.price ? String(defaultValues.price) : "");
  const [vatText, setVatText] = useState(blankIfZero(defaultValues?.supplierVatPct));
  const vat = supplierVatPctSchema.safeParse(vatText);
  const basePrice = Number(normalizeDecimalInput(priceText));
  const inclusiveCost = vat.success && Number.isFinite(basePrice) && basePrice > 0
    ? supplierUnitCost({ price: basePrice, supplierVatPct: vat.data }) : null;

  const [destination, setDestination] = useState<"" | Destination>(defaultValues?.exportDestination ?? "");
  const exportDetailsRef = useRef<HTMLDetailsElement>(null);
  const [suggestedDuties, setSuggestedDuties] = useState<DutySuggestions>(dutySuggestions);
  const [dutyBr, setDutyBr] = useState(defaultValues?.importDutyPctBr != null ? String(defaultValues.importDutyPctBr) : "");
  const [dutyPy, setDutyPy] = useState(defaultValues?.importDutyPctPy != null ? String(defaultValues.importDutyPctPy) : "");
  const [customsUnit, setCustomsUnit] = useState<CustomsUnit>(defaultValues?.customsUnit ?? "pcs");

  const packaging = usePackaging(formRef, defaultValues);

  /**
   * A photo reading lands: the text fields directly (fill-from-reading.ts),
   * then the fields held in state by the same "only if untouched" rule —
   * unless the agent pressed the button and so asked for the reading.
   */
  function applyReading(fields: TranscribedFields, justCreated: Category | undefined, overwrite: boolean) {
    const form = formRef.current;
    if (!form) return;
    writeReading(form, fields, overwrite);
    // A model proposal is not a current tariff lookup, nor permission to
    // replace a manually entered rate. It stays separate until chosen.
    if (fields.hsCode && normalizeHsCode(inputValue(form, "hsCode")) === fields.hsCode) {
      setSuggestedDuties({ BR: fields.importDutyBrPct, PY: fields.importDutyPyPct });
    }
    setPriceText(inputValue(form, "price"));
    // Currency is state, so it takes the same "only if untouched" rule by
    // hand: USD is the pristine default nobody chose.
    if (fields.currency) {
      setCurrency((prev) => (overwrite || prev === "USD" ? String(fields.currency) : prev));
    }
    packaging.updateCartonCbm();
    if (fields.qtyPerBox !== undefined) {
      packaging.setQtyPerBox((prev) =>
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
  const reading = usePhotoReading({
    transcribe,
    formRef,
    existingImages,
    offline: Boolean(outbox?.offline),
    defaults: { thumbPath: defaultValues?.thumbPath, aiNotes: defaultValues?.aiNotes, boardText: defaultValues?.boardText },
    onReading: applyReading,
    onCategoryCreated: (created) =>
      setCreatedCategories((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created])),
    onDutySuggestions: setSuggestedDuties,
  });

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
    setPriceText(defaultValues?.price ? String(defaultValues.price) : "");
    setVatText(blankIfZero(defaultValues?.supplierVatPct));
    setDestination(defaultValues?.exportDestination ?? "");
    setDutyBr("");
    setDutyPy("");
    setSuggestedDuties({});
    if (exportDetailsRef.current) exportDetailsRef.current.open = false;
    packaging.reset();
    reading.reset();
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
    const problem = localProblem(formData, [dutyBr, dutyPy]);
    if (problem) {
      setErrorMessage(problem.error);
      if (problem.openExport && exportDetailsRef.current) exportDetailsRef.current.open = true;
      document.getElementById(problem.focusId)?.focus();
      return;
    }
    startTransition(async () => {
      const error = await submitAction(formData);
      setErrorMessage(error);
      if (error === "invalid") {
        // Point at the empty required fields instead of making the user
        // hunt: the first live test failed on a name field five screens
        // above a message that named four candidates.
        const empty = emptyRequired(formData);
        setMissing(empty);
        const first = REQUIRED_FIELDS.find((f) => empty.has(f));
        if (first) {
          document.getElementById(first)?.scrollIntoView({ behavior: "smooth", block: "center" });
          document.getElementById(first)?.focus({ preventScroll: true });
        }
      } else {
        setMissing(new Set());
      }
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 pb-36 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6 lg:pb-0"
    >
      <PhotosSection
        draftId={draftId}
        draftImages={draftImages}
        existingImages={existingImages}
        removed={removed}
        onToggleRemoved={(id) =>
          setRemoved((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
        }
        captureEpoch={captureEpoch}
        reading={reading}
      />
      <SupplierSection
        suppliers={suppliers}
        defaultSupplierId={defaultValues?.supplierId}
        duplicatedFromId={defaultValues?.duplicatedFromId}
        transcribeCard={transcribeCard}
      />
      <CommercialSection
        defaults={defaultValues}
        onPriceInput={setPriceText}
        vatText={vatText}
        onVatChange={setVatText}
        vatValid={vat.success}
        inclusiveCost={inclusiveCost}
        currency={currency}
        onCurrencyChange={setCurrency}
        sellCurrency={sellCurrency}
        onSellCurrencyChange={setSellCurrency}
        qtyPerBox={packaging.qtyPerBox}
        onQtyPerBoxChange={packaging.setQtyPerBox}
        missing={missing}
      />
      <IdentitySection
        defaults={defaultValues}
        thumbPath={reading.thumbPath}
        returnQuery={returnQuery}
        boardText={reading.boardText}
        aiNotes={reading.notes}
        categories={allCategories}
        categoryId={categoryId}
        onCategoryChange={setCategoryId}
      />
      <DescriptionSection
        defaults={defaultValues}
        reading={reading.enabled ? null : { boardText: reading.boardText, notes: reading.notes }}
      />
      <PackagingSection defaults={defaultValues} packaging={packaging} />
      <ExportSection
        detailsRef={exportDetailsRef}
        defaults={defaultValues}
        canSuggestNcm={reading.enabled && existingImages.length > 0}
        reading={reading}
        destination={destination}
        onDestinationChange={setDestination}
        dutyBr={dutyBr}
        onDutyBrChange={setDutyBr}
        dutyPy={dutyPy}
        onDutyPyChange={setDutyPy}
        suggestedDuties={suggestedDuties}
        onSuggestedDutiesChange={setSuggestedDuties}
        customsUnit={customsUnit}
        onCustomsUnitChange={setCustomsUnit}
        landedCost={{
          priceText: inclusiveCost === null ? "" : String(inclusiveCost),
          currency,
          cartonCbm: packaging.source === "piece" ? packaging.estimatedCbm : packaging.cartonCbm,
          estimatedCarton: packaging.source === "piece",
          qtyPerBox: Number(packaging.qtyPerBox) || 0,
          shippingRates,
          rates,
          target: functionalCurrency,
        }}
      />
      <FormFooter
        defaultActive={defaultValues?.active}
        errorMessage={errorMessage}
        offlineSaved={offlineSaved}
        pendingCount={outbox?.pending}
        isPending={isPending}
        submitLabel={submitLabel}
        showAddAnother={showAddAnother}
      />
    </form>
  );
}
