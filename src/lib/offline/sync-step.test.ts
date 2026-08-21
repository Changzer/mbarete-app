import test from "node:test";
import assert from "node:assert/strict";
import { syncStepFor, type SyncCounts } from "./sync-step";

function state(over: Partial<SyncCounts> = {}): SyncCounts {
  return {
    pending: 0,
    blocked: 0,
    syncing: false,
    needsSignIn: false,
    offline: false,
    ...over,
  };
}

test("a connected phone with nothing owed shows no chip at all", () => {
  assert.equal(syncStepFor(state()), null);
});

test("offline with nothing owed is the quiet rung, not a warning", () => {
  assert.equal(syncStepFor(state({ offline: true })), "offline");
});

test("captures on the phone read as waiting, so the count can be shown", () => {
  assert.equal(syncStepFor(state({ pending: 3 })), "waiting");
});

test("offline and holding captures still reads as waiting", () => {
  // The count is the part the agent needs; "offline" alone would drop it.
  assert.equal(syncStepFor(state({ pending: 3, offline: true })), "waiting");
});

test("a delivery in flight outranks everything else on screen", () => {
  assert.equal(syncStepFor(state({ pending: 2, syncing: true })), "syncing");
});

test("a refused capture is a failure — and outranks the plain waiting count", () => {
  assert.equal(syncStepFor(state({ pending: 4, blocked: 1 })), "failed");
});

test("an expired session is a failure too: it needs a person, not patience", () => {
  assert.equal(syncStepFor(state({ pending: 1, needsSignIn: true })), "failed");
});

test("a phone that is merely offline never reads as failed", () => {
  // The reassurance rule: nothing has been lost, so nothing says it has.
  for (const s of [state({ offline: true }), state({ offline: true, pending: 9 })]) {
    assert.notEqual(syncStepFor(s), "failed");
  }
});
