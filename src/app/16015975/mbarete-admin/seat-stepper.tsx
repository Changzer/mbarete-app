"use client";

import { useTransition } from "react";
import { setExtraSeats } from "@/lib/platform/actions";

/**
 * Extra seats sold to a company on top of its plan's cap. Billing is manual,
 * so this stepper is the ledger: collect the payment, click plus. Stacks on
 * any plan and survives plan changes.
 */
export function SeatStepper({ companyId, extraSeats }: { companyId: number; extraSeats: number }) {
  const [pending, startTransition] = useTransition();
  const step = (delta: number) =>
    startTransition(() => setExtraSeats(companyId, extraSeats + delta));
  const buttonClass =
    "h-6 w-6 rounded-[6px] border border-line bg-surface text-xs text-ink hover:bg-surface-2 disabled:opacity-40";
  return (
    <span className={`inline-flex items-center gap-1 ${pending ? "opacity-50" : ""}`}>
      <button
        type="button"
        className={buttonClass}
        disabled={pending || extraSeats <= 0}
        onClick={() => step(-1)}
        data-testid={`seats-minus-${companyId}`}
        aria-label="one seat fewer"
      >
        −
      </button>
      <span
        className="min-w-6 text-center text-xs tabular-nums text-ink"
        data-testid={`extra-seats-${companyId}`}
      >
        +{extraSeats}
      </span>
      <button
        type="button"
        className={buttonClass}
        disabled={pending}
        onClick={() => step(1)}
        data-testid={`seats-plus-${companyId}`}
        aria-label="one seat more"
      >
        +
      </button>
    </span>
  );
}
