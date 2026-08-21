"use client";

import {
  Check,
  CloudOff,
  Loader2,
  RefreshCw,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { syncStepFor, type SyncStep } from "@/lib/offline/sync-step";

const LOOK: Record<
  SyncStep,
  { variant: "success" | "warning" | "destructive" | "sync" | "secondary"; Icon: typeof Check; spin?: boolean }
> = {
  offline: { variant: "secondary", Icon: CloudOff },
  savedLocal: { variant: "success", Icon: Smartphone },
  waiting: { variant: "warning", Icon: CloudOff },
  syncing: { variant: "sync", Icon: Loader2, spin: true },
  synced: { variant: "success", Icon: Check },
  failed: { variant: "destructive", Icon: RefreshCw },
  conflict: { variant: "warning", Icon: TriangleAlert },
  imagePending: { variant: "sync", Icon: Loader2 },
};

/**
 * One chip for the whole sync ladder. Its copy is reassuring by rule: once a
 * capture is on the phone the words are "saved" and "waiting", never "error"
 * — "failed" is reserved for a sync attempt the server actually rejected, and
 * it always arrives carrying "Retry".
 */
export function SyncStatusChip({
  step,
  count,
  className,
  ...props
}: {
  step: SyncStep;
  count?: number;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const t = useTranslations("sync");
  const { variant, Icon, spin } = LOOK[step];

  return (
    <Badge
      variant={variant}
      className={className}
      data-testid="sync-chip"
      data-sync-step={step}
      {...props}
    >
      <Icon
        strokeWidth={1.5}
        className={spin ? "animate-[spin_2.4s_linear_infinite]" : undefined}
      />
      <span className="truncate">
        {t(step)}
        {count && count > 0 ? (
          <span className="ml-1 font-mono tabular-nums">· {count}</span>
        ) : null}
      </span>
    </Badge>
  );
}

/**
 * The quiet end of the ladder: a synced row says so with a bare dot, because
 * a list where every row shouts "Synced" teaches the eye to skip the column
 * that matters when one row does not.
 */
export function SyncedDot({ label }: { label: string }) {
  return (
    <span
      className="flex h-2 w-2 shrink-0 rounded-full bg-ok"
      role="img"
      aria-label={label}
      data-testid="synced-dot"
    />
  );
}

export { syncStepFor, type SyncStep };
