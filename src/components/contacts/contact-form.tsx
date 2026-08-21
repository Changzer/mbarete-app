"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ContactActionResult } from "@/lib/actions/contacts";
import type { CardTranscribeResult, TranscribedContactFields } from "@/lib/transcribe-card";
import { findSimilarContact, type MatchCandidate } from "@/lib/contact-match";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Loader2, Sparkles, TriangleAlert } from "lucide-react";
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
  // Bank digits stay covered until someone deliberately asks for them.
  const [bankVisible, setBankVisible] = useState(false);

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
    // Browsers before Chrome 112 / Safari 16.4 ignore the submitter argument;
    // carried by hand so a named submit button keeps its meaning there too.
    if (
      submitter instanceof HTMLButtonElement &&
      submitter.name &&
      !formData.has(submitter.name)
    ) {
      formData.append(submitter.name, submitter.value);
    }
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
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4 pb-2">
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
                      className={`h-24 w-24 rounded-[8px] border border-line bg-surface-2 object-contain ${
                        isRemoved ? "opacity-30" : ""
                      }`}
                    />
                  </a>
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

        <PhotoPicker key={captureEpoch} name="cardImages" onFilesChanged={onCardPhotosChanged} />

        {transcribe ? (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={aiPending}
              onClick={() => handleTranscribe()}
              data-testid="fill-from-card"
              className="w-full justify-center"
            >
              {aiPending ? (
                <Loader2 className="h-4 w-4 animate-[spin_2.4s_linear_infinite]" strokeWidth={1.5} />
              ) : (
                <Sparkles className="h-4 w-4" strokeWidth={1.5} />
              )}
              {aiPending ? t("aiFilling") : t("aiFillCard")}
            </Button>
            {aiError ? (
              <p className="text-[12px] font-semibold text-danger" data-testid="card-ai-error">
                {aiError === "no-photos" ? t("aiErrorNoPhotos") : t("aiErrorFailed")}
              </p>
            ) : aiNotes ? (
              <p
                className="rounded-[10px] bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-sub"
                data-testid="card-ai-notes"
              >
                {t("aiNotes")}: {aiNotes}
              </p>
            ) : (
              <p className="text-[11px] leading-relaxed text-sub">{t("aiFillCardHelp")}</p>
            )}
          </div>
        ) : null}

        {similar ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-warn-soft px-3 py-2 text-[12.5px] text-warn"
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

      {/*
        Booth is the field this record is used for. A buyer looking a supplier
        up at 9am is asking one question — which aisle, which floor, which shop
        number — so it is tinted, set in the data register, and it sits above
        the contact details rather than at the bottom of the form.
      */}
      <div className="flex flex-col gap-1.5 rounded-[12px] bg-action-soft p-3">
        <Label htmlFor="boothLocation" className="text-action-chrome">
          {t("boothLocation")}
        </Label>
        <Input
          id="boothLocation"
          name="boothLocation"
          numeric
          className="border-line-strong"
          defaultValue={defaultValues?.boothLocation}
        />
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
      <div className="grid grid-cols-2 gap-3">
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
              className="text-[11px] text-sub"
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
                className="h-24 w-24 rounded-[8px] border border-line bg-surface object-contain"
              />
              <div className="flex flex-col gap-1">
                <span className="text-[11px] leading-relaxed text-sub">
                  {t("wechatQrHelp")}
                </span>
                <button
                  type="button"
                  onClick={removeQr}
                  className="focus-ring min-h-11 self-start text-[11px] font-semibold text-sub hover:text-danger"
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
                        className={`h-24 w-24 rounded-[8px] border border-line bg-surface object-contain ${
                          isRemoved ? "opacity-30" : ""
                        }`}
                      />
                    </a>
                    {isRemoved ? (
                      <input type="hidden" name="removeImageIds" value={img.id} />
                    ) : null}
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] leading-relaxed text-sub">
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
                        className="focus-ring min-h-11 self-start text-[11px] font-semibold text-sub hover:text-danger"
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

      {/*
        Bank details are covered until asked for. Not secrecy — a phone held up
        in a crowded aisle simply should not be showing an account number, and
        the act of revealing them is the moment to re-read the card.
      */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="bankInfo">{t("bankInfo")}</Label>
          <button
            type="button"
            onClick={() => setBankVisible((v) => !v)}
            data-testid="toggle-bank-info"
            className="focus-ring flex min-h-11 items-center gap-1.5 px-1 text-[11px] font-semibold text-action-chrome"
          >
            {bankVisible ? (
              <EyeOff className="h-3.5 w-3.5" strokeWidth={1.5} />
            ) : (
              <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
            {bankVisible ? t("bankInfoHide") : t("bankInfoShow")}
          </button>
        </div>
        <Textarea
          id="bankInfo"
          name="bankInfo"
          data-testid="bank-info"
          defaultValue={defaultValues?.bankInfo}
          className={bankVisible ? "font-mono" : "font-mono [-webkit-text-security:disc] [text-security:disc]"}
        />
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warn">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          {t("bankInfoVerify")}
        </p>
        <p className="text-[11px] leading-relaxed text-sub">{t("bankInfoHelp")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea id="notes" name="notes" defaultValue={defaultValues?.notes} />
      </div>

      {result?.error ? (
        <p className="text-[13px] font-semibold text-danger">
          {result.error === "image-error" ? t("errorImage") : common("required")}
        </p>
      ) : null}

      {offlineSaved === "saved" ? (
        <p
          className="rounded-[10px] bg-ok-soft px-3 py-2.5 text-[13px] font-semibold text-ok"
          data-testid="contact-saved-offline"
        >
          {t("savedOffline")}
        </p>
      ) : null}
      {offlineSaved === "store-failed" ? (
        <p className="text-[13px] font-semibold text-danger" data-testid="contact-offline-store-failed">
          {t("offlineStoreFailed")}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}
