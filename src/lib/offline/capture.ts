/**
 * The field-capture model: what a booth capture is on the phone, and the
 * pure rules for moving one through the outbox.
 *
 * A capture is a product (or a card) photographed at a booth, under a
 * VISIT — the run of products taken at one supplier. Photos are the unit of
 * durability: each one is written to IndexedDB the moment it comes back from
 * the camera, so "Next product" is never the first time evidence is safe.
 * The capture is the unit of delivery: sealing it puts it in the queue,
 * and it travels byte-identically however many retries it takes.
 *
 * Once a capture may have been sent, its payload is never rewritten under
 * the same identity — a lost acknowledgement means the server may already
 * hold the original. Evidence added afterwards is an ADDENDUM: its own id,
 * its own delivery, a reference to the capture it belongs to.
 *
 * Deliberately free of IndexedDB and the DOM, like offline/draft.ts, so the
 * rules can be tested under `node --test`. The storage binding is in
 * src/lib/client/outbox-db.ts; the delivery loop is in the outbox provider.
 */

export type CaptureKind = "product" | "contact";

export type CaptureStatus =
  /** Being photographed right now; not in the queue. Survives reloads. */
  | "open"
  /** Sealed; waiting to be delivered. */
  | "pending"
  /** The server holds it. */
  | "sent"
  /** Refused for a reason retrying cannot fix; a person decides. */
  | "blocked";

export type LocalCapture = {
  /** Minted when the capture begins; the server's clientId. Never reused. */
  captureId: string;
  /** The booth context this capture was taken under. */
  visitId: string;
  kind: CaptureKind;
  status: CaptureStatus;
  /** When the first photo was taken — the server's capturedAt. */
  startedAt: string;
  sealedAt?: string;
  /** A line the buyer typed: something said, not photographed. Optional. */
  note: string;
  photoCount: number;
  attempts: number;
  lastError?: string;
  /** Server draft id once accepted. */
  draftId?: number;
};

export type LocalPhoto = {
  captureId: string;
  /** Order within the capture; addenda continue the sequence. */
  seq: number;
  name: string;
  type: string;
  bytes: ArrayBuffer;
  addedAt: string;
  /** Set when this photo arrived after the capture was sealed. */
  addendumId?: string;
};

export type AddendumStatus = "pending" | "sent" | "blocked";

export type LocalAddendum = {
  addendumId: string;
  captureId: string;
  status: AddendumStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
};

export type LocalVisit = {
  visitId: string;
  startedAt: string;
  lastUsedAt: string;
  /** A supplier chosen on the phone, when known. Travels with each capture. */
  supplierId?: number;
  supplierName?: string;
  /** The card capture taken during this visit, if any. */
  cardCaptureId?: string;
};

/** A capture that has photos can be sealed; an empty one has nothing to send. */
export function sealCapture(capture: LocalCapture, now: string): LocalCapture {
  if (capture.status !== "open") return capture;
  if (capture.photoCount <= 0) return capture;
  return { ...capture, status: "pending", sealedAt: now, attempts: 0, lastError: undefined };
}

/**
 * Whether the capture's payload may already be known to the server. Once
 * true, nothing about the capture may change — new evidence goes through an
 * addendum. "pending" counts: the first attempt may have reached the server
 * and lost its answer.
 */
export function mayHaveBeenSent(capture: LocalCapture): boolean {
  return capture.status !== "open";
}

/** The photos that belong to the capture's own delivery — not its addenda. */
export function originalPhotos(photos: LocalPhoto[]): LocalPhoto[] {
  return photos.filter((p) => !p.addendumId).sort((a, b) => a.seq - b.seq);
}

export function addendumPhotos(photos: LocalPhoto[], addendumId: string): LocalPhoto[] {
  return photos.filter((p) => p.addendumId === addendumId).sort((a, b) => a.seq - b.seq);
}

/**
 * The multipart body for the drafts endpoint. Same shape the old outbox
 * sends, plus the visit and the visit's supplier, so the server can record
 * the booth context whichever capture arrives first.
 */
export function captureToFormData(
  capture: LocalCapture,
  visit: LocalVisit | undefined,
  photos: LocalPhoto[],
): FormData {
  const body = new FormData();
  body.set("clientId", capture.captureId);
  body.set("kind", capture.kind);
  body.set("capturedAt", capture.startedAt);
  body.set("visitId", capture.visitId);
  if (visit?.supplierId) body.set("visitSupplierId", String(visit.supplierId));
  const fields: Record<string, string> = {};
  if (capture.note.trim()) fields.notes = capture.note.trim();
  body.set("fields", JSON.stringify(fields));
  const field = capture.kind === "contact" ? "cardImages" : "images";
  for (const photo of originalPhotos(photos)) {
    body.append(field, new File([photo.bytes], photo.name, { type: photo.type }));
  }
  return body;
}

export function addendumToFormData(addendum: LocalAddendum, photos: LocalPhoto[]): FormData {
  const body = new FormData();
  body.set("addendumId", addendum.addendumId);
  body.set("captureClientId", addendum.captureId);
  for (const photo of addendumPhotos(photos, addendum.addendumId)) {
    body.append("images", new File([photo.bytes], photo.name, { type: photo.type }));
  }
  return body;
}

/**
 * What to deliver, in order. Captures first, oldest first. Then addenda, but
 * only for captures the server already holds: an addendum for a capture
 * still in the queue waits its turn, and one for a capture no longer on the
 * phone (delivered and cleaned up) goes.
 */
export function deliveryPlan(
  captures: LocalCapture[],
  addenda: LocalAddendum[],
): { captures: LocalCapture[]; addenda: LocalAddendum[] } {
  const queued = captures
    .filter((c) => c.status === "pending")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const local = new Map(captures.map((c) => [c.captureId, c]));
  const ready = addenda
    .filter((a) => a.status === "pending")
    .filter((a) => {
      const owner = local.get(a.captureId);
      return !owner || owner.status === "sent";
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { captures: queued, addenda: ready };
}

/** Everything still owed to the server, for the badge. */
export function owedCount(captures: LocalCapture[], addenda: LocalAddendum[]): number {
  return (
    captures.filter((c) => c.status === "pending" || c.status === "blocked").length +
    addenda.filter((a) => a.status === "pending" || a.status === "blocked").length
  );
}

export function blockedCount(captures: LocalCapture[], addenda: LocalAddendum[]): number {
  return (
    captures.filter((c) => c.status === "blocked").length +
    addenda.filter((a) => a.status === "blocked").length
  );
}

/**
 * Whether a delivery answered with `status` is worth another try — the
 * same split as the old outbox: unreachable retries forever, a refusal the
 * server means is parked for a person. An addendum has one more retryable
 * answer, 409: its capture has not arrived yet.
 */
export function shouldRetryDelivery(status: number | null, kind: "capture" | "addendum"): boolean {
  if (status === null) return true;
  if (status === 401 || status === 403) return true;
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  if (kind === "addendum" && status === 409) return true;
  return false;
}

type Deliverable = { status: string; attempts: number; lastError?: string };

/**
 * The item after an attempt. A 2xx marks it sent; the caller only deletes
 * once that is written down, so a crash between the two costs a duplicate
 * delivery (which the server's id check absorbs), never a lost capture.
 */
export function afterDelivery<T extends Deliverable>(
  item: T,
  kind: "capture" | "addendum",
  status: number | null,
  detail?: { error?: string },
): T {
  const attempts = item.attempts + 1;
  if (status !== null && status >= 200 && status < 300) {
    return { ...item, status: "sent", attempts, lastError: undefined };
  }
  return {
    ...item,
    attempts,
    status: shouldRetryDelivery(status, kind) ? "pending" : "blocked",
    lastError: detail?.error ?? (status === null ? "network" : `http-${status}`),
  };
}

/** Bytes a set of photos occupies on the phone. */
export function photoBytes(photos: { bytes: ArrayBuffer }[]): number {
  return photos.reduce((total, p) => total + p.bytes.byteLength, 0);
}

/** "1.2 MB", "340 KB" — for the storage line under the queue. */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/**
 * The open capture to resume when the screen comes back, if any: the most
 * recently started one. A phone that was closed mid-booth shows this with
 * its visit context rather than a blank screen.
 */
export function resumableCapture(captures: LocalCapture[]): LocalCapture | undefined {
  return captures
    .filter((c) => c.status === "open")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

/** The most recently used visit, to carry the supplier context forward. */
export function currentVisit(visits: LocalVisit[]): LocalVisit | undefined {
  return [...visits].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0];
}

/**
 * The last capture that can still take an addendum: the newest sealed one
 * (pending or sent). An open capture is not "previous" — it is current.
 */
export function previousCapture(captures: LocalCapture[]): LocalCapture | undefined {
  return captures
    .filter((c) => c.status === "pending" || c.status === "sent")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}
