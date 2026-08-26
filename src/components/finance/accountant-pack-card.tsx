"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { closePeriod } from "@/lib/actions/accountant";

/**
 * The finance page's door to the accountant pack: pick a period, download
 * the ZIP, and optionally close the period — recording today's data digest
 * so later edits become visible. The card explains itself because its
 * audience is the tenant, not the accountant; the pack's README does the
 * explaining on the other side.
 */
export function AccountantPackCard({
  currency,
  closes,
}: {
  currency: string;
  /** period key → closedAt, the recent closes for status display */
  closes: Record<string, string>;
}) {
  const t = useTranslations("accountantPack");
  const router = useRouter();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [from, setFrom] = useState(thisMonth);
  const [to, setTo] = useState(thisMonth);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  const valid = /^\d{4}-\d{2}$/.test(from) && /^\d{4}-\d{2}$/.test(to) && from <= to;
  const key = from === to ? from : `${from}~${to}`;
  const closedAt = closes[key];

  return (
    <div className="rounded-[12px] border border-line bg-surface p-4" data-testid="accountant-pack">
      <div className="mb-1 text-sm font-bold text-ink">{t("title")}</div>
      <p className="mb-3 text-[12px] leading-relaxed text-sub">{t("help")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="month"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-8 rounded-[8px] border border-line bg-surface px-2 text-xs text-ink"
          data-testid="pack-from"
        />
        <span className="text-xs text-faint">—</span>
        <input
          type="month"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-8 rounded-[8px] border border-line bg-surface px-2 text-xs text-ink"
          data-testid="pack-to"
        />
        <Button asChild size="sm" variant={valid ? "default" : "outline"}>
          <a
            href={`/api/export/accountant-pack?from=${from}&to=${to}&currency=${currency}`}
            download
            data-testid="pack-download"
          >
            {t("download")}
          </a>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !valid}
          data-testid="pack-close"
          onClick={() => {
            if (!confirm(t("closeConfirm"))) return;
            startTransition(async () => {
              setError(false);
              const r = await closePeriod(from, to);
              if (!r.ok) setError(true);
              else router.refresh();
            });
          }}
        >
          {closedAt ? t("closeAgain") : t("close")}
        </Button>
        {closedAt ? (
          <span className="text-[11px] text-sub" data-testid="pack-close-status">
            {t("closedAt", { date: closedAt.slice(0, 10) })}
          </span>
        ) : null}
        {error ? <span className="text-[11px] text-danger">{t("closeFailed")}</span> : null}
      </div>
    </div>
  );
}
