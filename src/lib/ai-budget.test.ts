import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAiRead, utcDayStart } from "./ai-budget";

test("ai budget: the user's hourly brake answers first", () => {
  assert.equal(decideAiRead({ userOverLimit: true, dailyLimit: 10, usedToday: 0 }), "user-limit");
});

test("ai budget: the daily allowance binds at the cap; null is unlimited, zero is off", () => {
  assert.equal(
    decideAiRead({ userOverLimit: false, dailyLimit: 50, usedToday: 50 }),
    "company-budget",
  );
  assert.equal(decideAiRead({ userOverLimit: false, dailyLimit: 50, usedToday: 49 }), "ok");
  // No cap (self-hosted, or a plan without one): never refused however busy.
  assert.equal(decideAiRead({ userOverLimit: false, dailyLimit: null, usedToday: 9999 }), "ok");
  // The panel's "off": nothing gets through, not even the first read.
  assert.equal(
    decideAiRead({ userOverLimit: false, dailyLimit: 0, usedToday: 0 }),
    "company-budget",
  );
});

test("ai budget: the day starts at UTC midnight in the ledger's own format", () => {
  assert.equal(utcDayStart(new Date("2026-09-02T23:59:59Z")), "2026-09-02 00:00:00");
  assert.equal(utcDayStart(new Date("2026-09-03T00:00:00Z")), "2026-09-03 00:00:00");
});
