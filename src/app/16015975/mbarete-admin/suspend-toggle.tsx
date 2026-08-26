"use client";

import { useTransition } from "react";
import { setCompanySuspended } from "@/lib/platform/actions";
import { nudgeReauth } from "./unlock-panel";
import { Button } from "@/components/ui/button";

/**
 * The freeze switch on a company card. Deliberately wordy — "Freeze" and
 * "Unfreeze" as labeled actions, not an anonymous toggle, because this is
 * the most drastic thing the panel does.
 */
export function SuspendToggle({ companyId, suspended }: { companyId: number; suspended: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      className={suspended ? "" : "text-danger"}
      data-testid={`suspend-company-${companyId}`}
      onClick={() => {
        if (!suspended && !confirm("Freeze this company? Their pages yield to the suspended screen; data and export stay available.")) return;
        startTransition(async () => {
          const r = await setCompanySuspended(companyId, !suspended);
          if (r.error === "reauth") nudgeReauth();
        });
      }}
    >
      {suspended ? "Unfreeze" : "Freeze"}
    </Button>
  );
}
