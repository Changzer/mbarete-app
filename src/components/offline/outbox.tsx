"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  applyAttempt,
  collectDraftFields,
  deliveryOrder,
  draftToFormData,
  interpretDelivery,
  nextAttemptDelayMs,
  unsentDrafts,
  type DraftImageField,
  type OfflineDraft,
} from "@/lib/offline/draft";
import {
  deleteDraft,
  listDrafts,
  mintClientId,
  putDraft,
} from "@/lib/client/outbox-db";

/**
 * The outbox: captures saved to the phone, and the loop that ships them.
 *
 * Mounted once in the locale layout so drafts keep draining wherever the
 * agent is in the app — walking to the next booth with the catalog open is
 * exactly when the signal comes back. The rules (retry, ordering, statuses)
 * live in src/lib/offline/draft.ts; storage in src/lib/client/outbox-db.ts;
 * this component is just the wiring between them, the network and the UI.
 */

export type OutboxState = {
  /** Captures on the phone that the server has not confirmed. */
  pending: number;
  /** Of those, captures the server refused — a human has to look. */
  blocked: number;
  /** A delivery pass is running right now. */
  syncing: boolean;
  /** The server said 401: everything is queued behind a sign-in. */
  needsSignIn: boolean;
  /** The last word on reachability: an OS offline event, or a failed probe. */
  offline: boolean;
};

type OutboxApi = OutboxState & {
  /** Stores a capture durably and starts trying to deliver it. */
  enqueue: (
    kind: "product" | "contact",
    formData: FormData,
    files: { file: File; field: DraftImageField }[],
  ) => Promise<void>;
  /** Asks for a delivery pass now (e.g. right after saving). */
  kick: () => void;
};

const OutboxContext = createContext<OutboxApi | null>(null);

export function useOutbox(): OutboxApi | null {
  return useContext(OutboxContext);
}

/**
 * Whether the server is actually reachable, decided by asking it.
 *
 * `navigator.onLine` reports the network interface, not the path to the NAS:
 * market wi-fi with no upstream, or wi-fi without the Tailscale tunnel, both
 * count as "online" there. A HEAD with a short fuse answers the real question
 * and bounds how long a save can sit undecided at the booth.
 */
export async function probeServer(timeoutMs = 3000): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;

  // A save must feel finished the moment the button is hit. The first save in
  // a dead hall pays the timeout once; the answer is remembered briefly so
  // the next capture goes straight to the phone with no wait at all.
  const now = Date.now();
  if (lastProbe && now - lastProbe.at < PROBE_MEMORY_MS && !lastProbe.ok) {
    return false;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("/api/drafts", {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const ok = res.ok || res.status === 204;
    lastProbe = { at: Date.now(), ok };
    return ok;
  } catch {
    lastProbe = { at: Date.now(), ok: false };
    return false;
  }
}

/** How long a "server unreachable" answer is trusted before asking again. */
const PROBE_MEMORY_MS = 8_000;
let lastProbe: { at: number; ok: boolean } | null = null;

/** The browser says the network changed: forget what the last probe learned. */
export function forgetProbeMemory() {
  lastProbe = null;
}

/** How often to look for deliverable drafts even with no event to go on. */
const IDLE_SWEEP_MS = 30_000;

export function OutboxProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OutboxState>({
    pending: 0,
    blocked: 0,
    syncing: false,
    needsSignIn: false,
    offline: false,
  });

  // One delivery pass at a time; a second request marks the pass dirty so it
  // runs again as soon as the current one finishes.
  const draining = useRef(false);
  const dirty = useRef(false);

  const refreshCounts = useCallback(async () => {
    try {
      const drafts = await listDrafts();
      const open = unsentDrafts(drafts);
      setState((prev) => ({
        ...prev,
        pending: open.length,
        blocked: open.filter((d) => d.status === "blocked").length,
      }));
    } catch {
      // IndexedDB unavailable (private mode): nothing to count.
    }
  }, []);

  const drain = useCallback(async () => {
    if (draining.current) {
      dirty.current = true;
      return;
    }
    draining.current = true;
    setState((prev) => ({ ...prev, syncing: true }));

    try {
      do {
        dirty.current = false;

        let drafts: OfflineDraft[];
        try {
          drafts = deliveryOrder(await listDrafts());
        } catch {
          break;
        }
        if (drafts.length === 0) break;

        // The probe's answer doubles as the app-wide connectivity signal.
        const reachable = await probeServer();
        setState((prev) => (prev.offline === !reachable ? prev : { ...prev, offline: !reachable }));
        if (!reachable) break;

        for (const draft of drafts) {
          // Pace retries: a draft that just failed waits its turn instead of
          // being hammered at every pass.
          const wait = nextAttemptDelayMs(draft.attempts);
          if (wait > 0 && draft.attempts > 0) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 5000)));
          }

          // A 2xx only counts once the body proves it came from our endpoint
          // — venue wi-fi loves answering 200 with a captive-portal page, and
          // deleting a capture on the strength of that would lose it for good.
          let verdict: ReturnType<typeof interpretDelivery>;
          try {
            const res = await fetch("/api/drafts", {
              method: "POST",
              body: draftToFormData(draft),
            });
            verdict = interpretDelivery(res.status, await res.json().catch(() => null));
          } catch {
            verdict = { status: null };
          }
          const status = verdict.status;

          const after = applyAttempt(draft, status, verdict);
          setState((prev) => ({
            ...prev,
            needsSignIn: status === 401 || status === 403,
            offline: status === null,
          }));

          if (after.status === "sent") {
            // The server holds it; only now does the phone let go.
            await deleteDraft(draft.clientId).catch(() => {});
          } else {
            await putDraft(after).catch(() => {});
            if (status === null) {
              // The link is gone again — stop the pass instead of walking the
              // rest of the queue into the same dead socket.
              break;
            }
          }
        }

        await refreshCounts();
      } while (dirty.current);
    } finally {
      draining.current = false;
      setState((prev) => ({ ...prev, syncing: false }));
    }
  }, [refreshCounts]);

  const kick = useCallback(() => {
    void drain();
  }, [drain]);

  const enqueue = useCallback(
    async (
      kind: "product" | "contact",
      formData: FormData,
      files: { file: File; field: DraftImageField }[],
    ) => {
      // Bytes, not File objects: structured-clone Blobs have burned Safari
      // users before, and these must survive days. See offline/draft.ts.
      const images = await Promise.all(
        files.map(async ({ file, field }) => ({
          field,
          name: file.name,
          type: file.type,
          bytes: await file.arrayBuffer(),
        })),
      );

      const draft: OfflineDraft = {
        kind,
        clientId: mintClientId(),
        capturedAt: new Date().toISOString(),
        fields: collectDraftFields(formData),
        images,
        status: "pending",
        attempts: 0,
      };

      // If this throws, the caller must NOT pretend the save happened — the
      // capture form keeps everything on screen and says so.
      await putDraft(draft);
      await refreshCounts();
      void drain();
    },
    [drain, refreshCounts],
  );

  // Deliveries start themselves: on mount (yesterday's leftovers), when the
  // browser announces the network is back, when the app returns to the
  // foreground (walking out of the hall), and on a slow idle sweep for the
  // cases none of those events cover.
  useEffect(() => {
    // Deferred a tick: the first pass reads IndexedDB and then sets counts,
    // and the linter rightly objects to state writes launched straight from
    // an effect body.
    const kickoff = setTimeout(() => {
      void refreshCounts();
      void drain();
    }, 0);

    const onOnline = () => {
      forgetProbeMemory();
      setState((prev) => ({ ...prev, offline: false }));
      void drain();
    };
    const onOffline = () => {
      setState((prev) => ({ ...prev, offline: true }));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void drain();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const sweep = setInterval(() => void drain(), IDLE_SWEEP_MS);
    return () => {
      clearTimeout(kickoff);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(sweep);
    };
  }, [drain, refreshCounts]);

  return (
    <OutboxContext.Provider value={{ ...state, enqueue, kick }}>
      {children}
    </OutboxContext.Provider>
  );
}
