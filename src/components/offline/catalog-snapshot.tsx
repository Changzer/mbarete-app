"use client";

import { useEffect } from "react";
import { saveCatalogSnapshot, type CachedProduct } from "@/lib/client/catalog-cache";

/**
 * Renders nothing; every load of the full catalog page quietly refreshes the
 * phone's offline copy with the rows it just displayed.
 *
 * Only the unfiltered catalog writes (`complete`): a filtered view saving
 * itself would shrink the offline copy to whatever the last filter matched.
 */
export function CatalogSnapshot({
  products,
  complete,
}: {
  products: CachedProduct[];
  complete: boolean;
}) {
  useEffect(() => {
    if (!complete) return;
    const timer = setTimeout(() => {
      saveCatalogSnapshot(products).catch(() => {
        // No IndexedDB (private mode): the live page still works; only the
        // offline copy is unavailable, and the sheet says so when opened.
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [products, complete]);

  return null;
}
