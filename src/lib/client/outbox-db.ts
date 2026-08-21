import type { OfflineDraft } from "@/lib/offline/draft";

/**
 * The phone-side store for captures that have not reached the NAS yet.
 *
 * IndexedDB and not localStorage because a capture is mostly photos —
 * localStorage is strings with a ~5MB ceiling, IndexedDB holds binary data by
 * the hundreds of megabytes. And IndexedDB rather than anything fancier
 * because it is the one durable store that works on an insecure origin: this
 * app is reached over plain HTTP on the LAN and over Tailscale, which rules
 * out service workers, Cache API and StorageManager.persist() until the day
 * the deployment grows a real certificate.
 *
 * Everything stored is plain structured-clone data (strings, numbers,
 * ArrayBuffers) — deliberately no Blob or File objects, which Safari has
 * historically mangled across sessions. See src/lib/offline/draft.ts.
 *
 * Every function opens lazily and rejects rather than throws, so callers deal
 * with one failure shape. Private browsing on some phones gives IndexedDB a
 * quota of zero: the capture form treats a failed write as "do not let the
 * user walk away", not as something to log quietly.
 */

const DB_NAME = "mbarete-outbox";
const DB_VERSION = 1;
const STORE = "drafts";

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexeddb-unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "clientId" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A version change from another tab (a future migration) closes this
      // handle so the other tab can proceed; the next call reopens.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      opening = null;
      reject(request.error ?? new Error("indexeddb-open-failed"));
    };
    request.onblocked = () => {
      // Another tab holds an old version open; surfaced as a failure rather
      // than waiting forever with the user watching a dead save button.
      opening = null;
      reject(new Error("indexeddb-blocked"));
    };
  });
  return opening;
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb-request-failed"));
  });
}

/** Resolves when the transaction has actually hit disk, not merely queued. */
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb-tx-failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb-tx-aborted"));
  });
}

/**
 * Writes a draft and resolves only once the transaction has committed. The
 * capture form must not tell the agent "saved, go ahead" before that.
 */
export async function putDraft(draft: OfflineDraft): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(draft);
  await transactionDone(tx);
}

export async function getDraft(clientId: string): Promise<OfflineDraft | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return requestDone(tx.objectStore(STORE).get(clientId) as IDBRequest<OfflineDraft | undefined>);
}

export async function listDrafts(): Promise<OfflineDraft[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return requestDone(tx.objectStore(STORE).getAll() as IDBRequest<OfflineDraft[]>);
}

/** Only ever called after the server has confirmed it holds the capture. */
export async function deleteDraft(clientId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(clientId);
  await transactionDone(tx);
}

/**
 * A capture id, minted on the phone.
 *
 * Not crypto.randomUUID(): that function only exists in secure contexts, and
 * this app runs on plain HTTP. getRandomValues is available everywhere, and
 * 16 random bytes is the same entropy a UUID carries.
 */
export function mintClientId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `cap-${hex}`;
}
