"use client";

import { useState, useTransition } from "react";
import { setAiDailyBudget } from "@/lib/platform/actions";
import { nudgeReauth } from "./unlock-panel";

/**
 * A company's daily AI read cap. Blank follows the plan (the placeholder
 * says what that is), 0 switches AI reading off, any number is a custom
 * cap. Commits on blur or Enter; "plan" clears an override.
 */
export function AiBudgetControl({
  companyId,
  override,
  planLimit,
}: {
  companyId: number;
  override: number | null;
  planLimit: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const shown = override === null ? "" : String(override);
  const [value, setValue] = useState(shown);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next < 0)) {
      setValue(shown);
      return;
    }
    if (next === override) return;
    startTransition(async () => {
      const r = await setAiDailyBudget(companyId, next);
      if (!r.ok) {
        if (r.error === "reauth") nudgeReauth();
        setValue(shown);
      }
    });
  };

  return (
    <span className={`inline-flex items-center gap-1 ${pending ? "opacity-50" : ""}`}>
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={value}
        placeholder={planLimit === null ? "no cap" : `plan ${planLimit}`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        disabled={pending}
        aria-label="AI reads per day"
        data-testid={`ai-budget-${companyId}`}
        className="h-7 w-[5.5rem] rounded-[8px] border border-line bg-surface px-1.5 text-xs tabular-nums text-ink placeholder:text-faint"
      />
      {override !== null ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setValue("");
            commit("");
          }}
          title="Back to the plan's allowance"
          data-testid={`ai-budget-reset-${companyId}`}
          className="text-[11px] text-sub underline-offset-2 hover:text-ink hover:underline"
        >
          plan
        </button>
      ) : null}
    </span>
  );
}
