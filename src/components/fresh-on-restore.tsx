"use client";

import { useEffect } from "react";

/**
 * Re-fetches the page when the browser restores it from the back/forward
 * cache instead of the network.
 *
 * iOS Safari in particular restores a full snapshot on the back/forward
 * gesture, showing the page exactly as it was — Next.js does not refresh
 * these restores. On a document like the proforma invoice that snapshot can
 * be stale (the bank account was just switched on the order page), so a
 * restored copy is swapped for a fresh render.
 */
export function FreshOnRestore() {
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  return null;
}
