"use client";

import { useTransition } from "react";
import { approveCompany } from "@/lib/platform/actions";
import { nudgeReauth } from "./unlock-panel";
import { Button } from "@/components/ui/button";

/** Lets one pending company into service; the row disappears on success. */
export function ApproveButton({ companyId }: { companyId: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      data-testid={`approve-company-${companyId}`}
      onClick={() =>
        startTransition(async () => {
          const r = await approveCompany(companyId);
          if (r.error === "reauth") nudgeReauth();
        })
      }
    >
      Approve
    </Button>
  );
}
