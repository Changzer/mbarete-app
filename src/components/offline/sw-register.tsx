"use client";

import { useEffect } from "react";

/**
 * Registers the service worker — where one is allowed to exist.
 *
 * Browsers only run service workers on secure origins. On the default
 * deployment (plain HTTP over LAN/Tailscale) this renders the app exactly as
 * before; behind HTTPS it quietly turns on full-page offline reloads for
 * pages already visited. `updateViaCache: "none"` makes the browser refetch
 * sw.js itself on each check, so a shipped fix is never pinned by its own
 * old cache headers.
 */
export function SwRegister() {
  useEffect(() => {
    if (!window.isSecureContext) return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .catch(() => {
        // A blocked or failed registration changes nothing: the app works
        // without a worker, it just cannot survive offline reloads.
      });
    // Ask the browser not to evict this origin's storage (the capture outbox)
    // under pressure. A request, not a guarantee — browsers grant it on their
    // own heuristics and never prompt — so nothing depends on the answer.
    navigator.storage?.persist?.().catch(() => {});
  }, []);
  return null;
}
