"use client";

import { useTransition } from "react";
import { setCompanyPlan } from "@/lib/platform/actions";
import { PLAN_IDS, type PlanId } from "@/lib/plans";
import { nudgeReauth } from "./unlock-panel";

/**
 * The plan picker on a company row. Choosing a plan also applies its module
 * defaults — the two switches beside it snap to the tier, then stay
 * individually overridable.
 */
export function PlanSelect({ companyId, plan }: { companyId: number; plan: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <select
      value={PLAN_IDS.includes(plan as PlanId) ? plan : "free"}
      disabled={pending}
      data-testid={`plan-select-${companyId}`}
      onChange={(e) =>
        startTransition(async () => {
          const r = await setCompanyPlan(companyId, e.target.value as PlanId);
          if (r.error === "reauth") nudgeReauth();
        })
      }
      className={`h-7 rounded-[8px] border border-line bg-surface px-1.5 text-xs text-ink ${
        pending ? "opacity-50" : ""
      }`}
    >
      {PLAN_IDS.map((id) => (
        <option key={id} value={id}>
          {id}
        </option>
      ))}
    </select>
  );
}
