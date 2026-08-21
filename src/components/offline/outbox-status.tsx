"use client";

import { useState } from "react";
import { BookOpen, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOutbox } from "@/components/offline/outbox";
import { OfflineCatalog } from "@/components/offline/offline-catalog";

/**
 * The offline machinery's one visible surface: a strip that exists only while
 * captures are still owed to the server or the server is unreachable — on a
 * normal connected day nobody sees it at all.
 *
 * Anchored above the mobile tab bar (which owns the bottom edge) and kept to
 * one line: "3 waiting", "sending", "sign in again" — plus the way into the
 * phone's read-only catalog copy while there is no server to browse.
 */
export function OutboxStatus() {
  const t = useTranslations("offline");
  const outbox = useOutbox();
  const [catalogOpen, setCatalogOpen] = useState(false);

  if (!outbox) return null;
  if (outbox.pending === 0 && !outbox.offline) return null;

  const label =
    outbox.pending === 0
      ? t("offline")
      : outbox.syncing
        ? t("sending", { count: outbox.pending })
        : outbox.needsSignIn
          ? t("needsSignIn", { count: outbox.pending })
          : outbox.blocked > 0
            ? t("blocked", { count: outbox.pending, blocked: outbox.blocked })
            : t("waiting", { count: outbox.pending });

  return (
    <>
      {/* A floating pill, not a full-width bar: the product form parks its
          save buttons in a fixed bar at bottom-14, and the mobile tab bar owns
          bottom-0 — a strip at either height would sit on top of buttons that
          must stay tappable precisely when the strip is showing. */}
      <div
        role="status"
        data-testid="outbox-status"
        className="fixed bottom-32 right-3 z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-amber-300 bg-amber-50 py-1.5 pl-3 pr-1.5 text-sm text-amber-900 shadow-lg dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 md:bottom-3"
      >
        {outbox.syncing ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : outbox.blocked > 0 || outbox.needsSignIn ? (
          <TriangleAlert className="h-4 w-4 shrink-0" />
        ) : (
          <CloudOff className="h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0 truncate">{label}</span>
        {outbox.offline ? (
          <button
            type="button"
            data-testid="open-offline-catalog"
            onClick={() => setCatalogOpen(true)}
            className="flex shrink-0 items-center gap-1 rounded-full border border-amber-400 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900"
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t("catalogCopyButton")}
          </button>
        ) : null}
      </div>

      <OfflineCatalog open={catalogOpen} onOpenChange={setCatalogOpen} />
    </>
  );
}
