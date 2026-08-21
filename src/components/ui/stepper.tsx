"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Quantity in carton steps, because that is the unit a supplier actually
 * ships. The field stays typeable — a buyer who knows the number should not
 * have to tap +1 forty times — and the buttons move a whole carton at a time.
 */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  label,
  suffix,
  className,
  "data-testid": testId,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  label: string;
  suffix?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const safeStep = step > 0 ? step : 1;

  function move(direction: 1 | -1) {
    // Snap onto the carton grid on the way, so a hand-typed 37 with a step of
    // 12 lands on 48 / 36 rather than carrying the odd number forever.
    const raw = value + direction * safeStep;
    const snapped = Math.round(raw / safeStep) * safeStep;
    const next = Math.max(min, max === undefined ? snapped : Math.min(max, snapped));
    onChange(next);
  }

  return (
    <div
      data-touch-target=""
      className={cn(
        "flex h-11 items-center rounded-[10px] border border-line bg-surface focus-within:border-action",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => move(-1)}
        disabled={value <= min}
        aria-label={`${label} −${safeStep}`}
        data-testid={testId ? `${testId}-minus` : undefined}
        className="press focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-l-[10px] text-sub disabled:text-faint"
      >
        <Minus className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={value === 0 ? "" : String(value)}
        placeholder="0"
        data-testid={testId}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, "");
          onChange(digits === "" ? min : Number(digits));
        }}
        className="focus-ring min-w-0 flex-1 bg-transparent text-center font-mono text-[14px] font-medium tabular-nums text-ink placeholder:text-faint"
      />
      {suffix ? (
        <span aria-hidden className="shrink-0 pr-1 text-[11px] text-faint">
          {suffix}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => move(1)}
        disabled={max !== undefined && value >= max}
        aria-label={`${label} +${safeStep}`}
        data-testid={testId ? `${testId}-plus` : undefined}
        className="press focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-r-[10px] text-sub disabled:text-faint"
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
