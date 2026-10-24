"use client";

import { useTranslations } from "next-intl";

/** What the model read off the price board, and its notes — shown beside the fields it filled. */
export function AiReading({ boardText, notes }: { boardText: string | null; notes: string | null }) {
  const t = useTranslations("catalog");
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-sub">
      {boardText ? (
        <p data-testid="ai-board-text">
          <span className="font-semibold">{t("aiBoardRead")}:</span>{" "}
          <span className="whitespace-pre-wrap font-mono">{boardText}</span>
        </p>
      ) : null}
      {notes ? (
        <p data-testid="ai-notes">
          {t("aiNotes")}: {notes}
        </p>
      ) : null}
    </div>
  );
}
