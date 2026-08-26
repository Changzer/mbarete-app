"use client";

import { useState, useTransition } from "react";
import { sendTestEmail } from "@/lib/platform/actions";
import { nudgeReauth } from "./unlock-panel";

/**
 * "Does outbound mail actually work?" in one click. The failure text is the
 * SMTP server's own — "Invalid login", "550 no such user", a timeout — so a
 * broken mail setup is diagnosed here instead of inside the container.
 */
export function TestEmail() {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        data-testid="test-email"
        onClick={() =>
          startTransition(async () => {
            const r = await sendTestEmail();
            if (!r.ok && r.detail === "reauth") {
              nudgeReauth();
              setNote(null);
              return;
            }
            setNote({ ok: r.ok, text: r.detail });
          })
        }
        className="h-7 rounded-[8px] border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Test email"}
      </button>
      {note ? (
        <span
          className={`max-w-[360px] truncate text-[11px] ${note.ok ? "text-sub" : "font-medium text-danger"}`}
          title={note.text}
          data-testid="test-email-note"
        >
          {note.ok ? `sent — ${note.text}` : `failed — ${note.text}`}
        </span>
      ) : null}
    </span>
  );
}
