import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAiRead, utcDayStart } from "./ai-budget";

test("ai budget: the user's hourly brake answers first", () => {
  assert.equal(
    decideAiRead({ userOverLimit: true, metered: true, dailyLimit: 10, usedToday: 0 }),
    "user-limit",
  );
});

test("ai budget: the company's daily allowance binds only when metered", () => {
  assert.equal(
    decideAiRead({ userOverLimit: false, metered: true, dailyLimit: 50, usedToday: 50 }),
    "company-budget",
  );
  assert.equal(
    decideAiRead({ userOverLimit: false, metered: true, dailyLimit: 50, usedToday: 49 }),
    "ok",
  );
  // Self-hosted pays its own API bill: the same numbers are never refused.
  assert.equal(
    decideAiRead({ userOverLimit: false, metered: false, dailyLimit: 50, usedToday: 500 }),
    "ok",
  );
  // A plan with no cap is unlimited however busy the day was.
  assert.equal(
    decideAiRead({ userOverLimit: false, metered: true, dailyLimit: null, usedToday: 9999 }),
    "ok",
  );
});

test("ai budget: the day starts at UTC midnight in the ledger's own format", () => {
  assert.equal(utcDayStart(new Date("2026-09-02T23:59:59Z")), "2026-09-02 00:00:00");
  assert.equal(utcDayStart(new Date("2026-09-03T00:00:00Z")), "2026-09-03 00:00:00");
});
