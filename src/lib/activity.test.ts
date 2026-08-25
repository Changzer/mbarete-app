import { test } from "node:test";
import assert from "node:assert/strict";
import { activityCredit, utcDay, SESSION_GAP_MS } from "./activity";

const T0 = Date.parse("2026-08-24T10:00:00Z");

test("activity: the first touch of a day starts the clock and credits nothing", () => {
  assert.equal(activityCredit(null, T0), 0);
});

test("activity: short gaps are one sitting and count in full", () => {
  assert.equal(activityCredit(T0, T0 + 60_000), 60);
  assert.equal(activityCredit(T0, T0 + SESSION_GAP_MS), SESSION_GAP_MS / 1000);
});

test("activity: a long gap means away — the sitting ended, nothing accrues", () => {
  assert.equal(activityCredit(T0, T0 + SESSION_GAP_MS + 1), 0);
  assert.equal(activityCredit(T0, T0 + 3 * 60 * 60_000), 0);
});

test("activity: a clock that goes backwards credits nothing rather than negative", () => {
  assert.equal(activityCredit(T0, T0 - 5_000), 0);
});

test("activity: a browsing session sums to its real length", () => {
  // Touches every ~90s for 15 minutes, then lunch, then one more touch.
  let prev: number | null = null;
  let total = 0;
  for (let i = 0; i <= 10; i++) {
    const now = T0 + i * 90_000;
    total += activityCredit(prev, now);
    prev = now;
  }
  assert.equal(total, 900); // 10 gaps of 90s
  total += activityCredit(prev, prev! + 60 * 60_000); // lunch: no credit
  assert.equal(total, 900);
});

test("activity: days bucket in UTC", () => {
  assert.equal(utcDay(Date.parse("2026-08-24T23:59:59Z")), "2026-08-24");
  assert.equal(utcDay(Date.parse("2026-08-25T00:00:01Z")), "2026-08-25");
});
