import { useRef, useState, type RefObject } from "react";
import type { TranscribeResult, TranscribedFields } from "@/lib/transcribe-product";
import type { Category, ExistingImage, AiError, NcmError, DutySuggestions } from "./shared";

/**
 * Reading the product off its photos: the automatic read when photos are
 * added, the "Fill from photos" button, and "Suggest NCM" — the same read
 * applied to the customs codes alone.
 *
 * The hook owns the read's own state (pending, errors, what was read off the
 * board); where the reading lands is the form's business, through `onReading`.
 */
export function usePhotoReading({
  transcribe,
  formRef,
  existingImages,
  offline,
  defaults,
  onReading,
  onCategoryCreated,
  onDutySuggestions,
}: {
  transcribe?: (formData: FormData) => Promise<TranscribeResult>;
  formRef: RefObject<HTMLFormElement | null>;
  existingImages: ExistingImage[];
  /** The outbox knows the server is unreachable even on a wi-fi that claims otherwise. */
  offline: boolean;
  defaults: { thumbPath?: string; aiNotes?: string; boardText?: string };
  onReading: (fields: TranscribedFields, justCreated: Category | undefined, overwrite: boolean) => void;
  onCategoryCreated: (category: Category) => void;
  onDutySuggestions: (duties: DutySuggestions) => void;
}) {
  // The cropped product shot the AI pass produced. Posted with the save; the
  // server re-verifies it names a real thumb file in this company's folder.
  const [thumbPath, setThumbPath] = useState(defaults.thumbPath ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AiError | null>(null);
  // Both start from what the product (or the draft) already recorded, so an
  // edit shows the booth's reading and posts it back unchanged.
  const [notes, setNotes] = useState<string | null>(defaults.aiNotes || null);
  // Whether AI wrote into this form — drives the "AI-read, please verify"
  // label the AI-output rules ask for (and honesty asks for anyway).
  const [filled, setFilled] = useState(false);
  // What the model read off the price board, shown so a wrong figure can be
  // spotted against the handwriting instead of trusted blindly.
  const [boardText, setBoardText] = useState<string | null>(defaults.boardText || null);
  const [ncmPending, setNcmPending] = useState(false);
  const [ncmError, setNcmError] = useState<NcmError | null>(null);
  // Which transcription request is current: a photo added mid-flight starts a
  // newer run, and the stale response must not land after (or between) it.
  const run = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The photos to read: the ones just picked, or — editing a product whose
   * photos live on the server, not in the file input — their stored paths,
   * for the server to read. Null when there are none.
   */
  function photosToRead(): FormData | null {
    const input = formRef.current?.elements.namedItem("images");
    const files = input instanceof HTMLInputElement ? Array.from(input.files ?? []) : [];
    if (files.length === 0 && existingImages.length === 0) return null;
    const data = new FormData();
    for (const file of files) data.append("images", file);
    if (files.length === 0) {
      for (const img of existingImages) data.append("existingPaths", img.path);
    }
    return data;
  }

  async function read(auto = false) {
    if (!transcribe) return;
    const data = photosToRead();
    if (!data) {
      // Auto runs fire from photo-set changes; an emptied set is not an error.
      if (!auto) setError("no-photos");
      return;
    }

    const current = ++run.current;
    setError(null);
    setNotes(null);
    setBoardText(null);
    setPending(true);
    try {
      const result = await transcribe(data);
      if (current !== run.current) return; // superseded by a newer run
      if (result.ok) {
        // Must be in the list before the select can show it.
        if (result.newCategory) onCategoryCreated(result.newCategory);
        setFilled(true);
        onReading(result.fields, result.newCategory, !auto);
        if (result.thumbPath) setThumbPath(result.thumbPath);
        setNotes(result.notes);
        setBoardText(result.boardText);
      } else if (result.error === "no-photos") {
        setError("no-photos");
      } else if (result.error === "limit") {
        setError("limit");
      } else {
        setError("failed");
      }
    } catch {
      if (current === run.current) setError("failed");
    } finally {
      if (current === run.current) setPending(false);
    }
  }

  /**
   * "Suggest NCM": for a product registered before classification existed,
   * whose other fields are already right and must not be touched. An
   * explicit press asks for the reading, so it replaces the codes — the NCM,
   * and China's code and declaration elements when proposed.
   */
  async function suggestNcm() {
    if (!transcribe) return;
    const data = photosToRead();
    if (!data) {
      setNcmError("no-photos");
      return;
    }
    setNcmError(null);
    setNcmPending(true);
    try {
      const result = await transcribe(data);
      if (!result.ok) {
        setNcmError(result.error === "no-photos" ? "no-photos" : result.error === "limit" ? "limit" : "failed");
        return;
      }
      const code = result.fields.hsCode;
      const form = formRef.current;
      const el = form?.elements.namedItem("hsCode");
      if (!code || !(el instanceof HTMLInputElement)) {
        setNcmError("none");
        return;
      }
      el.value = code;
      const cnEl = form?.elements.namedItem("cnHsCode");
      if (result.fields.cnHsCode && cnEl instanceof HTMLInputElement) cnEl.value = result.fields.cnHsCode;
      const elementsEl = form?.elements.namedItem("declarationElements");
      if (result.fields.declarationElements && elementsEl instanceof HTMLTextAreaElement) {
        elementsEl.value = result.fields.declarationElements;
      }
      onDutySuggestions({ BR: result.fields.importDutyBrPct, PY: result.fields.importDutyPyPct });
    } catch {
      setNcmError("failed");
    } finally {
      setNcmPending(false);
    }
  }

  /**
   * Reads start on their own as soon as photos are added — the fields fill
   * while the user keeps working on the rest of the form. Debounced so that
   * product photo + price board taken back-to-back become one request.
   */
  function schedule(files: File[]) {
    if (!transcribe || files.length === 0) return;
    // No connection means every read would fail 1.5s after every photo —
    // exactly where the app must feel calm. The draft is read server-side
    // once the capture is delivered instead. `offline` covers what
    // navigator.onLine cannot: hall wi-fi with no path to the NAS.
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (offline) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void read(true);
    }, 1500);
  }

  /** A capture saved to the phone: any read still running belongs to it, not the next one. */
  function reset() {
    run.current++;
    if (timer.current) clearTimeout(timer.current);
    setPending(false);
    setError(null);
    setNotes(null);
    setBoardText(null);
  }

  return {
    enabled: Boolean(transcribe),
    thumbPath,
    pending,
    error,
    notes,
    boardText,
    filled,
    ncmPending,
    ncmError,
    read,
    suggestNcm,
    schedule,
    reset,
  };
}

export type PhotoReading = ReturnType<typeof usePhotoReading>;
