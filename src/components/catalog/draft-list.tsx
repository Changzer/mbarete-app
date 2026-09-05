"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Camera, Contact, Loader2, RefreshCw, ScanSearch } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DraftListItem } from "@/lib/queries/drafts";
import {
  approveSupplierReading,
  assignDraftSupplier,
  assignVisitSupplier,
  discardDraft,
  identifySupplier,
  importContactDraft,
  retryReadDraft,
} from "@/lib/actions/drafts";
import type { SupplierReading } from "@/lib/capture-visits";
import { formatLocalMinute } from "@/lib/format-time";

/**
 * The review queue, grouped by booth visit.
 *
 * A visit's header carries the one decision that matters for provenance —
 * which supplier — and applies it to every capture of the visit that has
 * not chosen its own, including captures still on a phone. The supplier
 * can be picked from the list, or read off any photo of the visit (a card
 * lying beside the product, a booth sign) and approved; the photo stays
 * exactly where it is. Each card leads with its photos and shows whatever
 * the AI already read, with the fields it was unsure of named first.
 */

export type SupplierChoice = { id: number; name: string; booth: string };

export function DraftList({
  drafts,
  aiEnabled = false,
  suppliers = [],
}: {
  drafts: DraftListItem[];
  /** Whether a vision provider is configured — without one, "read again"
   *  could only ever be a button that does nothing. */
  aiEnabled?: boolean;
  suppliers?: SupplierChoice[];
}) {
  const t = useTranslations("drafts");

  if (drafts.length === 0) {
    return <p className="text-sm text-sub">{t("empty")}</p>;
  }

  // Visits in order of their newest capture; captures without a visit
  // (the old form's queue, older data) follow as single cards.
  const groups = new Map<string, DraftListItem[]>();
  for (const draft of drafts) {
    const key = draft.visitId ?? `solo-${draft.id}`;
    const list = groups.get(key) ?? [];
    list.push(draft);
    groups.set(key, list);
  }

  return (
    <div className="flex flex-col gap-6">
      {[...groups.entries()].map(([key, items]) => (
        <VisitGroup
          key={key}
          visitId={items[0].visitId}
          drafts={items}
          aiEnabled={aiEnabled}
          suppliers={suppliers}
        />
      ))}
    </div>
  );
}

function VisitGroup({
  visitId,
  drafts,
  aiEnabled,
  suppliers,
}: {
  visitId: string | null;
  drafts: DraftListItem[];
  aiEnabled: boolean;
  suppliers: SupplierChoice[];
}) {
  const t = useTranslations("drafts");
  const [isPending, startTransition] = useTransition();
  const [identifying, setIdentifying] = useState(false);
  const [reading, setReading] = useState<SupplierReading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visitSupplierId = drafts[0].visitSupplierId;
  const visitSupplierName =
    visitSupplierId !== null ? suppliers.find((s) => s.id === visitSupplierId)?.name ?? null : null;
  const started = drafts.map((d) => d.capturedAt).sort()[0];

  function pickForVisit(imageId: number) {
    setError(null);
    startTransition(async () => {
      const result = await identifySupplier(imageId);
      if (result.ok) setReading(result.reading);
      else setError(result.error === "limit" ? t("readLimited") : t("identifyFailed"));
      setIdentifying(false);
    });
  }

  function approve(useExistingId: number | null) {
    if (!reading) return;
    setError(null);
    startTransition(async () => {
      const result = await approveSupplierReading({
        clientVisitId: visitId,
        draftId: reading.draftId,
        useExistingId,
        fields: reading.fields,
      });
      if (result.error) setError(t("identifyFailed"));
      else setReading(null);
    });
  }

  return (
    <section className="flex flex-col gap-3" data-testid={visitId ? `visit-${visitId}` : `solo-${drafts[0].id}`}>
      {visitId ? (
        <header className="rounded-lg border border-line bg-surface-2 px-4 py-3" data-testid="visit-header">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-semibold text-ink">
                {t("visitTitle", { count: drafts.length })}
              </span>
              <span className="ml-2 text-xs text-sub" suppressHydrationWarning>
                {formatLocalMinute(started)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-sub">
                {t("visitSupplier")}
                <select
                  value={visitSupplierId ?? ""}
                  disabled={isPending}
                  data-testid="visit-supplier-select"
                  onChange={(e) => {
                    const value = e.target.value ? Number(e.target.value) : null;
                    setError(null);
                    startTransition(async () => {
                      const err = await assignVisitSupplier(visitId, value);
                      if (err) setError(t("identifyFailed"));
                    });
                  }}
                  className="h-8 max-w-[220px] rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink"
                >
                  <option value="">{t("supplierUnset")}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              {aiEnabled ? (
                <Button
                  variant={identifying ? "default" : "outline"}
                  size="sm"
                  disabled={isPending}
                  data-testid="identify-supplier"
                  onClick={() => {
                    setReading(null);
                    setIdentifying((v) => !v);
                  }}
                >
                  <ScanSearch className="h-4 w-4" />
                  {identifying ? t("identifyCancel") : t("identifyFromPhoto")}
                </Button>
              ) : null}
            </div>
          </div>
          {visitSupplierName ? (
            <p className="mt-1 text-xs text-sub" data-testid="visit-supplier-name">
              {t("visitResolves", { name: visitSupplierName })}
            </p>
          ) : null}
          {identifying ? (
            <p className="mt-2 text-xs text-sub" data-testid="identify-hint">
              {t("identifyHint")}
            </p>
          ) : null}
          {isPending && identifying === false && reading === null ? (
            <p className="mt-2 flex items-center gap-1 text-xs text-sub">
              <Loader2 className="h-3 w-3 animate-spin" /> {t("identifying")}
            </p>
          ) : null}
          {reading ? (
            <div className="mt-3 rounded-md border border-line bg-surface p-3 text-sm" data-testid="supplier-reading">
              <div className="font-semibold text-ink">
                {reading.fields.companyName || reading.fields.companyNameZh || t("readingNoName")}
              </div>
              {reading.fields.companyName && reading.fields.companyNameZh ? (
                <div className="text-sub">{reading.fields.companyNameZh}</div>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-sub">
                {reading.fields.contactPerson ? <span>{reading.fields.contactPerson}</span> : null}
                {reading.fields.phone ? <span>{reading.fields.phone}</span> : null}
                {reading.fields.boothLocation ? <span>{reading.fields.boothLocation}</span> : null}
              </div>
              {reading.notes ? <p className="mt-1 text-xs text-faint">{reading.notes}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {reading.match ? (
                  <Button size="sm" disabled={isPending} data-testid="use-matched-supplier" onClick={() => approve(reading.match!.id)}>
                    {t("useExisting", { name: reading.match.companyName || reading.match.companyNameZh })}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant={reading.match ? "outline" : "default"}
                  disabled={isPending}
                  data-testid="create-supplier-from-reading"
                  onClick={() => approve(null)}
                >
                  {t("createFromReading")}
                </Button>
                <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setReading(null)}>
                  {t("identifyCancel")}
                </Button>
              </div>
            </div>
          ) : null}
          {error ? (
            <p className="mt-2 text-xs text-danger" data-testid="visit-error">
              {error}
            </p>
          ) : null}
        </header>
      ) : null}

      {drafts.map((draft) => (
        <DraftCard
          key={draft.id}
          draft={draft}
          aiEnabled={aiEnabled}
          suppliers={suppliers}
          identifying={identifying}
          onPickImage={pickForVisit}
        />
      ))}
    </section>
  );
}

function DraftCard({
  draft,
  aiEnabled,
  suppliers,
  identifying,
  onPickImage,
}: {
  draft: DraftListItem;
  aiEnabled: boolean;
  suppliers: SupplierChoice[];
  identifying: boolean;
  onPickImage: (imageId: number) => void;
}) {
  const t = useTranslations("drafts");
  const [isPending, startTransition] = useTransition();
  const [importError, setImportError] = useState(false);

  const name =
    draft.fields.nameEn ||
    draft.fields.nameZh ||
    draft.fields.companyName ||
    draft.fields.companyNameZh ||
    draft.transcript.nameEn ||
    draft.transcript.nameZh ||
    draft.transcript.companyName ||
    draft.transcript.companyNameZh ||
    "";

  const price = draft.fields.price || (draft.transcript.price?.toString() ?? "");
  const currency = draft.fields.currency || draft.transcript.currency || "";
  const captured = formatLocalMinute(draft.capturedAt);
  const uncertain = draft.transcript.uncertain ?? [];
  const note = draft.fields.notes ?? "";

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      data-testid="draft-card"
      data-draft-id={draft.id}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {draft.kind === "contact" ? (
            <Contact className="h-4 w-4 shrink-0 text-faint" />
          ) : (
            <Camera className="h-4 w-4 shrink-0 text-faint" />
          )}
          <span className="truncate font-medium text-ink">
            {name || t("unnamed")}
          </span>
        </div>
        <Badge variant={draft.status === "read" ? "default" : "secondary"}>
          {draft.status === "read" ? t("statusRead") : t("statusPending")}
        </Badge>
      </div>

      {draft.images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {draft.images.map((img) =>
            identifying ? (
              <button
                key={img.id}
                type="button"
                onClick={() => onPickImage(img.id)}
                className="press rounded-md ring-2 ring-action"
                data-testid={`identify-image-${img.id}`}
                aria-label={t("identifyFromThis")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.path} alt="" className="h-20 w-20 rounded-md border border-line bg-surface-2 object-contain" />
              </button>
            ) : (
              <a key={img.id} href={img.path} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.path}
                  alt=""
                  className="h-20 w-20 rounded-md border border-line bg-surface-2 object-contain"
                />
              </a>
            ),
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-sub">
        {price ? (
          <span>
            {price} {currency}
          </span>
        ) : null}
        <span suppressHydrationWarning>{captured}</span>
        {draft.userName ? <span>{draft.userName}</span> : null}
      </div>

      {uncertain.length > 0 ? (
        <p className="text-xs font-medium text-warn" data-testid="draft-uncertain">
          {t("checkFields", { fields: uncertain.join(", ") })}
        </p>
      ) : null}

      {note ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-ink" data-testid="draft-note">
          {t("boothNote")}: {note}
        </p>
      ) : null}

      {draft.transcriptNotes ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-sub">
          {draft.transcriptNotes}
        </p>
      ) : null}

      {draft.kind === "product" ? (
        <label className="flex flex-wrap items-center gap-1.5 text-xs text-sub" data-testid="draft-supplier">
          {t("supplier")}
          <select
            value={draft.supplierId ?? ""}
            disabled={isPending}
            data-testid="draft-supplier-select"
            onChange={(e) => {
              const value = e.target.value ? Number(e.target.value) : null;
              startTransition(async () => {
                await assignDraftSupplier(draft.id, value);
              });
            }}
            className="h-8 max-w-[220px] rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink"
          >
            <option value="">
              {draft.visitId
                ? draft.visitSupplierId !== null && draft.effectiveSupplierName
                  ? t("followsVisit", { name: draft.effectiveSupplierName })
                  : t("followsVisitUnset")
                : t("supplierUnset")}
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {draft.effectiveSupplierName ? (
            <span className="text-ink" data-testid="draft-effective-supplier">
              → {draft.effectiveSupplierName}
            </span>
          ) : null}
        </label>
      ) : null}

      {/* An unread draft with no error is normal (waiting for its read);
          a recorded error means someone should press the retry. Shown for
          read drafts too — their re-read can fail just the same. */}
      {draft.transcriptError ? (
        <p className="text-xs text-warn" data-testid="draft-read-error">
          {draft.transcriptError === "limit" ? t("readLimited") : t("readFailed")}
        </p>
      ) : null}
      {importError ? (
        <p className="text-xs text-danger" data-testid="draft-import-error">
          {t("importFailed")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {draft.kind === "product" ? (
          <Button asChild size="sm" data-testid="open-draft">
            <Link href={`/catalog/new?draft=${draft.id}`}>{t("openInForm")}</Link>
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={isPending}
            data-testid="import-contact-draft"
            onClick={() => {
              setImportError(false);
              startTransition(async () => {
                const error = await importContactDraft(draft.id);
                if (error) setImportError(true);
              });
            }}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("importContact")}
          </Button>
        )}

        {aiEnabled ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            data-testid="retry-read"
            onClick={() => startTransition(() => retryReadDraft(draft.id))}
          >
            <RefreshCw className="h-4 w-4" />
            {t("retryRead")}
          </Button>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          data-testid="discard-draft"
          className="text-sub hover:text-danger"
          onClick={() => {
            if (confirm(t("discardConfirm"))) {
              startTransition(() => discardDraft(draft.id));
            }
          }}
        >
          {t("discard")}
        </Button>
      </div>
    </div>
  );
}
