/**
 * The shape of a product capture that has not reached the database yet, and
 * the pure rules for moving one through the outbox.
 *
 * A trade agent walking Yiwu or the Canton Fair works where the network is
 * unreliable: the booth is in a steel hall, Tailscale drops, the phone hands
 * off between towers. The capture itself must never depend on any of that —
 * photograph the item, save, move to the next booth — so a save with no usable
 * connection is written to the phone instead and shipped later.
 *
 * Everything here is deliberately free of IndexedDB and of the DOM: the
 * storage binding lives in `src/lib/client/outbox-db.ts` and the sync loop in
 * the outbox provider, so the rules that decide what is kept, what is retried
 * and what is given up on can be tested under `node --test`.
 */

/**
 * Which form slot a photo belongs to. Products only ever use "images";
 * contacts keep card photos and the cropped WeChat QR apart, the same way the
 * live contact form posts them as separate fields.
 */
export type DraftImageField = "images" | "cardImages" | "qrImage";

/**
 * A photo, stored as bytes rather than as a `File` or `Blob`.
 *
 * Structured clone can hold a Blob in IndexedDB, but Blob support there has a
 * long history of browser bugs — most memorably Safari returning empty blobs
 * for records written in an earlier session, which is exactly the "saved it
 * yesterday, it is gone today" failure this feature exists to prevent. An
 * ArrayBuffer is plain data every engine round-trips correctly.
 */
export type DraftImage = {
  field: DraftImageField;
  name: string;
  type: string;
  bytes: ArrayBuffer;
};

/** Where a draft is in its life. Only `sent` is safe to delete. */
export type DraftStatus =
  /** On the phone, waiting for a connection. */
  | "pending"
  /** Accepted by the server; the row exists in the database. */
  | "sent"
  /**
   * The server refused it for a reason retrying cannot fix (too large, a
   * rejected file type, a signed-out session). Kept on the phone and shown to
   * the user, never silently dropped.
   */
  | "blocked";

export type OfflineDraft = {
  /** What the capture will become once delivered and reviewed. */
  kind: "product" | "contact";
  /**
   * Minted on the phone at capture time and never reused. It is what makes a
   * replay safe: the server stores it, and a second delivery of the same id
   * returns the draft that already exists instead of creating a twin. On a
   * flaky link the request that succeeded but never delivered its response is
   * the common case, not the rare one.
   */
  clientId: string;
  /** When the agent hit save, not when it reached the server. */
  capturedAt: string;
  /** The product form's fields verbatim, as strings, exactly as posted. */
  fields: Record<string, string>;
  images: DraftImage[];
  status: DraftStatus;
  /** Delivery attempts so far, which is what paces the retries. */
  attempts: number;
  /** Last failure, kept so a stuck draft can explain itself. */
  lastError?: string;
  /** Server draft id, once accepted. */
  draftId?: number;
};

/** Fields that belong to the forms' machinery, not to the captured data. */
const MACHINERY_FIELDS = new Set(["images", "andAnother", "removeImageIds", "draftId"]);

/**
 * The product fields out of a submitted form, as plain strings.
 *
 * Values are kept exactly as typed — "10,20" stays "10,20" — because the
 * server normalizes decimals for comma-locale keyboards on the way in, and
 * doing it twice in different places is how the two drift apart.
 */
export function collectDraftFields(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (MACHINERY_FIELDS.has(key)) continue;
    if (typeof value !== "string") continue;
    fields[key] = value;
  }
  return fields;
}

/**
 * A draft as the multipart body the drafts endpoint accepts.
 *
 * The same builder serves the first attempt and every retry, so a draft that
 * has sat on the phone for three days is delivered byte-identically to one
 * sent a second after capture.
 */
export function draftToFormData(draft: OfflineDraft): FormData {
  const body = new FormData();
  body.set("clientId", draft.clientId);
  body.set("kind", draft.kind);
  body.set("capturedAt", draft.capturedAt);
  body.set("fields", JSON.stringify(draft.fields));
  for (const image of draft.images) {
    body.append(image.field, new File([image.bytes], image.name, { type: image.type }));
  }
  return body;
}

/**
 * How long to wait before attempt number `attempts + 1`.
 *
 * Stepped rather than exponential, and capped at a minute: the agent is
 * walking between halls, so connectivity returns in seconds-to-minutes and a
 * doubling delay would leave drafts sitting long after the signal came back.
 * The cap also bounds the battery cost of a day spent out of range.
 */
export function nextAttemptDelayMs(attempts: number): number {
  const steps = [0, 2_000, 5_000, 15_000, 30_000];
  return steps[Math.min(attempts, steps.length - 1)] ?? 60_000;
}

/**
 * Whether a delivery that came back with `status` is worth trying again.
 *
 * The split is between "the network or the server is having a moment" and
 * "this request will never be accepted". Anything unreachable retries
 * forever — the whole point is that the data outlives the outage. A refusal
 * the server means (a bad payload, a file it will not store) is parked as
 * blocked so it surfaces to a human instead of looping until the battery dies.
 */
export function shouldRetry(status: number | null): boolean {
  // No response at all: DNS failed, TCP failed, the request was cut off.
  if (status === null) return true;
  // Sign-in expired mid-trip, or the middleware bounced us to /login. Both are
  // fixed by signing in again, and the draft must survive until that happens.
  if (status === 401 || status === 403) return true;
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/**
 * The draft after a delivery attempt, given how the server answered.
 *
 * `null` means the request never got an answer. A 2xx (including the replay of
 * an id the server already holds) marks the draft sent; the caller deletes it
 * only once that has been written down, so a crash between the two leaves a
 * duplicate delivery rather than a lost capture.
 */
export function applyAttempt(
  draft: OfflineDraft,
  status: number | null,
  detail?: { draftId?: number; error?: string },
): OfflineDraft {
  const attempts = draft.attempts + 1;

  if (status !== null && status >= 200 && status < 300) {
    return { ...draft, status: "sent", attempts, draftId: detail?.draftId, lastError: undefined };
  }

  return {
    ...draft,
    attempts,
    status: shouldRetry(status) ? "pending" : "blocked",
    lastError: detail?.error ?? (status === null ? "network" : `http-${status}`),
  };
}

/**
 * What a delivery's response actually proves, before it is applied.
 *
 * Venue and hotel wi-fi interpose captive portals that answer 200 to
 * anything, with a login page as the body. A 2xx alone must therefore never
 * delete a capture from the phone: only a body that parses as our endpoint's
 * answer — a JSON object carrying a numeric draftId — counts as delivered.
 * Anything else on a 2xx is treated as "never answered" and retried.
 */
export function interpretDelivery(
  status: number | null,
  body: unknown,
): { status: number | null; draftId?: number; error?: string } {
  if (status !== null && status >= 200 && status < 300) {
    const draftId =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { draftId?: unknown }).draftId
        : undefined;
    if (typeof draftId === "number" && Number.isFinite(draftId)) {
      return { status, draftId };
    }
    return { status: null, error: "portal-response" };
  }
  return { status };
}

/** Drafts still owed to the database — what the pending badge counts. */
export function unsentDrafts(drafts: OfflineDraft[]): OfflineDraft[] {
  return drafts.filter((d) => d.status !== "sent");
}

/**
 * The order drafts are delivered in: oldest capture first.
 *
 * Blocked drafts go last so one unacceptable payload never stands between the
 * queue and a hall's worth of good captures behind it.
 */
export function deliveryOrder(drafts: OfflineDraft[]): OfflineDraft[] {
  const rank = (d: OfflineDraft) => (d.status === "blocked" ? 1 : 0);
  return [...drafts]
    .filter((d) => d.status !== "sent")
    .sort((a, b) => rank(a) - rank(b) || a.capturedAt.localeCompare(b.capturedAt));
}

/** Bytes held on the phone, for the storage figure shown next to the queue. */
export function draftBytes(drafts: OfflineDraft[]): number {
  return drafts.reduce(
    (total, d) => total + d.images.reduce((sum, i) => sum + i.bytes.byteLength, 0),
    0,
  );
}
