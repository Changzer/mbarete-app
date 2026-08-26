"use client";

import { useState, useTransition } from "react";
import { makePasswordResetLink } from "@/lib/platform/actions";
import { nudgeReauth } from "./unlock-panel";
import { Button } from "@/components/ui/button";

/**
 * The operator's recovery tool: type a tenant user's email, get the same
 * one-time reset link the email flow would have sent, hand it over on
 * whatever channel works. Built for the day a tenant forgets their password
 * while SMTP is down — which was day one.
 */
export function ResetLink() {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="user@company.com"
        className="h-7 w-52 rounded-[8px] border border-line bg-surface px-2 text-xs text-ink placeholder:text-faint"
        data-testid="reset-link-email"
      />
      <Button
        variant="outline"
        size="sm"
        disabled={pending || !email}
        data-testid="reset-link-make"
        onClick={() =>
          startTransition(async () => {
            setLink(null);
            setError(null);
            const r = await makePasswordResetLink(email);
            if (r.error === "reauth") {
              nudgeReauth();
              return;
            }
            if (!r.ok || !r.link) {
              setError("No active user with that email.");
              return;
            }
            setLink(r.link);
            try {
              await navigator.clipboard.writeText(r.link);
            } catch {
              // Clipboard needs a secure context; the visible link below
              // stays selectable either way.
            }
          })
        }
      >
        Reset link
      </Button>
      {link ? (
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="h-7 w-72 rounded-[8px] border border-line bg-surface-2 px-2 font-mono text-[11px] text-ink"
          data-testid="reset-link-value"
          title="One-time link, valid 30 minutes — copied to clipboard"
        />
      ) : null}
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
