import test from "node:test";
import assert from "node:assert/strict";
import { calculateConversion } from "./conversion";
import { computeOperatingCash, type OperatingCashInput } from "./operating-cash";

test("converted settlement calculates the effective rate and implied cost from both amounts", () => {
  const result = calculateConversion({
    sourceAmount: 10000,
    sourceCurrency: "USD",
    settlementAmount: 71200,
    settlementCurrency: "CNY",
    rates: { USD: 1, CNY: 0.1 },
  });
  assert.equal(result.effectiveRate, 7.12);
  assert.equal(result.expectedSettlement, 100000);
  assert.equal(result.conversionCost, 28800);
});

test("cash book uses only the CNY settlement for a converted client payment", () => {
  const input: OperatingCashInput = {
    accounts: [{ id: 1, label: "Tailong RMB", currency: "CNY", openingBalance: 0, openingDate: "2026-01-01", trackBalance: true }],
    payments: [{
      direction: "in",
      amount: 10000,
      currency: "USD",
      account: "",
      paidOn: "2026-01-10",
      ratesSnapshot: '{"USD":1,"CNY":0.1}',
      settlementAmount: 71200,
      settlementCurrency: "CNY",
      settlementAccountId: 1,
    }],
    orderExpenses: [],
    operatingExpenses: [],
    transactions: [],
    balanceChecks: [{ accountId: 1, amount: 71200, checkedOn: "2026-01-31" }],
  };
  const view = computeOperatingCash(input, "2026-01-31", { USD: 1, CNY: 0.1 });
  assert.equal(view.accounts[0].bookBalance, 71200);
  assert.equal(view.accounts[0].actualBalance, 71200);
  assert.equal(view.accounts[0].difference, 0);
  assert.deepEqual(view.unassigned, []);
});
