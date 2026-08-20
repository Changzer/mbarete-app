"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
}) {
  const t = useTranslations("contacts");
  const common = useTranslations("common");

  async function wrappedAction(
    prevState: ContactActionResult | undefined,
    formData: FormData,
  ) {
    const result = await action(prevState, formData);
    if (!result.error) onSuccess?.(result.id);
    return result;
  }

  const [result, formAction, isPending] = useActionState(wrappedAction, undefined);

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
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => {
      void handleTranscribe(true);
    }, 1500);
  }

  // WeChat QR found on the card, cropped in the browser. It uploads with the
  // form (hidden file input) and is shown next to the WeChat field — the QR
  // itself is the contact method; no model can turn it into an ID.
  const [qr, setQr] = useState<{ file: File; url: string } | null>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);
  const qrScanned = useRef(new Set<string>());
  useEffect(() => () => {
    if (qr) URL.revokeObjectURL(qr.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function detectQr(files: File[]) {
    void (async () => {
      for (const file of files) {
        const seen = `${file.name}:${file.size}`;
        if (qrScanned.current.has(seen)) continue;
        qrScanned.current.add(seen);
        const found = await extractQrFromImage(file);
        if (!found) continue;
        setQr((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return { file: found, url: URL.createObjectURL(found) };
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
        break;
      }
    })();
  }

  function removeQr() {
    setQr((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    if (qrInputRef.current) qrInputRef.current.value = "";
  }

  function onCardPhotosChanged(files: File[]) {
    scheduleCardTranscribe(files);
    detectQr(files);
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
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

        <PhotoPicker name="cardImages" onFilesChanged={onCardPhotosChanged} />

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

      <Button type="submit" disabled={isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}
