"use client";

import { useState } from "react";
import { BookOpen, CloudOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOutbox } from "@/components/offline/outbox";
import { OfflineCatalog } from "@/components/offline/offline-catalog";

/**
 * The neutral strip at the top of a list while the server is out of reach.
 *
 * Deliberately not an alarm: the catalog below it is the phone's own copy and
 * is perfectly usable, and captures keep working. Amber would tell the agent
 * to stop working, which is the opposite of true.
 */
export function OfflineStrip({ className }: { className?: string }) {
  const t = useTranslations("sync");
  const offline = useTranslations("offline");
  const outbox = useOutbox();
  const [catalogOpen, setCatalogOpen] = useState(false);

  if (!outbox?.offline) return null;

  return (
    <>
      <div
        role="status"
        data-testid="offline-strip"
        className={`flex items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[12px] text-sub ${className ?? ""}`}
      >
        <CloudOff className="h-4 w-4 shrink-0" strokeWidth={1.5} />
        <span className="min-w-0 flex-1">{t("offlineStrip")}</span>
        {/* The list behind this strip is whatever the server last sent; this
            is the phone's own copy, which searches booths and SKUs when there
            is nothing left to fetch from. */}
        <button
          type="button"
          data-testid="open-offline-catalog"
          onClick={() => setCatalogOpen(true)}
          className="press focus-ring flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-semibold text-action-chrome"
        >
          <BookOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
          {offline("catalogCopyButton")}
        </button>
      </div>
      <OfflineCatalog open={catalogOpen} onOpenChange={setCatalogOpen} />
    </>
  );
}
