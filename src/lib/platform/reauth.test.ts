import { test } from "node:test";
import assert from "node:assert/strict";
import { makeReauthTracker } from "./reauth";

test("reauth: unmarked user is not fresh", () => {
  const t = makeReauthTracker({ ttlMs: 1000 });
  assert.equal(t.isFresh(1), false);
});

test("reauth: a confirmation is fresh until the TTL, then expires server-side", () => {
  let clock = 0;
  const t = makeReauthTracker({ ttlMs: 1000, now: () => clock });
  t.mark(1);
  clock = 999;
  assert.equal(t.isFresh(1), true);
  clock = 1000;
  assert.equal(t.isFresh(1), false); // the TTL is the wall, not a suggestion
  clock = 0;
  assert.equal(t.isFresh(1), false); // expiry deleted the mark for good
});

test("reauth: users are independent and clear() revokes one", () => {
  const t = makeReauthTracker({ ttlMs: 1000 });
  t.mark(1);
  assert.equal(t.isFresh(2), false);
  t.clear(1);
  assert.equal(t.isFresh(1), false);
});
