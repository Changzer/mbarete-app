import test from "node:test";
import assert from "node:assert/strict";
import { computeOperatingCash, isDuplicateBankEntry, isTailongAccount, type OperatingCashInput } from "./operating-cash";

const accounts: OperatingCashInput["accounts"] = [
  { id: 1, label: "Tailong RMB", currency: "CNY", openingBalance: 100000, openingDate: "2026-01-01", trackBalance: true },
  { id: 2, label: "Tailong USD", currency: "USD", openingBalance: 1000, openingDate: "2026-01-01", trackBalance: true },
  { id: 99, label: "Untracked savings", currency: "CNY", openingBalance: 0, openingDate: "", trackBalance: false },
];

const input: OperatingCashInput = {
  accounts,
  payments: [
    { id: 1, orderId: 101, direction: "in", amount: 50000, currency: "CNY", account: "CNY", paidOn: "2026-01-10", ratesSnapshot: "", cashAccountId: 1 },
    { id: 2, orderId: 101, direction: "out", amount: 30000, currency: "CNY", account: "CNY", paidOn: "2026-01-11", ratesSnapshot: "", cashAccountId: 1 },
    { id: 3, orderId: 102, direction: "in", amount: 1000, currency: "USD", account: "USD", paidOn: "2026-01-12", ratesSnapshot: "", cashAccountId: 2 },
    { id: 4, orderId: 101, direction: "in", amount: 999, currency: "CNY", account: "CNY", paidOn: "2025-12-31", ratesSnapshot: "", cashAccountId: 1 },
  ],
  orderExpenses: [
    { id: 1, orderId: 101, category: "freight", amount: 2000, currency: "CNY", spentOn: "2026-01-13", ratesSnapshot: "", accountId: 1 },
    { id: 2, orderId: 101, category: "other", amount: 50, currency: "GBP", spentOn: "2026-01-14", ratesSnapshot: "" },
  ],
  operatingExpenses: [
    { id: 1, category: "rent", accountId: 1, amount: 5000, currency: "CNY", spentOn: "2026-01-15", vendor: "Landlord", note: "", receiptPath: "" },
  ],
  transactions: [
    { id: 1, kind: "other_income", direction: "in", amount: 1000, currency: "CNY", transactedOn: "2026-01-16", accountId: 1, destinationAccountId: null },
    { id: 2, kind: "transfer", direction: "out", amount: 10000, currency: "CNY", transactedOn: "2026-01-17", accountId: 1, destinationAccountId: 99 },
  ],
  balanceChecks: [{ accountId: 1, amount: 103500, checkedOn: "2026-01-31" }],
};

test("book cash includes only explicitly assigned order activity, overhead and bank movements", () => {
  const view = computeOperatingCash(input, "2026-01-31", { CNY: 0.14, USD: 1 });
  const cny = view.accounts.find((account) => account.id === 1)!;
  const usd = view.accounts.find((account) => account.id === 2)!;
  assert.equal(cny.bookBalance, 104000);
  assert.equal(cny.bookAtCheck, 104000);
  assert.equal(cny.actualBalance, 103500);
  assert.equal(cny.difference, -500);
  assert.equal(usd.bookBalance, 2000);
  assert.deepEqual(view.unassigned, [{ currency: "GBP", amount: -50 }]);
  assert.equal(view.unassignedExpenses[0].id, 2);
});

test("a matching currency without a confirmed account never changes Tailong cash", () => {
  const view = computeOperatingCash({
    ...input,
    payments: [
      { id: 5, orderId: 101, direction: "in", amount: 50000, currency: "CNY", account: "CNY", paidOn: "2026-01-10", ratesSnapshot: "" },
      { id: 6, orderId: 102, direction: "in", amount: 8000, currency: "USD", account: "USD", paidOn: "2026-01-12", ratesSnapshot: "", channel: "xtransfer" },
    ],
    orderExpenses: [{ id: 3, orderId: 101, amount: 2000, currency: "CNY", spentOn: "2026-01-13", ratesSnapshot: "" }],
    operatingExpenses: [],
    transactions: [],
    balanceChecks: [],
  }, "2026-01-31", { CNY: 0.14, USD: 1 });
  assert.equal(view.accounts.find((account) => account.id === 1)!.bookBalance, 100000);
  assert.equal(view.accounts.find((account) => account.id === 2)!.bookBalance, 1000);
  assert.equal(view.unassignedPayments.length, 2);
  assert.equal(view.unassignedExpenses.length, 1);
  assert.equal(view.entries.length, 0);
});

test("untracked accounts and missing balance checks never invent actual cash", () => {
  const view = computeOperatingCash(input, "2026-01-31", { CNY: 0.14, USD: 1 });
  assert.equal(view.accounts.length, 2);
  assert.equal(view.accounts.some((account) => account.id === 99), false);
  assert.equal(view.accounts.find((account) => account.id === 2)!.actualBalance, null);
  assert.equal(view.accounts.find((account) => account.id === 2)!.difference, null);
});

test("XTransfer accounts stay out of cash tracking even when incorrectly enabled", () => {
  const withXTransfer = {
    ...input,
    accounts: [
      ...input.accounts,
      { id: 3, label: "XTransfer-HK", currency: "USD", openingBalance: 500, openingDate: "2026-01-01", trackBalance: true },
    ],
  };
  const view = computeOperatingCash(withXTransfer, "2026-01-31", { CNY: 0.14, USD: 1 });
  assert.equal(view.accounts.some((account) => account.id === 3), false);
  assert.equal(isTailongAccount({ label: "XTransfer-HK" }), false);
  assert.equal(isTailongAccount({ label: "Tailong RMB" }), true);
  assert.equal(isTailongAccount({ label: "Tailong USD" }), true);
});

test("duplicate detection uses a bank reference, counterparty, or the same statement row", () => {
  const entries = computeOperatingCash(input, "2026-01-31", { CNY: 0.14, USD: 1 }).entries;
  const candidate = entries.find((entry) => entry.sourceId === 1 && entry.source === "order_payment")!;
  assert.equal(isDuplicateBankEntry(entries, { ...candidate, reference: "", counterparty: "different" }), false);
  assert.equal(isDuplicateBankEntry(entries, { ...candidate, statementDocumentId: 10, statementRow: "1" }), false);
  assert.equal(isDuplicateBankEntry(entries, { ...candidate, reference: "BANK-1" }), false);
  assert.equal(isDuplicateBankEntry(entries, { ...candidate, statementDocumentId: 10, statementRow: "1", reference: "BANK-1" }), false);
  const withReference = [{ ...candidate, reference: "BANK-1" }];
  assert.equal(isDuplicateBankEntry(withReference, { ...candidate, reference: "BANK-1" }), true);
  const withStatement = [{ ...candidate, statementDocumentId: 10, statementRow: "1" }];
  assert.equal(isDuplicateBankEntry(withStatement, { ...candidate, statementDocumentId: 10, statementRow: "1" }), true);
  const withCounterparty = [{ ...candidate, counterparty: "QA Client" }];
  assert.equal(isDuplicateBankEntry(withCounterparty, { ...candidate, counterparty: "QA Client" }), true);
});
