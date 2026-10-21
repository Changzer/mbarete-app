import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultNextKey,
  dueState,
  groupLines,
  groupKey,
  hasPendingStep,
  needsAttention,
  nextStageOf,
  nextStepInput,
  checklistTextInput,
  updateBodyInput,
  clientKeyInput,
  utcStampToIso,
  formatDay,
  initials,
  type FollowupLine,
} from "./followup";

test("stages run in order and stop at the warehouse; the order ships as one", () => {
  assert.equal(nextStageOf("deposit"), "production");
  assert.equal(nextStageOf("to_warehouse"), "at_warehouse");
  assert.equal(nextStageOf("at_warehouse"), null);
});

test("a fresh card says what the stage needs; at the warehouse nothing is pending", () => {
  assert.equal(defaultNextKey("supplier", "deposit"), "deposit");
  assert.equal(defaultNextKey("supplier", "at_warehouse"), null);
  assert.equal(defaultNextKey("unassigned", "deposit"), "unassigned");
  assert.equal(defaultNextKey("shipment", "deposit"), "shipment");
  assert.equal(hasPendingStep({ kind: "supplier", stage: "at_warehouse", nextStep: "" }), false);
  assert.equal(hasPendingStep({ kind: "supplier", stage: "at_warehouse", nextStep: "Count cartons" }), true);
  assert.equal(hasPendingStep({ kind: "shipment", stage: "deposit", nextStep: "", complete: true }), false);
  assert.equal(hasPendingStep({ kind: "shipment", stage: "deposit", nextStep: "", complete: false }), true);
});

test("due dates read against the viewer's today; no date is never overdue", () => {
  const today = "2026-10-19";
  assert.deepEqual(dueState("2026-10-16", today), { state: "overdue", days: 3 });
  assert.deepEqual(dueState("2026-10-19", today), { state: "today", days: 0 });
  assert.deepEqual(dueState("2026-10-21", today), { state: "soon", days: 2 });
  assert.deepEqual(dueState("2026-10-28", today), { state: "later", days: 9 });
  assert.deepEqual(dueState(null, today), { state: "none", days: 0 });
  assert.deepEqual(dueState("next week", today), { state: "none", days: 0 });
});

test("needs attention: overdue, a flagged problem, or lines with no supplier", () => {
  const today = "2026-10-19";
  assert.equal(needsAttention({ kind: "supplier", nextDue: "2026-10-18", problem: "" }, today), true);
  assert.equal(needsAttention({ kind: "supplier", nextDue: "2026-10-19", problem: "" }, today), false);
  assert.equal(needsAttention({ kind: "supplier", nextDue: null, problem: "QC failed" }, today), true);
  assert.equal(needsAttention({ kind: "unassigned", nextDue: null, problem: "" }, today), true);
  assert.equal(needsAttention({ kind: "shipment", nextDue: null, problem: "  " }, today), false);
});

const line = (over: Partial<FollowupLine>): FollowupLine => ({
  orderId: 1,
  supplierId: 7,
  supplierNameEn: "Yongkang Jingmi Vehicle",
  supplierNameZh: "永康金米车业",
  productId: 1,
  name: "Item",
  quantity: 10,
  lineTotal: 100,
  currency: "CNY",
  ...over,
});

test("lines group per order and supplier, led by the line the most money goes to", () => {
  const groups = groupLines([
    line({ productId: 1, name: "Electric Scooter Charger", quantity: 50, lineTotal: 750 }),
    line({ productId: 2, name: "Electric Drift Trike Scooter 8inch", quantity: 400, lineTotal: 144000 }),
    line({ productId: 3, name: "Folding Electric Scooter 8.5-inch", quantity: 190, lineTotal: 112100 }),
    line({ productId: 4, name: "Controller", quantity: 5, lineTotal: 20, currency: "USD" }),
    line({ productId: 5, supplierId: null, supplierNameEn: "", supplierNameZh: "", name: "Shoe bag", quantity: 100, lineTotal: 300 }),
    line({ orderId: 2, productId: 6, name: "Other order", quantity: 1, lineTotal: 1 }),
  ]);
  const jingmi = groups.get(groupKey(1, 7))!;
  assert.equal(jingmi.supplierName, "永康金米车业");
  assert.equal(jingmi.supplierNameAlt, "Yongkang Jingmi Vehicle");
  assert.equal(jingmi.mainProductName, "Electric Drift Trike Scooter 8inch");
  assert.equal(jingmi.otherLines, 3);
  assert.equal(jingmi.pieces, 645);
  assert.deepEqual(jingmi.cost, [
    { currency: "CNY", amount: 256850 },
    { currency: "USD", amount: 20 },
  ]);
  const none = groups.get(groupKey(1, null))!;
  assert.equal(none.supplierName, "");
  assert.equal(none.mainProductName, "Shoe bag");
  assert.equal(groups.get(groupKey(2, 7))!.otherLines, 0);
});

test("RMB and CNY lines add up as one yuan total on the card", () => {
  const g = groupLines([
    line({ productId: 1, name: "Mini Refillable Atomizer Spray Bottle", quantity: 1200, lineTotal: 4920 }),
    line({ productId: 2, name: "Silicone Travel Bottle", quantity: 600, lineTotal: 1800 }),
    line({ productId: 3, name: "50ml Foam Pump Bottle", quantity: 1995, lineTotal: 2992.5, currency: "RMB" }),
  ]).get(groupKey(1, 7))!;
  assert.deepEqual(g.cost, [{ currency: "CNY", amount: 9712.5 }]);
  assert.equal(g.otherLines, 2);
});

test("a supplier with only an English name leads with it and has no second name", () => {
  const g = groupLines([line({ supplierNameZh: "" })]).get(groupKey(1, 7))!;
  assert.equal(g.supplierName, "Yongkang Jingmi Vehicle");
  assert.equal(g.supplierNameAlt, "");
});

test("inputs: one-line steps, real dates or none, non-empty checklist items", () => {
  assert.deepEqual(nextStepInput.parse({ nextStep: "  Confirm \n finish date ", nextDue: "2026-10-21", nextOwnerId: 3 }), {
    nextStep: "Confirm finish date",
    nextDue: "2026-10-21",
    nextOwnerId: 3,
  });
  assert.equal(nextStepInput.parse({ nextStep: "", nextDue: "", nextOwnerId: null }).nextDue, null);
  assert.equal(nextStepInput.safeParse({ nextStep: "x", nextDue: "2026-02-30x", nextOwnerId: null }).success, false);
  assert.equal(nextStepInput.safeParse({ nextStep: "x".repeat(201), nextDue: null, nextOwnerId: null }).success, false);
  assert.equal(checklistTextInput.safeParse("   ").success, false);
  assert.equal(updateBodyInput.parse(" 工厂说\r\n周五完工 "), "工厂说\n周五完工");
  assert.equal(clientKeyInput.safeParse("3f0c2b1a-6d4e-4c3b-9a7f-2b1d0e9c8a7b").success, true);
  assert.equal(clientKeyInput.safeParse("x'; drop").success, false);
});

test("stored UTC stamps become ISO instants; ISO passes through", () => {
  assert.equal(utcStampToIso("2026-10-19 03:20:00"), "2026-10-19T03:20:00Z");
  assert.equal(utcStampToIso("2026-10-19T03:20:00.000Z"), "2026-10-19T03:20:00.000Z");
});

test("agreed dates read the same on the server and in the browser, in both languages", () => {
  assert.equal(formatDay("2026-10-21", "en"), "Wed 21 Oct");
  assert.equal(formatDay("2026-10-18", "zh"), "10月18日周日");
  assert.equal(formatDay("not a date", "en"), "not a date");
});

test("faces: Latin initials, the Chinese name people use, never the 小 of a nickname", () => {
  assert.equal(initials("Abel Chang"), "AC");
  assert.equal(initials("Li 小李"), "李");
  assert.equal(initials("王伟"), "王");
  assert.equal(initials("Admin"), "A");
  assert.equal(initials("  "), "?");
});
