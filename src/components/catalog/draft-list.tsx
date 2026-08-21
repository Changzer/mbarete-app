"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Camera, Contact, Loader2, RefreshCw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DraftListItem } from "@/lib/queries/drafts";
import { discardDraft, importContactDraft, retryReadDraft } from "@/lib/actions/drafts";

/**
 * The review queue: everything captured at the market that has not become a
 * catalog entry or a contact yet.
 *
 * A card leads with its photos — that is what the agent remembers a booth
 * by — and shows whatever the AI already read next to whatever was typed.
 * Product drafts open pre-filled in the normal product form; contact drafts
 * import in one tap and get corrected in the contact editor if needed.
 */
export function DraftList({ drafts }: { drafts: DraftListItem[] }) {
  const t = useTranslations("drafts");

  if (drafts.length === 0) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {drafts.map((draft) => (
        <DraftCard key={draft.id} draft={draft} />
      ))}
    </div>
  );
}

function DraftCard({ draft }: { draft: DraftListItem }) {
  const t = useTranslations("drafts");
  const common = useTranslations("common");
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
  const captured = draft.capturedAt.slice(0, 16).replace("T", " ");

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      data-testid="draft-card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {draft.kind === "contact" ? (
            <Contact className="h-4 w-4 shrink-0 text-neutral-400" />
          ) : (
            <Camera className="h-4 w-4 shrink-0 text-neutral-400" />
          )}
          <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
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
                className="h-20 w-20 rounded-md border border-neutral-200 bg-neutral-100 object-contain dark:border-neutral-800 dark:bg-neutral-800"
              />
            </a>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600 dark:text-neutral-400">
        {price ? (
          <span>
            {price} {currency}
          </span>
        ) : null}
        <span>{captured}</span>
        {draft.userName ? <span>{draft.userName}</span> : null}
      </div>

      {draft.transcriptNotes ? (
        <p className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          {draft.transcriptNotes}
        </p>
      ) : null}

      {/* An unread draft with no error is normal (waiting for its read);
          a recorded error means someone should press the retry. */}
      {draft.status === "pending" && draft.transcriptError ? (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="draft-read-error">
          {t("readFailed")}
        </p>
      ) : null}
      {importError ? (
        <p className="text-xs text-red-600" data-testid="draft-import-error">
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

        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          data-testid="discard-draft"
          className="text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
          onClick={() => {
            if (confirm(t("discardConfirm"))) {
              startTransition(() => discardDraft(draft.id));
            }
          }}
        >
          {common("delete")}
        </Button>
      </div>
    </div>
  );
}
