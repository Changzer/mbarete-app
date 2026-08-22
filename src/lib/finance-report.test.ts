import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinanceReport, type FinanceOrderInput } from "./finance-report";

const RATES = { USD: 1, CNY: 0.14 };
const closeTo = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

const order = (over: Partial<FinanceOrderInput>): FinanceOrderInput => ({
  id: 1,
  orderNumber: "ORD-1",
  clientName: "Acme",
  status: "confirmed",
  createdAt: "2026-03-05T10:00:00.000Z",
  quoteCurrency: "USD",
  expectedRevenue: 1000,
  expectedCost: 800,
  payments: [],
  expenses: [],
  ...over,
});

test("report: one settled order in one month", () => {
  const r = computeFinanceReport(
    [
      order({
        payments: [
          { direction: "in", amount: 1000, currency: "USD", paidOn: "2026-03-10" },
          { direction: "out", amount: 800, currency: "USD", paidOn: "2026-03-12" },
        ],
        expenses: [{ category: "freight", amount: 50, currency: "USD", spentOn: "2026-03-15" }],
      }),
    ],
    "USD",
    RATES,
  );
  closeTo(r.totals.expectedRevenue, 1000);
  closeTo(r.totals.expectedNet, 150);
  closeTo(r.totals.receivables, 0);
  closeTo(r.totals.payables, 0);
  closeTo(r.totals.cashIn, 1000);
  closeTo(r.totals.cashOut, 850);
  closeTo(r.totals.netCash, 150);
  assert.equal(r.months.length, 1);
  assert.equal(r.months[0].month, "2026-03");
  closeTo(r.months[0].netCash, 150);
});

test("report: quote currencies aggregate through the report currency", () => {
  // A 7140 CNY order is 999.60 USD of revenue at 0.14.
  const r = computeFinanceReport(
    [
      order({ quoteCurrency: "USD", expectedRevenue: 1000, expectedCost: 800 }),
      order({
        id: 2,
        orderNumber: "ORD-2",
        clientName: "Beta",
        quoteCurrency: "CNY",
        expectedRevenue: 7140,
        expectedCost: 5000,
      }),
    ],
    "USD",
    RATES,
  );
  closeTo(r.totals.expectedRevenue, 1000 + 999.6, 1e-6);
  closeTo(r.totals.expectedCost, 800 + 700);
  // Nothing paid: everything outstanding.
  closeTo(r.totals.receivables, 1999.6, 1e-6);
  closeTo(r.totals.payables, 1500);
  assert.equal(r.receivablesList.length, 2);
  // Biggest first.
  assert.equal(r.receivablesList[0].orderNumber, "ORD-1");
});

test("report: cancelled orders keep their cash but lose their expectations", () => {
  const r = computeFinanceReport(
    [
      order({
        status: "cancelled",
        payments: [{ direction: "in", amount: 300, currency: "USD", paidOn: "2026-04-01" }],
        expenses: [{ category: "bank_fees", amount: 20, currency: "USD", spentOn: "2026-04-02" }],
      }),
    ],
    "USD",
    RATES,
  );
  closeTo(r.totals.expectedRevenue, 0);
  closeTo(r.totals.receivables, 0);
  assert.equal(r.clients.length, 0);
  // The deposit and the fee really happened.
  closeTo(r.totals.cashIn, 300);
  closeTo(r.totals.cashOut, 20);
  closeTo(r.expensesByCategory[0].amount, 20);
});

test("report: months are bucketed by when money moved, not when typed", () => {
  const r = computeFinanceReport(
    [
      order({
        createdAt: "2026-03-05T10:00:00.000Z",
        payments: [
          { direction: "in", amount: 300, currency: "USD", paidOn: "2026-03-20" },
          { direction: "in", amount: 700, currency: "USD", paidOn: "2026-05-02" },
        ],
      }),
    ],
    "USD",
    RATES,
  );
  const march = r.months.find((m) => m.month === "2026-03")!;
  const may = r.months.find((m) => m.month === "2026-05")!;
  closeTo(march.cashIn, 300);
  closeTo(may.cashIn, 700);
  // The order itself counts in its creation month only.
  assert.equal(march.orders, 1);
  assert.equal(may.orders, 0);
  // Newest month first for reading.
  assert.equal(r.months[0].month, "2026-05");
});

test("report: expense categories rank by spend with shares of the total", () => {
  const r = computeFinanceReport(
    [
      order({
        expenses: [
          { category: "freight", amount: 300, currency: "USD", spentOn: "2026-03-01" },
          { category: "customs", amount: 100, currency: "USD", spentOn: "2026-03-02" },
          { category: "freight", amount: 100, currency: "USD", spentOn: "2026-03-03" },
        ],
      }),
    ],
    "USD",
    RATES,
  );
  assert.equal(r.expensesByCategory[0].category, "freight");
  closeTo(r.expensesByCategory[0].amount, 400);
  closeTo(r.expensesByCategory[0].pct, 80);
  closeTo(r.expensesByCategory[1].pct, 20);
});

test("report: per-client profitability sums that client's orders", () => {
  const r = computeFinanceReport(
    [
      order({ clientName: "Acme", expectedRevenue: 1000, expectedCost: 800 }),
      order({ id: 2, orderNumber: "ORD-2", clientName: "Acme", expectedRevenue: 500, expectedCost: 300 }),
      order({ id: 3, orderNumber: "ORD-3", clientName: "Beta", expectedRevenue: 2000, expectedCost: 1900 }),
    ],
    "USD",
    RATES,
  );
  // Sorted by revenue: Beta 2000 first.
  assert.equal(r.clients[0].clientName, "Beta");
  closeTo(r.clients[0].marginPct!, 5);
  const acme = r.clients[1];
  assert.equal(acme.orders, 2);
  closeTo(acme.expectedRevenue, 1500);
  closeTo(acme.expectedNet, 400);
  closeTo(acme.marginPct!, (400 / 1500) * 100);
});

test("report: an overpaid order is not a negative receivable", () => {
  const r = computeFinanceReport(
    [
      order({
        expectedRevenue: 1000,
        payments: [{ direction: "in", amount: 1200, currency: "USD", paidOn: "2026-03-01" }],
      }),
    ],
    "USD",
    RATES,
  );
  closeTo(r.totals.receivables, 0);
  assert.equal(r.receivablesList.length, 0);
});

test("report: unknown currencies are flagged and excluded, not zeroed silently", () => {
  const r = computeFinanceReport(
    [
      order({
        payments: [{ direction: "in", amount: 500, currency: "GBP", paidOn: "2026-03-01" }],
      }),
    ],
    "USD",
    RATES,
  );
  assert.deepEqual(r.missingRates, ["GBP"]);
  closeTo(r.totals.cashIn, 0);
});

test("report: XTransfer settlements split by where the money landed", () => {
  // One client paid 1000 USD that stayed USD; another settlement arrived
  // already converted: 7100 RMB into the RMB account, on a USD-quoted order.
  const r = computeFinanceReport(
    [
      order({
        payments: [
          { direction: "in", amount: 1000, currency: "USD", paidOn: "2026-03-01", account: "USD" },
          { direction: "in", amount: 7100, currency: "RMB", paidOn: "2026-03-05", account: "RMB" },
        ],
      }),
    ],
    "USD",
    { USD: 1, CNY: 0.14, RMB: 0.14 },
  );
  assert.equal(r.receivedByAccount.length, 2);
  // 7100 RMB = 994 USD > 1000 USD? No: 994 < 1000 — USD bucket first.
  assert.equal(r.receivedByAccount[0].key, "USD");
  assert.deepEqual(r.receivedByAccount[0].native, { USD: 1000 });
  const rmb = r.receivedByAccount[1];
  assert.equal(rmb.key, "RMB");
  assert.deepEqual(rmb.native, { RMB: 7100 });
  closeTo(rmb.value, 994, 1e-9);
  closeTo(rmb.pct + r.receivedByAccount[0].pct, 100, 1e-9);
});

test("report: untagged payments land under their own currency", () => {
  const r = computeFinanceReport(
    [
      order({
        payments: [
          { direction: "in", amount: 500, currency: "BRL", paidOn: "2026-03-01" },
        ],
      }),
    ],
    "USD",
    { USD: 1, CNY: 0.14, BRL: 0.18 },
  );
  assert.equal(r.receivedByAccount[0].key, "BRL");
  closeTo(r.receivedByAccount[0].value, 90, 1e-9);
});

test("report: a converted settlement counts once, in its landed form only", () => {
  // The RMB that arrived is the same money the client sent as USD — it must
  // not appear under both.
  const r = computeFinanceReport(
    [
      order({
        payments: [
          { direction: "in", amount: 7100, currency: "RMB", paidOn: "2026-03-05", account: "RMB" },
        ],
      }),
    ],
    "USD",
    { USD: 1, RMB: 0.14 },
  );
  assert.equal(r.receivedByAccount.length, 1);
  closeTo(r.totals.cashIn, 994, 1e-9);
});

test("report: a draft is a quote — pipeline only, never expected money or a receivable", () => {
  const r = computeFinanceReport(
    [
      order({ id: 1, status: "draft", expectedRevenue: 5000, expectedCost: 4000 }),
      order({ id: 2, orderNumber: "ORD-2", status: "confirmed" }),
    ],
    "USD",
    RATES,
  );
  // Only the confirmed order carries expectations and open balances.
  closeTo(r.totals.expectedRevenue, 1000);
  closeTo(r.totals.receivables, 1000);
  assert.ok(r.receivablesList.every((x) => x.orderId === 2));
  // The draft shows up as quoted pipeline instead.
  closeTo(r.totals.quotedRevenue, 5000);
  assert.equal(r.totals.quotedOrders, 1);
});

test("report: a deposit taken on a draft is real cash, still no receivable", () => {
  const r = computeFinanceReport(
    [
      order({
        status: "draft",
        payments: [{ direction: "in", amount: 300, currency: "USD", paidOn: "2026-03-10" }],
      }),
    ],
    "USD",
    RATES,
  );
  closeTo(r.totals.cashIn, 300);
  closeTo(r.totals.expectedRevenue, 0);
  closeTo(r.totals.receivables, 0);
  closeTo(r.totals.quotedRevenue, 1000);
});

test("report: shipped orders count as expected money just like confirmed", () => {
  const r = computeFinanceReport([order({ status: "shipped" })], "USD", RATES);
  closeTo(r.totals.expectedRevenue, 1000);
  closeTo(r.totals.quotedRevenue, 0);
});
