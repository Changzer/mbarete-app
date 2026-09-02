"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Camera, Contact, Loader2, RefreshCw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DraftListItem } from "@/lib/queries/drafts";
import { discardDraft, importContactDraft, retryReadDraft } from "@/lib/actions/drafts";
import { formatLocalMinute } from "@/lib/format-time";

/**
 * The review queue: everything captured at the market that has not become a
 * catalog entry or a contact yet.
 *
 * A card leads with its photos — that is what the agent remembers a booth
 * by — and shows whatever the AI already read next to whatever was typed.
 * Product drafts open pre-filled in the normal product form; contact drafts
 * import in one tap and get corrected in the contact editor if needed.
 */
export function DraftList({
  drafts,
  aiEnabled = false,
}: {
  drafts: DraftListItem[];
  /** Whether a vision provider is configured — without one, "read again"
   *  could only ever be a button that does nothing. */
  aiEnabled?: boolean;
}) {
  const t = useTranslations("drafts");

  if (drafts.length === 0) {
    return <p className="text-sm text-sub">{t("empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {drafts.map((draft) => (
        <DraftCard key={draft.id} draft={draft} aiEnabled={aiEnabled} />
      ))}
    </div>
  );
}

function DraftCard({ draft, aiEnabled }: { draft: DraftListItem; aiEnabled: boolean }) {
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

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      data-testid="draft-card"
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
          {draft.images.map((img) => (
            <a key={img.id} href={img.path} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.path}
                alt=""
                className="h-20 w-20 rounded-md border border-line bg-surface-2 object-contain"
              />
            </a>
          ))}
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

      {draft.transcriptNotes ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-sub">
          {draft.transcriptNotes}
        </p>
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
