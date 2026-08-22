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
  storageScope,
}: {
  products: CachedProduct[];
  complete: boolean;
  storageScope: string;
}) {
  useEffect(() => {
    if (!complete) return;
    const timer = setTimeout(() => {
      saveCatalogSnapshot(storageScope, products).catch(() => {
        // No IndexedDB (private mode): the live page still works; only the
        // offline copy is unavailable, and the sheet says so when opened.
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [products, complete, storageScope]);

  return null;
}
