import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAttempt,
  interpretDelivery,
  collectDraftFields,
  deliveryOrder,
  draftBytes,
  draftToFormData,
  nextAttemptDelayMs,
  retryDraft,
  shouldRetry,
  unsentDrafts,
  type OfflineDraft,
} from "./draft";

const bytes = (n: number) => new Uint8Array(n).fill(1).buffer;

function draft(over: Partial<OfflineDraft> = {}): OfflineDraft {
  return {
    kind: "product",
    clientId: "c1",
    capturedAt: "2026-04-20T09:00:00.000Z",
    fields: { nameEn: "Mug", price: "1.20" },
    images: [{ field: "images", name: "photo.jpg", type: "image/jpeg", bytes: bytes(4) }],
    status: "pending",
    attempts: 0,
    ...over,
  };
}

test("fields: every typed string is captured", () => {
  const form = new FormData();
  form.set("nameEn", "Ceramic mug");
  form.set("price", "1,20");
  form.set("categoryId", "3");
  assert.deepEqual(collectDraftFields(form), {
    nameEn: "Ceramic mug",
    price: "1,20",
    categoryId: "3",
  });
});

test("fields: decimals are kept exactly as typed, for the server to normalize", () => {
  const form = new FormData();
  form.set("weightKg", "10,25");
  assert.equal(collectDraftFields(form).weightKg, "10,25");
});

test("fields: form machinery is left out", () => {
  const form = new FormData();
  form.set("nameEn", "Mug");
  form.set("andAnother", "1");
  form.append("removeImageIds", "7");
  form.append("images", new File([bytes(2)], "a.jpg", { type: "image/jpeg" }));
  assert.deepEqual(collectDraftFields(form), { nameEn: "Mug" });
});

test("body: a draft rebuilds into the multipart the endpoint expects", async () => {
  const body = draftToFormData(draft());
  assert.equal(body.get("clientId"), "c1");
  assert.equal(body.get("kind"), "product");
  assert.equal(body.get("capturedAt"), "2026-04-20T09:00:00.000Z");
  assert.deepEqual(JSON.parse(String(body.get("fields"))), {
    nameEn: "Mug",
    price: "1.20",
  });
  const images = body.getAll("images");
  assert.equal(images.length, 1);
  const file = images[0] as File;
  assert.equal(file.name, "photo.jpg");
  assert.equal(file.type, "image/jpeg");
  assert.equal(file.size, 4);
});

test("body: the same draft rebuilds identically on every retry", () => {
  const d = draft({ images: [
    { field: "images", name: "a.jpg", type: "image/jpeg", bytes: bytes(3) },
    { field: "images", name: "b.jpg", type: "image/jpeg", bytes: bytes(5) },
  ] });
  const first = draftToFormData(d);
  const second = draftToFormData(d);
  assert.equal(first.get("fields"), second.get("fields"));
  assert.deepEqual(
    first.getAll("images").map((f) => (f as File).size),
    second.getAll("images").map((f) => (f as File).size),
  );
});

test("body: contact photos keep their slots — cards and the QR stay apart", () => {
  const body = draftToFormData(
    draft({
      kind: "contact",
      fields: { type: "supplier", companyName: "Yiwu Mugs" },
      images: [
        { field: "cardImages", name: "front.jpg", type: "image/jpeg", bytes: bytes(3) },
        { field: "cardImages", name: "back.jpg", type: "image/jpeg", bytes: bytes(3) },
        { field: "qrImage", name: "qr.png", type: "image/png", bytes: bytes(2) },
      ],
    }),
  );
  assert.equal(body.get("kind"), "contact");
  assert.equal(body.getAll("cardImages").length, 2);
  assert.equal(body.getAll("qrImage").length, 1);
  assert.equal(body.getAll("images").length, 0);
});

test("retry: an unanswered request always retries", () => {
  assert.equal(shouldRetry(null), true);
});

test("retry: server trouble and rate limits retry", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(shouldRetry(status), true, `expected ${status} to retry`);
  }
});

test("retry: an expired session retries, because signing in fixes it", () => {
  assert.equal(shouldRetry(401), true);
  assert.equal(shouldRetry(403), true);
});

test("retry: a refusal the server means is not retried", () => {
  for (const status of [400, 404, 409, 413, 415, 422]) {
    assert.equal(shouldRetry(status), false, `expected ${status} not to retry`);
  }
});

test("backoff: the first attempt is immediate, later ones step up to a cap", () => {
  assert.equal(nextAttemptDelayMs(0), 0);
  assert.ok(nextAttemptDelayMs(1) < nextAttemptDelayMs(2));
  assert.ok(nextAttemptDelayMs(3) < nextAttemptDelayMs(4));
  assert.equal(nextAttemptDelayMs(4), nextAttemptDelayMs(40));
});

test("attempt: a 201 marks the draft sent and records the server id", () => {
  const after = applyAttempt(draft(), 201, { draftId: 42 });
  assert.equal(after.status, "sent");
  assert.equal(after.draftId, 42);
  assert.equal(after.attempts, 1);
  assert.equal(after.lastError, undefined);
});

test("attempt: replaying an id the server already holds still counts as sent", () => {
  // The server answers 200 with the existing draft rather than making a twin.
  const after = applyAttempt(draft({ attempts: 3 }), 200, { draftId: 42 });
  assert.equal(after.status, "sent");
  assert.equal(after.draftId, 42);
});

test("attempt: a dead network leaves the draft pending, with the attempt counted", () => {
  const after = applyAttempt(draft(), null);
  assert.equal(after.status, "pending");
  assert.equal(after.attempts, 1);
  assert.equal(after.lastError, "network");
});

test("attempt: a refused payload is parked as blocked, never dropped", () => {
  const after = applyAttempt(draft(), 413, { error: "too-large" });
  assert.equal(after.status, "blocked");
  assert.equal(after.lastError, "too-large");
});

test("attempt: a signed-out reply keeps the draft in the queue", () => {
  const after = applyAttempt(draft(), 401);
  assert.equal(after.status, "pending");
});

test("queue: sent drafts stop counting as owed", () => {
  const queue = [draft(), draft({ clientId: "c2", status: "sent" }), draft({ clientId: "c3", status: "blocked" })];
  assert.deepEqual(unsentDrafts(queue).map((d) => d.clientId), ["c1", "c3"]);
});

test("order: oldest capture first, so the day is delivered in the order it happened", () => {
  const queue = [
    draft({ clientId: "late", capturedAt: "2026-04-20T15:00:00.000Z" }),
    draft({ clientId: "early", capturedAt: "2026-04-20T09:00:00.000Z" }),
    draft({ clientId: "mid", capturedAt: "2026-04-20T11:00:00.000Z" }),
  ];
  assert.deepEqual(deliveryOrder(queue).map((d) => d.clientId), ["early", "mid", "late"]);
});

test("order: a blocked draft is never auto-delivered — retrying it is a person's call", () => {
  const queue = [
    draft({ clientId: "stuck", capturedAt: "2026-04-20T08:00:00.000Z", status: "blocked" }),
    draft({ clientId: "good", capturedAt: "2026-04-20T09:00:00.000Z" }),
  ];
  assert.deepEqual(deliveryOrder(queue).map((d) => d.clientId), ["good"]);
});

test("retry: re-arming a blocked draft clears its history and delivers immediately", () => {
  const stuck = draft({ status: "blocked", attempts: 7, lastError: "too-large" });
  const armed = retryDraft(stuck);
  assert.equal(armed.status, "pending");
  assert.equal(armed.attempts, 0);
  assert.equal(armed.lastError, undefined);
  assert.equal(nextAttemptDelayMs(armed.attempts), 0);
  assert.deepEqual(deliveryOrder([armed]).map((d) => d.clientId), [armed.clientId]);
});

test("order: delivered drafts are not sent twice", () => {
  const queue = [draft({ clientId: "done", status: "sent" }), draft({ clientId: "todo" })];
  assert.deepEqual(deliveryOrder(queue).map((d) => d.clientId), ["todo"]);
});

test("size: the queue reports the photo bytes held on the phone", () => {
  const queue = [
    draft({ images: [{ field: "images", name: "a.jpg", type: "image/jpeg", bytes: bytes(1000) }] }),
    draft({
      clientId: "c2",
      images: [
        { field: "images", name: "b.jpg", type: "image/jpeg", bytes: bytes(2000) },
        { field: "images", name: "c.jpg", type: "image/jpeg", bytes: bytes(500) },
      ],
    }),
  ];
  assert.equal(draftBytes(queue), 3500);
});

test("delivery: a 2xx with our JSON body is a real delivery", () => {
  const verdict = interpretDelivery(201, { draftId: 7, duplicate: false });
  assert.deepEqual(verdict, { status: 201, draftId: 7 });
});

test("delivery: a captive portal's 200 never counts as delivered", () => {
  // A hall's wi-fi answers 200 with an HTML login page; res.json() fails and
  // the caller passes null. The capture must stay on the phone.
  for (const body of [null, undefined, "<html>", [], { token: "x" }]) {
    const verdict = interpretDelivery(200, body);
    assert.equal(verdict.status, null, `body ${JSON.stringify(body)}`);
    assert.equal(verdict.error, "portal-response");
    assert.equal(applyAttempt(draft(), verdict.status, verdict).status, "pending");
  }
});

test("delivery: non-2xx statuses pass through untouched", () => {
  assert.deepEqual(interpretDelivery(503, null), { status: 503 });
  assert.deepEqual(interpretDelivery(null, null), { status: null });
});
