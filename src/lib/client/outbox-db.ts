import type { OfflineDraft } from "@/lib/offline/draft";
import type { LocalAddendum, LocalCapture, LocalPhoto, LocalVisit } from "@/lib/offline/capture";

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
const DB_VERSION = 3;
// Keep the v1 store untouched. Its rows predate tenant scoping, so there is no
// safe way to decide which account owns them. Replaying one after a different
// company signs in would be worse than leaving it quarantined on the device.
const STORE = "scoped-drafts";
// v3 adds the field-capture stores beside the v2 queue, which keeps working
// unchanged: a phone upgrading with captures still queued delivers them from
// the old store, and nothing is converted or re-keyed under its feet.
const CAPTURES = "captures";
const PHOTOS = "photos";
const ADDENDA = "addenda";
const VISITS = "visits";

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
        const store = db.createObjectStore(STORE, { keyPath: ["scope", "clientId"] });
        store.createIndex("by-scope", "scope");
      }
      if (!db.objectStoreNames.contains(CAPTURES)) {
        const store = db.createObjectStore(CAPTURES, { keyPath: ["scope", "captureId"] });
        store.createIndex("by-scope", "scope");
      }
      if (!db.objectStoreNames.contains(PHOTOS)) {
        const store = db.createObjectStore(PHOTOS, { keyPath: ["scope", "captureId", "seq"] });
        store.createIndex("by-capture", ["scope", "captureId"]);
      }
      if (!db.objectStoreNames.contains(ADDENDA)) {
        const store = db.createObjectStore(ADDENDA, { keyPath: ["scope", "addendumId"] });
        store.createIndex("by-scope", "scope");
      }
      if (!db.objectStoreNames.contains(VISITS)) {
        const store = db.createObjectStore(VISITS, { keyPath: ["scope", "visitId"] });
        store.createIndex("by-scope", "scope");
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
      // The browser can also kill the connection on its own — iOS Safari does
      // under memory pressure. Without this, the dead handle stays cached and
      // every save fails until a full reload; with it, the next call reopens.
      db.onclose = () => {
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
type StoredDraft = OfflineDraft & { scope: string };

export async function putDraft(scope: string, draft: OfflineDraft): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({ ...draft, scope } satisfies StoredDraft);
  await transactionDone(tx);
}

export async function getDraft(scope: string, clientId: string): Promise<OfflineDraft | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return requestDone(
    tx.objectStore(STORE).get([scope, clientId]) as IDBRequest<StoredDraft | undefined>,
  );
}

export async function listDrafts(scope: string): Promise<OfflineDraft[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return requestDone(
    tx.objectStore(STORE).index("by-scope").getAll(scope) as IDBRequest<StoredDraft[]>,
  );
}

/** Only ever called after the server has confirmed it holds the capture. */
export async function deleteDraft(scope: string, clientId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete([scope, clientId]);
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

// ---------------------------------------------------------------- captures

/**
 * Field captures: photos written one at a time, the capture row alongside.
 * Every write resolves only once its transaction committed, so the screen
 * can say "Saved on this device" and mean it. Everything is scoped to the
 * signed-in company and user like the queue above: another account on the
 * same phone neither sees nor delivers these.
 */
type Scoped<T> = T & { scope: string };

export async function putCapture(scope: string, capture: LocalCapture): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(CAPTURES, "readwrite");
  tx.objectStore(CAPTURES).put({ ...capture, scope } satisfies Scoped<LocalCapture>);
  await transactionDone(tx);
}

export async function getCapture(scope: string, captureId: string): Promise<LocalCapture | undefined> {
  const db = await openDb();
  const tx = db.transaction(CAPTURES, "readonly");
  return requestDone(
    tx.objectStore(CAPTURES).get([scope, captureId]) as IDBRequest<Scoped<LocalCapture> | undefined>,
  );
}

export async function listCaptures(scope: string): Promise<LocalCapture[]> {
  const db = await openDb();
  const tx = db.transaction(CAPTURES, "readonly");
  return requestDone(
    tx.objectStore(CAPTURES).index("by-scope").getAll(scope) as IDBRequest<Scoped<LocalCapture>[]>,
  );
}

/**
 * Writes a photo and bumps its capture's count in ONE transaction: a count
 * that says three while two photos are on disk would make a sealed capture
 * deliver short and the phone believe it complete.
 */
export async function putPhoto(scope: string, photo: LocalPhoto, capture: LocalCapture): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([PHOTOS, CAPTURES], "readwrite");
  tx.objectStore(PHOTOS).put({ ...photo, scope } satisfies Scoped<LocalPhoto>);
  tx.objectStore(CAPTURES).put({ ...capture, scope } satisfies Scoped<LocalCapture>);
  await transactionDone(tx);
}

export async function listPhotos(scope: string, captureId: string): Promise<LocalPhoto[]> {
  const db = await openDb();
  const tx = db.transaction(PHOTOS, "readonly");
  const rows = await requestDone(
    tx.objectStore(PHOTOS).index("by-capture").getAll([scope, captureId]) as IDBRequest<
      Scoped<LocalPhoto>[]
    >,
  );
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function deletePhoto(scope: string, captureId: string, seq: number, capture: LocalCapture): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([PHOTOS, CAPTURES], "readwrite");
  tx.objectStore(PHOTOS).delete([scope, captureId, seq]);
  tx.objectStore(CAPTURES).put({ ...capture, scope } satisfies Scoped<LocalCapture>);
  await transactionDone(tx);
}

/**
 * Releases a delivered capture's ORIGINAL photos — the bytes the server now
 * holds. The capture row itself stays, marked sent: it is what "Add photo
 * to previous product" attaches to after delivery, and what the booth's
 * product count is drawn from. Addendum photos stay until their own
 * delivery is confirmed. Sent rows are pruned by age (pruneSentCaptures).
 */
export async function deleteCaptureOriginals(scope: string, captureId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(PHOTOS, "readwrite");
  const photos = tx.objectStore(PHOTOS);
  const rows = await requestDone(
    photos.index("by-capture").getAll([scope, captureId]) as IDBRequest<Scoped<LocalPhoto>[]>,
  );
  for (const row of rows) {
    if (!row.addendumId) photos.delete([scope, captureId, row.seq]);
  }
  await transactionDone(tx);
}

/**
 * Forgets sent captures started before `before` (ISO), once nothing under
 * them is still owed. A week of them is plenty for "add photo to previous";
 * older ones would only be reachable from review anyway.
 */
export async function pruneSentCaptures(scope: string, before: string): Promise<number> {
  const db = await openDb();
  const tx = db.transaction([CAPTURES, PHOTOS, ADDENDA], "readwrite");
  const captures = tx.objectStore(CAPTURES);
  const rows = await requestDone(captures.index("by-scope").getAll(scope) as IDBRequest<Scoped<LocalCapture>[]>);
  const owed = new Set(
    (await requestDone(tx.objectStore(ADDENDA).index("by-scope").getAll(scope) as IDBRequest<Scoped<LocalAddendum>[]>))
      .filter((a) => a.status !== "sent")
      .map((a) => a.captureId),
  );
  let pruned = 0;
  for (const row of rows) {
    if (row.status !== "sent" || row.startedAt >= before || owed.has(row.captureId)) continue;
    const photos = await requestDone(
      tx.objectStore(PHOTOS).index("by-capture").getAll([scope, row.captureId]) as IDBRequest<Scoped<LocalPhoto>[]>,
    );
    if (photos.length > 0) continue;
    captures.delete([scope, row.captureId]);
    pruned++;
  }
  await transactionDone(tx);
  return pruned;
}

/** Discards an open or blocked capture with everything under it. */
export async function deleteCaptureEntirely(scope: string, captureId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([PHOTOS, CAPTURES, ADDENDA], "readwrite");
  const photos = tx.objectStore(PHOTOS);
  const rows = await requestDone(
    photos.index("by-capture").getAll([scope, captureId]) as IDBRequest<Scoped<LocalPhoto>[]>,
  );
  for (const row of rows) photos.delete([scope, captureId, row.seq]);
  const addenda = tx.objectStore(ADDENDA);
  const adds = await requestDone(
    addenda.index("by-scope").getAll(scope) as IDBRequest<Scoped<LocalAddendum>[]>,
  );
  for (const a of adds) if (a.captureId === captureId) addenda.delete([scope, a.addendumId]);
  tx.objectStore(CAPTURES).delete([scope, captureId]);
  await transactionDone(tx);
}

// ----------------------------------------------------------------- addenda

export async function putAddendum(scope: string, addendum: LocalAddendum): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(ADDENDA, "readwrite");
  tx.objectStore(ADDENDA).put({ ...addendum, scope } satisfies Scoped<LocalAddendum>);
  await transactionDone(tx);
}

/** An addendum and its photo land together, or not at all. */
export async function putAddendumWithPhoto(
  scope: string,
  addendum: LocalAddendum,
  photo: LocalPhoto,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([ADDENDA, PHOTOS], "readwrite");
  tx.objectStore(ADDENDA).put({ ...addendum, scope } satisfies Scoped<LocalAddendum>);
  tx.objectStore(PHOTOS).put({ ...photo, scope } satisfies Scoped<LocalPhoto>);
  await transactionDone(tx);
}

export async function listAddenda(scope: string): Promise<LocalAddendum[]> {
  const db = await openDb();
  const tx = db.transaction(ADDENDA, "readonly");
  return requestDone(
    tx.objectStore(ADDENDA).index("by-scope").getAll(scope) as IDBRequest<Scoped<LocalAddendum>[]>,
  );
}

/** After the server confirmed the addendum: its photo goes, then its row. */
export async function deleteAddendum(scope: string, addendum: LocalAddendum): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([ADDENDA, PHOTOS], "readwrite");
  const photos = tx.objectStore(PHOTOS);
  const rows = await requestDone(
    photos.index("by-capture").getAll([scope, addendum.captureId]) as IDBRequest<Scoped<LocalPhoto>[]>,
  );
  for (const row of rows) {
    if (row.addendumId === addendum.addendumId) photos.delete([scope, row.captureId, row.seq]);
  }
  tx.objectStore(ADDENDA).delete([scope, addendum.addendumId]);
  await transactionDone(tx);
}

// ------------------------------------------------------------------ visits

export async function putVisit(scope: string, visit: LocalVisit): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(VISITS, "readwrite");
  tx.objectStore(VISITS).put({ ...visit, scope } satisfies Scoped<LocalVisit>);
  await transactionDone(tx);
}

export async function getVisit(scope: string, visitId: string): Promise<LocalVisit | undefined> {
  const db = await openDb();
  const tx = db.transaction(VISITS, "readonly");
  return requestDone(
    tx.objectStore(VISITS).get([scope, visitId]) as IDBRequest<Scoped<LocalVisit> | undefined>,
  );
}

export async function listVisits(scope: string): Promise<LocalVisit[]> {
  const db = await openDb();
  const tx = db.transaction(VISITS, "readonly");
  return requestDone(
    tx.objectStore(VISITS).index("by-scope").getAll(scope) as IDBRequest<Scoped<LocalVisit>[]>,
  );
}

/** Visits nothing refers to any more can be forgotten; keeps the store small. */
export async function pruneVisits(scope: string, keep: Set<string>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(VISITS, "readwrite");
  const store = tx.objectStore(VISITS);
  const rows = await requestDone(store.index("by-scope").getAll(scope) as IDBRequest<Scoped<LocalVisit>[]>);
  for (const row of rows) if (!keep.has(row.visitId)) store.delete([scope, row.visitId]);
  await transactionDone(tx);
}

/** Ids for visits and addenda, same entropy and reasoning as mintClientId. */
export function mintId(prefix: "vis" | "add"): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${hex}`;
}

/**
 * Asks the browser to protect this origin's storage from eviction. Only
 * secure contexts have the API, and a denial is nothing to act on — capture
 * keeps working either way; the answer is shown, never enforced.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}
