import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, isEditable, isDeletable } from "./order-status";

test("shipped is terminal: no transition leaves it", () => {
  assert.equal(canTransition("shipped", "draft"), false);
  assert.equal(canTransition("shipped", "confirmed"), false);
  assert.equal(canTransition("shipped", "cancelled"), false);
  assert.equal(canTransition("shipped", "shipped"), true); // idempotent no-op
});

test("cancelled reopens instead of forcing a duplicate order", () => {
  assert.equal(canTransition("cancelled", "draft"), true);
  assert.equal(canTransition("cancelled", "confirmed"), true);
  assert.equal(canTransition("cancelled", "shipped"), false);
});

test("the forward path holds and drafts cannot jump straight to shipped", () => {
  assert.equal(canTransition("draft", "confirmed"), true);
  assert.equal(canTransition("draft", "shipped"), false);
  assert.equal(canTransition("confirmed", "shipped"), true);
  assert.equal(canTransition("confirmed", "draft"), true);
});

test("editing stops at shipped; deleting is drafts and cancellations only", () => {
  assert.equal(isEditable("draft"), true);
  assert.equal(isEditable("confirmed"), true);
  assert.equal(isEditable("cancelled"), true);
  assert.equal(isEditable("shipped"), false);
  assert.equal(isDeletable("draft"), true);
  assert.equal(isDeletable("cancelled"), true);
  assert.equal(isDeletable("confirmed"), false);
  assert.equal(isDeletable("shipped"), false);
});
