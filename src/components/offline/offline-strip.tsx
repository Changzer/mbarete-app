"use client";

import { CloudOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOutbox } from "@/components/offline/outbox";

/**
 * The neutral strip at the top of a list while the server is out of reach.
 *
 * Deliberately not an alarm: the catalog below it is the phone's own copy and
 * is perfectly usable, and captures keep working. Amber would tell the agent
 * to stop working, which is the opposite of true.
 */
export function OfflineStrip({ className }: { className?: string }) {
  const t = useTranslations("sync");
  const outbox = useOutbox();

  if (!outbox?.offline) return null;

  return (
    <div
      role="status"
      data-testid="offline-strip"
      className={`flex items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[12px] text-sub ${className ?? ""}`}
    >
      <CloudOff className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      <span className="min-w-0">{t("offlineStrip")}</span>
    </div>
  );
}
