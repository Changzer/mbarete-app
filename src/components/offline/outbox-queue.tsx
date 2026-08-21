"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Contact, RefreshCw, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOutbox } from "@/components/offline/outbox";
import { formatLocalMinute } from "@/lib/format-time";
import type { OfflineDraft } from "@/lib/offline/draft";

/**
 * The phone's own queue, opened from the status pill: every capture still
 * owed to the server, each with a way forward.
 *
 * This sheet exists for the stuck ones. A pending capture delivers itself and
 * needs nothing from anybody; a blocked capture — one the server refused —
 * would otherwise sit behind the pill's "needs attention" forever with no way
 * to see which capture it is, why it stopped, or to do anything about it.
 * Here it can be retried by hand (after signing in, or an app update) or,
 * behind a confirm, deliberately given up on — the one deletion in this whole
 * feature that does not require the server to hold a copy first.
 */
export function OutboxQueue({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("offline");
  const outbox = useOutbox();
  const [drafts, setDrafts] = useState<OfflineDraft[] | null>(null);

  const listUnsent = outbox?.listUnsent;
  const reload = useCallback(() => {
    if (!listUnsent) return Promise.resolve();
    return listUnsent().then(setDrafts);
  }, [listUnsent]);

  // Reloaded on every open; the list from a previous open may flash for a
  // frame. setDrafts always lands from a promise, never synchronously —
  // which is what the hook rules ask of effects.
  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  if (!outbox) return null;

  const label = (draft: OfflineDraft) => {
    const f = draft.fields;
    return (
      f.nameEn ||
      f.nameZh ||
      f.companyName ||
      f.companyNameZh ||
      formatLocalMinute(draft.capturedAt)
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("queueTitle")}</DialogTitle>
        </DialogHeader>

        {drafts && drafts.length === 0 ? (
          <p className="text-sm text-sub">{t("queueEmpty")}</p>
        ) : null}

        <div className="-mx-1 flex-1 overflow-y-auto px-1" data-testid="outbox-queue-list">
          {(drafts ?? []).map((draft) => (
            <div
              key={draft.clientId}
              className="flex flex-col gap-2 border-b border-line py-3 last:border-0"
              data-testid="outbox-queue-item"
            >
              <div className="flex items-center gap-2">
                {draft.kind === "contact" ? (
                  <Contact className="h-4 w-4 shrink-0 text-faint" />
                ) : (
                  <Camera className="h-4 w-4 shrink-0 text-faint" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {label(draft)}
                </span>
                <span className="shrink-0 text-xs text-sub">
                  {t("queuePhotos", { count: draft.images.length })}
                </span>
              </div>

              {draft.status === "blocked" ? (
                <p className="flex items-center gap-1.5 text-xs text-warn">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  {t("queueBlocked")}
                  {draft.lastError ? (
                    <span className="text-faint">
                      ({draft.lastError})
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="text-xs text-sub">
                  {t("queueWaiting")}
                </p>
              )}

              <div className="flex gap-2">
                {draft.status === "blocked" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="queue-retry"
                    onClick={async () => {
                      await outbox.retry(draft.clientId);
                      await reload();
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t("queueRetry")}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="queue-discard"
                  className="text-sub hover:text-danger"
                  onClick={async () => {
                    if (!confirm(t("queueDiscardConfirm"))) return;
                    await outbox.discard(draft.clientId);
                    await reload();
                  }}
                >
                  {t("queueDiscard")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
