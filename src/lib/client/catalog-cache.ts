/**
 * A read-only copy of the catalog, kept on the phone.
 *
 * At a booth the question is usually "do we already buy this, and at what
 * price?" — worth answering even when the server is unreachable. Every full
 * catalog load leaves its product list here; the offline catalog sheet reads
 * it back. One record, wholesale: the catalog is a few hundred rows of text,
 * and replacing it beats reconciling it.
 *
 * Photos are deliberately not stored. They would multiply the footprint a
 * hundredfold, and the text — name, SKU, price, MOQ, booth — is what settles
 * the question on the spot.
 */

const DB_NAME = "mbarete-catalog";
const DB_VERSION = 1;
const STORE = "snapshot";
function keyFor(scope: string) {
  return `catalog:${scope}`;
}

/** One catalog row, as the offline sheet shows it. */
export type CachedProduct = {
  id: number;
  sku: string;
  name: string;
  categoryName: string;
  price: number;
  sellPrice: number;
  currency: string;
  moq: number;
  qtyPerBox: number;
  supplierName: string | null;
  supplierBooth: string | null;
};

export type CatalogSnapshot = {
  savedAt: string;
  products: CachedProduct[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb-unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb-open-failed"));
  });
}

export async function saveCatalogSnapshot(scope: string, products: CachedProduct[]): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(
      { savedAt: new Date().toISOString(), products } satisfies CatalogSnapshot,
      keyFor(scope),
    );
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexeddb-tx-failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexeddb-tx-aborted"));
    });
  } finally {
    db.close();
  }
}

export async function loadCatalogSnapshot(scope: string): Promise<CatalogSnapshot | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(keyFor(scope)) as IDBRequest<
      CatalogSnapshot | undefined
    >;
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexeddb-request-failed"));
    });
  } finally {
    db.close();
  }
}
