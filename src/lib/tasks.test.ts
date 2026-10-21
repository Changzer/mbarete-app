import { test } from "node:test";
import assert from "node:assert/strict";
import { bellCount, collectTasks, sortTasks, type TaskCardInput } from "./tasks";

const ABEL = 1;
const LI = 2;

const card = (over: Partial<TaskCardInput> = {}): TaskCardInput => ({
  id: 10,
  orderId: 4,
  orderNumber: "ORD-20260907-755343",
  kind: "supplier",
  stage: "production",
  nextStep: "",
  nextDue: null,
  nextOwnerId: LI,
  nextAssignedBy: null,
  nextAssignedAt: null,
  supplierName: "义乌天使化妆品包装",
  supplierNameAlt: "Angel Packing Company",
  productName: "50ml Foam Pump Bottle",
  otherLines: 2,
  ...over,
});

test("a step handed over by someone else is new until the bell is opened after it", () => {
  const cards = [card({ nextStep: "Ask for QC photos", nextAssignedBy: ABEL, nextAssignedAt: "2026-10-21T02:00:00Z" })];
  const [fresh] = collectTasks(cards, [], LI, "2026-10-21T01:00:00Z");
  assert.equal(fresh.isNew, true);
  assert.equal(fresh.fromId, ABEL);
  assert.equal(fresh.text, "Ask for QC photos");
  assert.equal(collectTasks(cards, [], LI, null)[0].isNew, true, "never opened: everything handed over is new");
  assert.equal(collectTasks(cards, [], LI, "2026-10-21T02:00:00Z")[0].isNew, false, "seen at the same second");
});

test("your own steps are on the list but never new", () => {
  const [mine] = collectTasks([card({ nextOwnerId: ABEL, nextAssignedBy: ABEL, nextAssignedAt: "2026-10-21T02:00:00Z" })], [], ABEL, null);
  assert.equal(mine.isNew, false);
  assert.equal(mine.fromId, null);
  // A card made when the order was confirmed belongs to whoever created it, unannounced.
  assert.equal(collectTasks([card({ nextOwnerId: ABEL })], [], ABEL, null)[0].isNew, false);
});

test("a blank step stands for the stage's default; nothing is pending at the warehouse", () => {
  const [blank] = collectTasks([card()], [], LI, null);
  assert.equal(blank.text, "");
  assert.equal(blank.defaultKey, "production");
  assert.deepEqual(collectTasks([card({ stage: "at_warehouse" })], [], LI, null), []);
  assert.equal(collectTasks([card({ stage: "at_warehouse", nextStep: "Count cartons" })], [], LI, null).length, 1);
  assert.deepEqual(collectTasks([card({ kind: "shipment", complete: true })], [], LI, null), []);
  assert.equal(collectTasks([card({ kind: "shipment", complete: false })], [], LI, null)[0].defaultKey, "shipment");
});

test("someone else's cards are not on your list", () => {
  assert.deepEqual(collectTasks([card({ nextOwnerId: ABEL, nextStep: "Pay deposit" })], [], LI, null), []);
  assert.deepEqual(collectTasks([card({ nextOwnerId: null, nextStep: "Pay deposit" })], [], LI, null), []);
});

test("checklist items ride on their card and drop when the card left the board", () => {
  const items = [
    { id: 7, cardId: 10, text: "Send carton marks", assignedBy: ABEL, assignedAt: "2026-10-21T03:00:00Z" },
    { id: 8, cardId: 99, text: "On a shipped order's supplier card", assignedBy: ABEL, assignedAt: "2026-10-21T03:00:00Z" },
  ];
  const tasks = collectTasks([card({ nextOwnerId: ABEL })], items, LI, "2026-10-21T01:00:00Z");
  assert.deepEqual(tasks.map((t) => [t.key, t.source, t.supplierName, t.isNew]), [["check:7", "check", "义乌天使化妆品包装", true]]);
});

test("new first, then overdue, today, the coming days, undated last", () => {
  const cards = [
    card({ id: 1, nextStep: "undated" }),
    card({ id: 2, nextStep: "later", nextDue: "2026-10-30" }),
    card({ id: 3, nextStep: "overdue", nextDue: "2026-10-19" }),
    card({ id: 4, nextStep: "today", nextDue: "2026-10-21" }),
    card({ id: 5, nextStep: "new older", nextAssignedBy: ABEL, nextAssignedAt: "2026-10-21T01:00:00Z" }),
    card({ id: 6, nextStep: "new latest", nextAssignedBy: ABEL, nextAssignedAt: "2026-10-21T05:00:00Z", nextDue: "2026-11-02" }),
  ];
  const order = sortTasks(collectTasks(cards, [], LI, null), "2026-10-21").map((t) => t.text);
  assert.deepEqual(order, ["new latest", "new older", "overdue", "today", "later", "undated"]);
});

test("the bell counts what is new or overdue, once each", () => {
  const cards = [
    card({ id: 1, nextStep: "overdue and new", nextDue: "2026-10-01", nextAssignedBy: ABEL, nextAssignedAt: "2026-10-21T05:00:00Z" }),
    card({ id: 2, nextStep: "overdue", nextDue: "2026-10-20" }),
    card({ id: 3, nextStep: "due today", nextDue: "2026-10-21" }),
    card({ id: 4, nextStep: "quiet" }),
  ];
  assert.equal(bellCount(collectTasks(cards, [], LI, null), "2026-10-21"), 2);
});
