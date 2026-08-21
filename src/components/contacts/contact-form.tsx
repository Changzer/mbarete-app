"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ContactActionResult } from "@/lib/actions/contacts";
import type { CardTranscribeResult, TranscribedContactFields } from "@/lib/transcribe-card";
import { findSimilarContact, type MatchCandidate } from "@/lib/contact-match";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PhotoPicker } from "@/components/catalog/photo-picker";
import { extractQrFromImage } from "@/lib/client/extract-qr";
import { useOutbox, probeServer } from "@/components/offline/outbox";

type ContactFormValues = {
  companyName: string;
  companyNameZh: string;
  contactPerson: string;
  phone: string;
  email: string;
  whatsapp: string;
  wechat: string;
  boothLocation: string;
  bankInfo: string;
  notes: string;
};

export type ExistingCardImage = { id: number; path: string; kind: "card" | "qr" };

/**
 * Identifies a picked photo well enough to tell "already scanned" from "new".
 * Deliberately not `lastModified`: the compressor stamps every File it returns
 * with the current time, so that would make each photo look new on every
 * change and rescan the whole list — restoring a crop the user just deleted.
 */
function fileKey(file: File) {
  return `${file.name}:${file.size}`;
}

export function ContactForm({
  type,
  action,
  defaultValues,
  existingImages = [],
  submitLabel,
  onSuccess,
  transcribe,
  candidates = [],
  onUseExisting,
  offlineCapture = false,
  onSavedOffline,
}: {
  type: "supplier" | "client";
  action: (
    prevState: ContactActionResult | undefined,
    formData: FormData,
  ) => Promise<ContactActionResult>;
  defaultValues?: Partial<ContactFormValues>;
  existingImages?: ExistingCardImage[];
  submitLabel: string;
  onSuccess?: (id?: number) => void;
  /** Reads picked card photos into draft field values; absent when no AI key is set. */
  transcribe?: (formData: FormData) => Promise<CardTranscribeResult>;
  /** Existing contacts of this type, for the duplicate warning after a card scan. */
  candidates?: MatchCandidate[];
  /** In the product form's dialog: lets a detected duplicate be picked instead. */
  onUseExisting?: (candidate: MatchCandidate) => void;
  /**
   * Registering a new contact at a booth: an unreachable server routes the
   * card to the phone's outbox instead of failing. Never set when editing —
   * a delivered edit could land on top of someone else's newer changes.
   */
  offlineCapture?: boolean;
  /** The capture went to the phone; dialogs use this to close as if saved. */
  onSavedOffline?: () => void;
}) {
  const t = useTranslations("contacts");
  const common = useTranslations("common");

  const outbox = useOutbox();
  const [offlineSaved, setOfflineSaved] = useState<null | "saved" | "store-failed">(null);
  // Remounts the PhotoPicker after a local save; its picked list is private.
  const [captureEpoch, setCaptureEpoch] = useState(0);

  /** The card goes to the phone, keeping card photos and QR crop apart. */
  async function saveToPhone(formData: FormData): Promise<ContactActionResult> {
    if (!outbox) return { error: "invalid" };
    const files = [
      ...formData
        .getAll("cardImages")
        .filter((f): f is File => f instanceof File && f.size > 0)
        .map((file) => ({ file, field: "cardImages" as const })),
      ...formData
        .getAll("qrImage")
        .filter((f): f is File => f instanceof File && f.size > 0)
        .map((file) => ({ file, field: "qrImage" as const })),
    ];
    try {
      await outbox.enqueue("contact", formData, files);
    } catch {
      setOfflineSaved("store-failed");
      return {};
    }
    formRef.current?.reset();
    setCaptureEpoch((epoch) => epoch + 1);
    removeQr();
    aiRun.current++;
    if (aiTimer.current) clearTimeout(aiTimer.current);
    setAiPending(false);
    setAiError(null);
    setAiNotes(null);
    setSimilar(null);
    setOfflineSaved("saved");
    onSavedOffline?.();
    return {};
  }

  async function wrappedAction(formData: FormData): Promise<ContactActionResult> {
    setOfflineSaved(null);

    // Same decision as the product form: server actions cannot be queued for
    // later, so reachability is settled before anything is sent.
    if (offlineCapture && outbox) {
      if (!(await probeServer())) return saveToPhone(formData);
      try {
        const result = await action(undefined, formData);
        if (!result.error) onSuccess?.(result.id);
        return result;
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "digest" in error &&
          typeof error.digest === "string" &&
          error.digest.startsWith("NEXT_")
        ) {
          throw error;
        }
        // Died mid-save: a request that did land makes a duplicate draft,
        // which review catches; a dropped capture would be lost for good.
        return saveToPhone(formData);
      }
    }

    const result = await action(undefined, formData);
    if (!result.error) onSuccess?.(result.id);
    return result;
  }

  const [result, setResult] = useState<ContactActionResult | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  /**
   * Submitted by hand, not through `<form action>`: React 19 resets every
   * uncontrolled field when a form action settles, which wiped the card's
   * typed fields on any failed save — including "could not save to this
   * phone", the one moment the fields must stay put. See the product form.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(async () => {
      setResult(await wrappedAction(formData));
    });
  }

  const formRef = useRef<HTMLFormElement>(null);
  const [removed, setRemoved] = useState<number[]>([]);
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<"no-photos" | "failed" | null>(null);
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const [similar, setSimilar] = useState<MatchCandidate | null>(null);

  /** Fills only fields still empty, so anything already typed is kept. */
  function applyTranscription(fields: TranscribedContactFields) {
    const form = formRef.current;
    if (!form) return;
    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const el = form.elements.namedItem(name);
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) continue;
      if (el.value.trim() !== "") continue;
      el.value = value;
    }
  }

  // Which transcription request is current; a newer photo set supersedes it.
  const aiRun = useRef(0);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleTranscribe(auto = false) {
    if (!transcribe) return;
    const input = formRef.current?.elements.namedItem("cardImages");
    const files = input instanceof HTMLInputElement ? Array.from(input.files ?? []) : [];
    if (files.length === 0) {
      if (!auto) setAiError("no-photos");
      return;
    }

    const run = ++aiRun.current;
    setAiError(null);
    setAiNotes(null);
    setSimilar(null);
    setAiPending(true);
    try {
      const data = new FormData();
      for (const file of files) data.append("cardImages", file);
      const result = await transcribe(data);
      if (run !== aiRun.current) return; // superseded by a newer run
      if (result.ok) {
        applyTranscription(result.fields);
        setAiNotes(result.notes);
        // The same vendor photographed twice is inevitable across dozens of
        // cards — warn, never block: the person decides.
        setSimilar(findSimilarContact(candidates, result.fields) ?? null);
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

  /** Card front + back taken back-to-back become one request after a pause. */
  function scheduleCardTranscribe(files: File[]) {
    if (!transcribe || files.length === 0) return;
    // Offline, every read fails 1.5s after every photo; the capture is read
    // server-side once it is delivered instead. `outbox.offline` covers what
    // navigator.onLine cannot: hall wi-fi with no path to the NAS.
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (outbox?.offline) return;
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => {
      void handleTranscribe(true);
    }, 1500);
  }

  // WeChat QR found on the card, cropped in the browser. It uploads with the
  // form (hidden file input) and is shown next to the WeChat field — the QR
  // itself is the contact method; no model can turn it into an ID.
  const [qr, setQr] = useState<{ file: File; url: string } | null>(null);
  const [qrScan, setQrScan] = useState<"idle" | "scanning" | "found" | "none">("idle");
  const qrInputRef = useRef<HTMLInputElement>(null);
  const qrScanned = useRef(new Set<string>());
  // Tracks the live object URL so unmount revokes the CURRENT one: an effect
  // closing over `qr` with empty deps would only ever see the initial null.
  const qrUrlRef = useRef<string | null>(null);
  useEffect(() => () => {
    if (qrUrlRef.current) URL.revokeObjectURL(qrUrlRef.current);
  }, []);

  function detectQr(files: File[]) {
    // Scanning is remembered per photo so that adding a second photo does not
    // rescan the first — but only for as long as that photo is still picked.
    // Forgetting the ones that are gone is what makes a retry work: removing a
    // blurry shot and taking it again is deliberate, and the compressor is
    // deterministic, so the retry would otherwise carry the same key and be
    // skipped for good. Deleting only the crop, with the photo still picked,
    // stays deleted — the key survives, so nothing scans it back in.
    const present = new Set(files.map(fileKey));
    for (const key of qrScanned.current) {
      if (!present.has(key)) qrScanned.current.delete(key);
    }

    if (files.length === 0) {
      setQrScan("idle");
      return;
    }

    void (async () => {
      let scannedAny = false;
      for (const file of files) {
        const seen = fileKey(file);
        if (qrScanned.current.has(seen)) continue;
        qrScanned.current.add(seen);
        if (!scannedAny) {
          scannedAny = true;
          setQrScan("scanning");
        }
        const found = await extractQrFromImage(file);
        if (!found) continue;
        setQr((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          const url = URL.createObjectURL(found);
          qrUrlRef.current = url;
          return { file: found, url };
        });
        const input = qrInputRef.current;
        if (input && typeof DataTransfer !== "undefined") {
          try {
            const dt = new DataTransfer();
            dt.items.add(found);
            input.files = dt.files;
          } catch {
            // Old browser: the full card photo remains the scannable fallback.
          }
        }
        setQrScan("found");
        return;
      }
      // Nothing found in this round. Saying so beats a silent no-op: without
      // it there is no way to tell a card that carries no QR from a feature
      // that has stopped working.
      if (scannedAny) setQrScan("none");
    })();
  }

  function removeQr() {
    setQr((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    qrUrlRef.current = null;
    // Back to silent: the scan did find one, the user threw it away, and
    // saying "no QR found" about a card that plainly has one would be a lie.
    setQrScan("idle");
    if (qrInputRef.current) qrInputRef.current.value = "";
  }

  function onCardPhotosChanged(files: File[]) {
    scheduleCardTranscribe(files);
    detectQr(files);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="type" value={type} />

      <div className="flex flex-col gap-2">
        <Label>{t("cardPhotos")}</Label>

        {existingImages.filter((img) => img.kind === "card").length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {existingImages.filter((img) => img.kind === "card").map((img) => {
              const isRemoved = removed.includes(img.id);
              return (
                <div key={img.id} className="flex flex-col items-center gap-1">
                  {/* Plain link to the full-size photo: that is where the
                      WeChat QR gets scanned and bank digits get re-checked. */}
                  <a href={img.path} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.path}
                      alt=""
                      className={`h-24 w-24 rounded-md border border-neutral-200 dark:border-neutral-800 object-contain bg-neutral-100 dark:bg-neutral-800 ${
                        isRemoved ? "opacity-30" : ""
                      }`}
                    />
                  </a>
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

        <PhotoPicker key={captureEpoch} name="cardImages" onFilesChanged={onCardPhotosChanged} />

        {transcribe ? (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={aiPending}
              onClick={() => handleTranscribe()}
              data-testid="fill-from-card"
              className="min-h-11 justify-center gap-2"
            >
              {aiPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {aiPending ? t("aiFilling") : t("aiFillCard")}
            </Button>
            {aiError ? (
              <p className="text-sm text-red-600" data-testid="card-ai-error">
                {aiError === "no-photos" ? t("aiErrorNoPhotos") : t("aiErrorFailed")}
              </p>
            ) : aiNotes ? (
              <p
                className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                data-testid="card-ai-notes"
              >
                {t("aiNotes")}: {aiNotes}
              </p>
            ) : (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("aiFillCardHelp")}</p>
            )}
          </div>
        ) : null}

        {similar ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
            data-testid="similar-contact"
          >
            <span>
              {t("similarExists", {
                name: similar.companyName || similar.companyNameZh,
              })}
            </span>
            {onUseExisting ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onUseExisting(similar)}
              >
                {t("useExisting")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="companyName">{t("companyNameEn")}</Label>
        <Input
          id="companyName"
          name="companyName"
          defaultValue={defaultValues?.companyName}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="companyNameZh">{t("companyNameZh")}</Label>
        <Input
          id="companyNameZh"
          name="companyNameZh"
          defaultValue={defaultValues?.companyNameZh}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contactPerson">{t("contactPerson")}</Label>
        <Input
          id="contactPerson"
          name="contactPerson"
          defaultValue={defaultValues?.contactPerson}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" name="phone" defaultValue={defaultValues?.phone} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" defaultValue={defaultValues?.email} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="whatsapp">{t("whatsapp")}</Label>
          <Input id="whatsapp" name="whatsapp" defaultValue={defaultValues?.whatsapp} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wechat">{t("wechat")}</Label>
          <Input id="wechat" name="wechat" defaultValue={defaultValues?.wechat} />
          {/* Uploads the cropped QR alongside the card photos. */}
          <input ref={qrInputRef} name="qrImage" type="file" className="hidden" />
          {!qr && (qrScan === "scanning" || qrScan === "none") ? (
            <p
              className="text-xs text-neutral-500 dark:text-neutral-400"
              data-testid="qr-scan-status"
            >
              {qrScan === "scanning" ? t("wechatQrScanning") : t("wechatQrNone")}
            </p>
          ) : null}
          {qr ? (
            <div className="flex items-center gap-2" data-testid="wechat-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr.url}
                alt="WeChat QR"
                className="h-24 w-24 rounded-md border border-neutral-200 bg-white object-contain dark:border-neutral-800"
              />
              <div className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {t("wechatQrHelp")}
                </span>
                <button
                  type="button"
                  onClick={removeQr}
                  className="self-start text-xs text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
                >
                  {common("delete")}
                </button>
              </div>
            </div>
          ) : (
            existingImages
              .filter((img) => img.kind === "qr")
              .map((img) => {
                const isRemoved = removed.includes(img.id);
                return (
                  <div key={img.id} className="flex items-center gap-2" data-testid="wechat-qr">
                    <a href={img.path} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.path}
                        alt="WeChat QR"
                        className={`h-24 w-24 rounded-md border border-neutral-200 bg-white object-contain dark:border-neutral-800 ${
                          isRemoved ? "opacity-30" : ""
                        }`}
                      />
                    </a>
                    {isRemoved ? (
                      <input type="hidden" name="removeImageIds" value={img.id} />
                    ) : null}
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        {t("wechatQrHelp")}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setRemoved((prev) =>
                            prev.includes(img.id)
                              ? prev.filter((v) => v !== img.id)
                              : [...prev, img.id],
                          )
                        }
                        className="self-start text-xs text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
                      >
                        {isRemoved ? common("cancel") : common("delete")}
                      </button>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="boothLocation">{t("boothLocation")}</Label>
        <Input
          id="boothLocation"
          name="boothLocation"
          defaultValue={defaultValues?.boothLocation}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bankInfo">{t("bankInfo")}</Label>
        <Textarea id="bankInfo" name="bankInfo" defaultValue={defaultValues?.bankInfo} />
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("bankInfoHelp")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea id="notes" name="notes" defaultValue={defaultValues?.notes} />
      </div>

      {result?.error ? (
        <p className="text-sm text-red-600">
          {result.error === "image-error" ? t("errorImage") : common("required")}
        </p>
      ) : null}

      {offlineSaved === "saved" ? (
        <p
          className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          data-testid="contact-saved-offline"
        >
          {t("savedOffline")}
        </p>
      ) : null}
      {offlineSaved === "store-failed" ? (
        <p className="text-sm text-red-600" data-testid="contact-offline-store-failed">
          {t("offlineStoreFailed")}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}
