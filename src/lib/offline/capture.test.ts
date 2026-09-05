import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addendumToFormData,
  afterDelivery,
  captureToFormData,
  currentVisit,
  deliveryPlan,
  formatBytes,
  mayHaveBeenSent,
  owedCount,
  previousCapture,
  resumableCapture,
  sealCapture,
  shouldRetryDelivery,
  type LocalAddendum,
  type LocalCapture,
  type LocalPhoto,
  type LocalVisit,
} from "./capture";

const capture = (over: Partial<LocalCapture> = {}): LocalCapture => ({
  captureId: "cap-1",
  visitId: "vis-1",
  kind: "product",
  status: "open",
  startedAt: "2026-09-05T08:00:00.000Z",
  note: "",
  photoCount: 0,
  attempts: 0,
  ...over,
});

const photo = (over: Partial<LocalPhoto> = {}): LocalPhoto => ({
  captureId: "cap-1",
  seq: 0,
  name: "p.jpg",
  type: "image/jpeg",
  bytes: new Uint8Array([1, 2, 3]).buffer,
  addedAt: "2026-09-05T08:00:01.000Z",
  ...over,
});

test("sealing needs at least one photo, and only ever seals an open capture", () => {
  const empty = sealCapture(capture(), "2026-09-05T08:01:00.000Z");
  assert.equal(empty.status, "open");
  const sealed = sealCapture(capture({ photoCount: 2 }), "2026-09-05T08:01:00.000Z");
  assert.equal(sealed.status, "pending");
  assert.equal(sealed.sealedAt, "2026-09-05T08:01:00.000Z");
  // Sealing again is a no-op: the payload of a queued capture is frozen.
  assert.equal(sealCapture(sealed, "2026-09-05T09:00:00.000Z").sealedAt, sealed.sealedAt);
});

test("a queued capture may already be on the server, so it is never rewritten", () => {
  assert.equal(mayHaveBeenSent(capture()), false);
  assert.equal(mayHaveBeenSent(capture({ status: "pending" })), true);
  assert.equal(mayHaveBeenSent(capture({ status: "sent" })), true);
});

test("the capture body carries id, visit, supplier and note; addendum photos stay out", () => {
  const visit: LocalVisit = {
    visitId: "vis-1",
    startedAt: "2026-09-05T07:59:00.000Z",
    lastUsedAt: "2026-09-05T08:00:00.000Z",
    supplierId: 42,
  };
  const body = captureToFormData(
    capture({ status: "pending", note: " 320/ctn, said 15 days ", photoCount: 2 }),
    visit,
    [photo({ seq: 1 }), photo({ seq: 0 }), photo({ seq: 2, addendumId: "add-1" })],
  );
  assert.equal(body.get("clientId"), "cap-1");
  assert.equal(body.get("visitId"), "vis-1");
  assert.equal(body.get("visitSupplierId"), "42");
  assert.deepEqual(JSON.parse(String(body.get("fields"))), { notes: "320/ctn, said 15 days" });
  assert.equal(body.getAll("images").length, 2);
  // A card capture posts under the contact form's field name.
  const card = captureToFormData(capture({ kind: "contact", status: "pending" }), undefined, [photo()]);
  assert.equal(card.getAll("cardImages").length, 1);
  assert.equal(card.has("visitSupplierId"), false);
});

test("an addendum body names its capture and carries only its own photos", () => {
  const add: LocalAddendum = {
    addendumId: "add-1",
    captureId: "cap-1",
    status: "pending",
    attempts: 0,
    createdAt: "2026-09-05T08:05:00.000Z",
  };
  const body = addendumToFormData(add, [photo({ seq: 0 }), photo({ seq: 3, addendumId: "add-1" })]);
  assert.equal(body.get("addendumId"), "add-1");
  assert.equal(body.get("captureClientId"), "cap-1");
  assert.equal(body.getAll("images").length, 1);
});

test("delivery order: captures oldest first; an addendum waits for its capture", () => {
  const captures = [
    capture({ captureId: "cap-b", status: "pending", startedAt: "2026-09-05T08:10:00.000Z" }),
    capture({ captureId: "cap-a", status: "pending", startedAt: "2026-09-05T08:00:00.000Z" }),
    capture({ captureId: "cap-c", status: "sent", startedAt: "2026-09-05T07:00:00.000Z" }),
    capture({ captureId: "cap-d", status: "open", startedAt: "2026-09-05T08:20:00.000Z" }),
  ];
  const addenda: LocalAddendum[] = [
    { addendumId: "add-b", captureId: "cap-b", status: "pending", attempts: 0, createdAt: "1" },
    { addendumId: "add-c", captureId: "cap-c", status: "pending", attempts: 0, createdAt: "2" },
    { addendumId: "add-gone", captureId: "cap-gone", status: "pending", attempts: 0, createdAt: "3" },
    { addendumId: "add-done", captureId: "cap-c", status: "sent", attempts: 1, createdAt: "0" },
  ];
  const plan = deliveryPlan(captures, addenda);
  assert.deepEqual(plan.captures.map((c) => c.captureId), ["cap-a", "cap-b"]);
  // cap-b is still queued, so add-b waits; cap-c is sent and cap-gone was
  // delivered and cleaned up, so both of theirs go.
  assert.deepEqual(plan.addenda.map((a) => a.addendumId), ["add-c", "add-gone"]);
  assert.equal(owedCount(captures, addenda), 5);
});

test("retry rules: unreachable forever, refusals parked, 409 retried for addenda only", () => {
  assert.equal(shouldRetryDelivery(null, "capture"), true);
  assert.equal(shouldRetryDelivery(503, "capture"), true);
  assert.equal(shouldRetryDelivery(401, "capture"), true);
  assert.equal(shouldRetryDelivery(413, "capture"), false);
  assert.equal(shouldRetryDelivery(409, "capture"), false);
  assert.equal(shouldRetryDelivery(409, "addendum"), true);
  assert.equal(shouldRetryDelivery(410, "addendum"), false);
});

test("after a delivery: 2xx is sent, retryable stays pending, refusal blocks", () => {
  const c = capture({ status: "pending" });
  assert.equal(afterDelivery(c, "capture", 201).status, "sent");
  const again = afterDelivery(c, "capture", null);
  assert.equal(again.status, "pending");
  assert.equal(again.attempts, 1);
  assert.equal(again.lastError, "network");
  const parked = afterDelivery(c, "capture", 413, { error: "too-large" });
  assert.equal(parked.status, "blocked");
  assert.equal(parked.lastError, "too-large");
});

test("resume the newest open capture; the previous one is the newest sealed", () => {
  const captures = [
    capture({ captureId: "old-open", status: "open", startedAt: "2026-09-05T07:00:00.000Z" }),
    capture({ captureId: "new-open", status: "open", startedAt: "2026-09-05T09:00:00.000Z" }),
    capture({ captureId: "sent", status: "sent", startedAt: "2026-09-05T08:00:00.000Z" }),
    capture({ captureId: "queued", status: "pending", startedAt: "2026-09-05T08:30:00.000Z" }),
  ];
  assert.equal(resumableCapture(captures)?.captureId, "new-open");
  assert.equal(previousCapture(captures)?.captureId, "queued");
  assert.equal(resumableCapture([]), undefined);
});

test("the current visit is the most recently used one", () => {
  const visits: LocalVisit[] = [
    { visitId: "a", startedAt: "1", lastUsedAt: "2026-09-05T08:00:00.000Z" },
    { visitId: "b", startedAt: "2", lastUsedAt: "2026-09-05T09:00:00.000Z" },
  ];
  assert.equal(currentVisit(visits)?.visitId, "b");
  assert.equal(formatBytes(340 * 1024), "340 KB");
  assert.equal(formatBytes(1.25 * 1024 * 1024), "1.3 MB");
});
