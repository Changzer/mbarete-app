"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unlockPlatform } from "@/lib/platform/actions";

/** The event every refused write fires, so the prompt can call attention. */
export const REAUTH_EVENT = "mbarete:reauth-needed";

/**
 * The step-up prompt: looking at the panel takes a session, changing
 * anything takes the operator's password again, recently. The server holds
 * the actual 15-minute window (reauth.ts) — this box only opens it and
 * mirrors its state; a mutation attempted after expiry is refused there
 * and lands back here via the event.
 */
export function UnlockPanel({ unlocked }: { unlocked: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [nudged, setNudged] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onNeeded = () => {
      setNudged(true);
      inputRef.current?.focus();
    };
    window.addEventListener(REAUTH_EVENT, onNeeded);
    return () => window.removeEventListener(REAUTH_EVENT, onNeeded);
  }, []);

  if (unlocked && !nudged) {
    return (
      <span className="text-[11px] text-sub" data-testid="platform-unlocked">
        Changes unlocked for 15 min
      </span>
    );
  }

  const submit = () =>
    startTransition(async () => {
      const r = await unlockPlatform(password);
      if (r.ok) {
        setPassword("");
        setNote(null);
        setNudged(false);
        router.refresh();
      } else {
        setNote(r.error === "rate-limited" ? "Too many tries — wait a few minutes" : "Wrong password");
      }
    });

  return (
    <span className="inline-flex items-center gap-2" data-testid="platform-locked">
      <span className={`text-[11px] ${nudged ? "font-medium text-amber-700" : "text-sub"}`}>
        {nudged ? "Confirm your password to make changes" : "Changes locked"}
      </span>
      <input
        ref={inputRef}
        type="password"
        value={password}
        placeholder="Password"
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && password) submit();
        }}
        data-testid="unlock-password"
        className="h-7 w-32 rounded-[8px] border border-line bg-surface px-2 text-xs text-ink"
      />
      <button
        type="button"
        disabled={pending || !password}
        onClick={submit}
        data-testid="unlock-submit"
        className="h-7 rounded-[8px] border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
      >
        {pending ? "Checking…" : "Unlock"}
      </button>
      {note ? (
        <span className="text-[11px] text-danger" data-testid="unlock-note">
          {note}
        </span>
      ) : null}
    </span>
  );
}

/** Shared by the write controls: surface a refusal as a nudge at the prompt. */
export function nudgeReauth() {
  window.dispatchEvent(new Event(REAUTH_EVENT));
}
