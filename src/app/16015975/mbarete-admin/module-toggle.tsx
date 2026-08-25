"use client";

import { useTransition } from "react";
import { setCompanyModule } from "@/lib/platform/actions";
import { nudgeReauth } from "./unlock-panel";

/**
 * One module switch on one company row. Optimism-free on purpose: the row
 * re-renders from the database after the action, so what the panel shows is
 * always what tenants actually get.
 */
export function ModuleToggle({
  companyId,
  module,
  enabled,
}: {
  companyId: number;
  module: "orders" | "finance";
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={pending}
      data-testid={`module-${module}-${companyId}`}
      onClick={() =>
        startTransition(async () => {
          const r = await setCompanyModule(companyId, module, !enabled);
          if (r.error === "reauth") nudgeReauth();
        })
      }
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        enabled ? "bg-action" : "bg-line"
      } ${pending ? "opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
