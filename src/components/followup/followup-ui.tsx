"use client";

import Image from "next/image";
import { Package } from "lucide-react";
import { authenticatedUploadLoader } from "@/lib/client/upload-image-loader";
import { dueState, initials, type DueState } from "@/lib/followup";
export { formatDay } from "@/lib/followup";
import type { FollowupUser } from "@/lib/followup-server";

/**
 * Small pieces the board and the card panel share: faces, dates, money.
 * Kept presentational — no data loading, no actions.
 */

const MARKS: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€", BRL: "R$" };

/** A card's cost in whole units: "¥364,805", or "¥1,200 + $80" for mixed lines. */
export function costLabel(cost: { currency: string; amount: number }[]): string {
  return cost
    .map((c) => {
      const amount = Math.round(c.amount).toLocaleString("en-US");
      const mark = MARKS[c.currency];
      return mark ? `${mark}${amount}` : `${amount} ${c.currency}`;
    })
    .join(" + ");
}

/** A moment in the feed, in the viewer's own clock: "19 Oct, 09:12". */
export function formatMoment(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export const DUE_CLASS: Record<DueState, string> = {
  overdue: "text-danger font-bold",
  today: "text-warn font-semibold",
  soon: "text-warn font-semibold",
  later: "text-sub",
  none: "text-sub",
};

export function dueInfo(due: string | null, today: string) {
  return dueState(due, today);
}

const TONES = [
  "bg-action-soft text-action-chrome",
  "bg-ok-soft text-ok",
  "bg-warn-soft text-warn",
  "bg-surface-2 text-ink",
];

export function Avatar({
  user,
  size = 26,
  label,
}: {
  user: FollowupUser | undefined;
  size?: number;
  /** What a screen reader hears; defaults to the person's name. */
  label?: string;
}) {
  const style = { width: size, height: size, fontSize: size > 26 ? 12 : 11 };
  if (!user) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong font-bold text-sub"
        style={style}
        title={label}
        aria-label={label}
      >
        ?
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${TONES[user.id % TONES.length]}`}
      style={style}
      title={label ?? user.name}
      aria-label={label ?? user.name}
      data-testid="followup-avatar"
      data-user={user.id}
    >
      {initials(user.name)}
    </span>
  );
}

export function ProductThumb({ path, size = 36 }: { path: string | null; size?: number }) {
  return (
    <span
      className="relative shrink-0 overflow-hidden rounded-[6px] border border-line bg-surface"
      style={{ width: size, height: size }}
    >
      {path ? (
        <Image loader={authenticatedUploadLoader} src={path} alt="" fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-sub">
          <Package size={Math.round(size / 2)} strokeWidth={1.5} />
        </span>
      )}
    </span>
  );
}
