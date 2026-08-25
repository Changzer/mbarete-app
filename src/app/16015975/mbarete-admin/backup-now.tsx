"use client";

import { useState, useTransition } from "react";
import { backupNow } from "@/lib/platform/actions";
import { nudgeReauth } from "./unlock-panel";

/** The "before I touch anything" button. Result stays visible in place. */
export function BackupNow() {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        data-testid="backup-now"
        onClick={() =>
          startTransition(async () => {
            const r = await backupNow();
            if (!r.ok && r.detail === "reauth") {
              nudgeReauth();
              setNote(null);
              return;
            }
            setNote(r.ok ? `done — ${r.detail}` : `failed — ${r.detail}`);
          })
        }
        className="h-7 rounded-[8px] border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
      >
        {pending ? "Backing up…" : "Back up now"}
      </button>
      {note ? (
        <span className="text-[11px] text-sub" data-testid="backup-note">
          {note}
        </span>
      ) : null}
    </span>
  );
}
