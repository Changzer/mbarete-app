import test from "node:test";
import assert from "node:assert/strict";
import { computeOperatingCash, type OperatingCashInput } from "./operating-cash";

const accounts: OperatingCashInput["accounts"] = [
  { id: 1, label: "Operating CNY", currency: "CNY", openingBalance: 100000, openingDate: "2026-01-01", trackBalance: true },
  { id: 2, label: "Operating USD", currency: "USD", openingBalance: 1000, openingDate: "2026-01-01", trackBalance: true },
  { id: 99, label: "Untracked savings", currency: "CNY", openingBalance: 0, openingDate: "", trackBalance: false },
];

const input: OperatingCashInput = {
  accounts,
  payments: [
    { direction: "in", amount: 50000, currency: "CNY", account: "CNY", paidOn: "2026-01-10", ratesSnapshot: "" },
    { direction: "out", amount: 30000, currency: "CNY", account: "CNY", paidOn: "2026-01-11", ratesSnapshot: "" },
    { direction: "in", amount: 1000, currency: "CNY", account: "USD", paidOn: "2026-01-12", ratesSnapshot: '{"CNY":0.1,"USD":1}' },
    { direction: "in", amount: 999, currency: "CNY", account: "CNY", paidOn: "2025-12-31", ratesSnapshot: "" },
  ],
  orderExpenses: [
    { amount: 2000, currency: "CNY", spentOn: "2026-01-13", ratesSnapshot: "" },
    { amount: 50, currency: "GBP", spentOn: "2026-01-14", ratesSnapshot: "" },
  ],
  operatingExpenses: [
    { id: 1, category: "rent", accountId: 1, amount: 5000, currency: "CNY", spentOn: "2026-01-15", vendor: "Landlord", note: "", receiptPath: "" },
  ],
  transactions: [
    { kind: "other_income", direction: "in", amount: 1000, currency: "CNY", transactedOn: "2026-01-16", accountId: 1, destinationAccountId: null },
    { kind: "transfer", direction: "out", amount: 10000, currency: "CNY", transactedOn: "2026-01-17", accountId: 1, destinationAccountId: 99 },
  ],
  balanceChecks: [{ accountId: 1, amount: 103500, checkedOn: "2026-01-31" }],
};

test("book cash includes order activity, overhead, other income and transfers before reconciling to the bank", () => {
  const view = computeOperatingCash(input, "2026-01-31", { CNY: 0.14, USD: 1 });
  const cny = view.accounts.find((account) => account.id === 1)!;
  const usd = view.accounts.find((account) => account.id === 2)!;
  assert.equal(cny.bookBalance, 104000);
  assert.equal(cny.bookAtCheck, 104000);
  assert.equal(cny.actualBalance, 103500);
  assert.equal(cny.difference, -500);
  assert.equal(usd.bookBalance, 1100, "the payment's own CNY-to-USD rate is used");
  assert.deepEqual(view.unassigned, [{ currency: "GBP", amount: -50 }]);
});

test("untracked accounts and missing balance checks never invent actual cash", () => {
  const view = computeOperatingCash(input, "2026-01-31", { CNY: 0.14, USD: 1 });
  assert.equal(view.accounts.length, 2);
  assert.equal(view.accounts.some((account) => account.id === 99), false);
  assert.equal(view.accounts.find((account) => account.id === 2)!.actualBalance, null);
  assert.equal(view.accounts.find((account) => account.id === 2)!.difference, null);
});
