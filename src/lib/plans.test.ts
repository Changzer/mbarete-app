import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, planOf, hasRoomFor, seatLimit, usageLabel } from "./plans";

test("plans: free is catalog-and-contacts, pro is everything", () => {
  assert.equal(PLANS.free.modules.orders, false);
  assert.equal(PLANS.free.modules.finance, false);
  assert.equal(PLANS.pro.modules.orders, true);
  assert.equal(PLANS.pro.modules.finance, true);
});

test("plans: seats are 1 on free, 5 on pro, and extras stack on both", () => {
  assert.equal(seatLimit(PLANS.free, 0), 1);
  assert.equal(seatLimit(PLANS.pro, 0), 5);
  assert.equal(seatLimit(PLANS.free, 2), 3);
  assert.equal(seatLimit(PLANS.pro, 3), 8);
  // Corrupt extras must never shrink the plan's own cap.
  assert.equal(seatLimit(PLANS.free, -5), 1);
});

test("plans: an unknown plan name reads as free, never as pro", () => {
  assert.equal(planOf("enterprise-typo").id, "free");
  assert.equal(planOf("").id, "free");
  assert.equal(planOf("pro").id, "pro");
});

test("plans: room checks are strict at the limit", () => {
  assert.equal(hasRoomFor(2, 1), true);
  assert.equal(hasRoomFor(2, 2), false);
  assert.equal(hasRoomFor(2, 3), false);
  assert.equal(hasRoomFor(null, 1_000_000), true);
});

test("plans: usage labels show the cap only when there is one", () => {
  assert.equal(usageLabel(12, 50), "12/50");
  assert.equal(usageLabel(12, null), "12");
});
