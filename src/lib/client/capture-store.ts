import {
  currentVisit,
  resumableCapture,
  sealCapture,
  type LocalAddendum,
  type LocalCapture,
  type LocalPhoto,
  type LocalVisit,
} from "@/lib/offline/capture";
import {
  deleteCaptureEntirely,
  deletePhoto,
  getCapture,
  listAddenda,
  listCaptures,
  listPhotos,
  listVisits,
  mintClientId,
  mintId,
  putAddendumWithPhoto,
  putCapture,
  putPhoto,
  putVisit,
  pruneSentCaptures,
} from "@/lib/client/outbox-db";
import { compressImage } from "@/lib/client/compress-image";

/**
 * What the capture screen does to the phone's store, in the order that
 * keeps evidence safe.
 *
 * A photo is written the moment it comes back from the camera — the
 * ORIGINAL bytes, before any compression, because re-encoding a 12-megapixel
 * frame takes the better part of a second on a phone and that second is a
 * loss window. Once the original has committed the screen says "Saved";
 * compression then runs and replaces the stored bytes in a second commit.
 * If compression never happens (the tab dies first), the original is what
 * ships — bigger, but there.
 *
 * Every function here resolves only after its IndexedDB transaction has
 * committed. Nothing is reported saved on the strength of a queued write.
 */

export type PhotoTimings = {
  /** Milliseconds from the file being handed over to the original committing. */
  persistMs: number;
  /** Milliseconds compression took, or null when it was skipped or failed. */
  compressMs: number | null;
  originalBytes: number;
  storedBytes: number;
};

export type StoreSnapshot = {
  captures: LocalCapture[];
  visits: LocalVisit[];
  addenda: LocalAddendum[];
};

export async function snapshot(scope: string): Promise<StoreSnapshot> {
  const [captures, visits, addenda] = await Promise.all([
    listCaptures(scope),
    listVisits(scope),
    listAddenda(scope),
  ]);
  return { captures, visits, addenda };
}

/** The visit to keep working under: the last one used, or a fresh one. */
export async function ensureVisit(scope: string, now: string): Promise<LocalVisit> {
  const existing = currentVisit(await listVisits(scope));
  if (existing) return existing;
  return startVisit(scope, now);
}

/** "Change supplier": a new booth context for everything from here on. */
export async function startVisit(scope: string, now: string): Promise<LocalVisit> {
  const visit: LocalVisit = { visitId: mintId("vis"), startedAt: now, lastUsedAt: now };
  await putVisit(scope, visit);
  return visit;
}

export async function touchVisit(scope: string, visit: LocalVisit, now: string): Promise<LocalVisit> {
  const next = { ...visit, lastUsedAt: now };
  await putVisit(scope, next);
  return next;
}

/** A supplier chosen on the phone for this visit; null clears it. */
export async function setLocalVisitSupplier(
  scope: string,
  visit: LocalVisit,
  supplier: { id: number; name: string } | null,
): Promise<LocalVisit> {
  const next: LocalVisit = {
    ...visit,
    supplierId: supplier?.id,
    supplierName: supplier?.name,
    lastUsedAt: new Date().toISOString(),
  };
  await putVisit(scope, next);
  return next;
}

/** The open capture to resume, if the screen was left mid-booth. */
export async function resumeCapture(scope: string): Promise<LocalCapture | undefined> {
  return resumableCapture(await listCaptures(scope));
}

/**
 * A capture object for the screen to photograph into. Not written until the
 * first photo lands — an abandoned empty capture must not litter the store
 * or show up as "unfinished work" later.
 */
export function newCapture(visitId: string, kind: LocalCapture["kind"], now: string): LocalCapture {
  return {
    captureId: mintClientId(),
    visitId,
    kind,
    status: "open",
    startedAt: now,
    note: "",
    photoCount: 0,
    attempts: 0,
  };
}

async function nextSeq(scope: string, captureId: string): Promise<number> {
  const photos = await listPhotos(scope, captureId);
  return photos.length ? Math.max(...photos.map((p) => p.seq)) + 1 : 0;
}

/**
 * Persists a photo: original first (fast), then the compressed replacement.
 * `onSaved` fires after the first commit — that is the moment the tile may
 * say "Saved" — and the promise resolves after compression settles.
 */
export async function addPhoto(
  scope: string,
  capture: LocalCapture,
  file: File,
  now: string,
  onSaved?: (capture: LocalCapture, photo: LocalPhoto) => void,
): Promise<{ capture: LocalCapture; photo: LocalPhoto; timings: PhotoTimings }> {
  const t0 = performance.now();
  const seq = await nextSeq(scope, capture.captureId);
  const originalBytes = await file.arrayBuffer();
  const photo: LocalPhoto = {
    captureId: capture.captureId,
    seq,
    name: file.name || `photo-${seq}.jpg`,
    type: file.type || "image/jpeg",
    bytes: originalBytes,
    addedAt: now,
  };
  const next: LocalCapture = { ...capture, photoCount: capture.photoCount + 1 };
  await putPhoto(scope, photo, next);
  const persistMs = performance.now() - t0;
  onSaved?.(next, photo);

  // Compression after the fact: a second commit swaps the bytes under the
  // same key. The capture row is rewritten unchanged (same count).
  let compressMs: number | null = null;
  let stored = photo;
  try {
    const t1 = performance.now();
    const compressed = await compressImage(file);
    compressMs = performance.now() - t1;
    if (compressed !== file) {
      stored = {
        ...photo,
        name: compressed.name,
        type: compressed.type,
        bytes: await compressed.arrayBuffer(),
      };
      // Only if the capture is still open: a sealed capture's payload is
      // frozen, and a delivery may already be reading the original.
      const current = await getCapture(scope, capture.captureId);
      if (current && current.status === "open") await putPhoto(scope, stored, current);
      else stored = photo;
    }
  } catch {
    compressMs = null;
  }

  return {
    capture: next,
    photo: stored,
    timings: {
      persistMs,
      compressMs,
      originalBytes: originalBytes.byteLength,
      storedBytes: stored.bytes.byteLength,
    },
  };
}

export async function removePhoto(scope: string, capture: LocalCapture, seq: number): Promise<LocalCapture> {
  if (capture.status !== "open") return capture;
  const next = { ...capture, photoCount: Math.max(0, capture.photoCount - 1) };
  if (next.photoCount === 0) {
    await deleteCaptureEntirely(scope, capture.captureId);
    return next;
  }
  await deletePhoto(scope, capture.captureId, seq, next);
  return next;
}

export async function setNote(scope: string, capture: LocalCapture, note: string): Promise<LocalCapture> {
  if (capture.status !== "open") return capture;
  const next = { ...capture, note };
  if (capture.photoCount > 0) await putCapture(scope, next);
  return next;
}

/** "Next product": the capture joins the queue. Returns it unchanged if empty. */
export async function seal(scope: string, capture: LocalCapture, now: string): Promise<LocalCapture> {
  const sealed = sealCapture(capture, now);
  if (sealed === capture) return capture;
  await putCapture(scope, sealed);
  return sealed;
}

/**
 * "Add photo to previous product": the photo is stored under the capture
 * with its own addendum id and delivered separately. Nothing about the
 * capture's own delivery changes.
 */
export async function addAddendum(
  scope: string,
  captureId: string,
  file: File,
  now: string,
): Promise<{ addendum: LocalAddendum; photo: LocalPhoto; timings: PhotoTimings }> {
  const t0 = performance.now();
  const seq = await nextSeq(scope, captureId);
  const addendum: LocalAddendum = {
    addendumId: mintId("add"),
    captureId,
    status: "pending",
    attempts: 0,
    createdAt: now,
  };
  const originalBytes = await file.arrayBuffer();
  const photo: LocalPhoto = {
    captureId,
    seq,
    name: file.name || `photo-${seq}.jpg`,
    type: file.type || "image/jpeg",
    bytes: originalBytes,
    addedAt: now,
    addendumId: addendum.addendumId,
  };
  await putAddendumWithPhoto(scope, addendum, photo);
  const persistMs = performance.now() - t0;

  // Compressing an addendum's photo replaces it in place, which is safe
  // ONLY before its delivery begins; a delivery in flight reads the bytes
  // it was handed. The addendum is pending until the drain picks it up, so
  // the swap is racy by nature — it is skipped when the row already moved.
  let compressMs: number | null = null;
  let stored = photo;
  try {
    const t1 = performance.now();
    const compressed = await compressImage(file);
    compressMs = performance.now() - t1;
    if (compressed !== file) {
      const rows = await listAddenda(scope);
      const row = rows.find((a) => a.addendumId === addendum.addendumId);
      if (row && row.status === "pending" && row.attempts === 0) {
        stored = { ...photo, name: compressed.name, type: compressed.type, bytes: await compressed.arrayBuffer() };
        await putAddendumWithPhoto(scope, row, stored);
      }
    }
  } catch {
    compressMs = null;
  }

  return {
    addendum,
    photo: stored,
    timings: {
      persistMs,
      compressMs,
      originalBytes: originalBytes.byteLength,
      storedBytes: stored.bytes.byteLength,
    },
  };
}

/** Photos of one capture, for thumbnails. */
export async function photosOf(scope: string, captureId: string): Promise<LocalPhoto[]> {
  return listPhotos(scope, captureId);
}

/** An object URL for a stored photo; the caller revokes it. */
export function photoUrl(photo: LocalPhoto): string {
  return URL.createObjectURL(new Blob([photo.bytes], { type: photo.type }));
}

/** Remembers which capture holds this visit's card, for the supplier bar. */
export async function markVisitCard(scope: string, visit: LocalVisit, captureId: string): Promise<LocalVisit> {
  const next: LocalVisit = { ...visit, cardCaptureId: captureId, lastUsedAt: new Date().toISOString() };
  await putVisit(scope, next);
  return next;
}

/** Housekeeping on open: sent captures older than a week are forgotten. */
export async function pruneOld(scope: string, now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return pruneSentCaptures(scope, before);
}
