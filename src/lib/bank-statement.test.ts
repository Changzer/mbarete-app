import test from "node:test";
import assert from "node:assert/strict";
import { bankStatementDirection, sanitizeBankStatement } from "./bank-statement";

const context = {
  accountLabel: "Tailong RMB",
  currency: "CNY",
  orders: [{
    id: 7,
    orderNumber: "ORD-QA-7",
    clientName: "QA Client",
    status: "confirmed",
    currency: "USD",
    suppliers: [{ id: 9, name: "Angel Packing" }],
  }],
};

test("statement sanitization links only exact order and supplier references", () => {
  const result = sanitizeBankStatement({
    closingBalance: 7500,
    closingDate: "2026-11-28",
    transactions: [{
      date: "2026-11-23",
      description: "Supplier transfer",
      counterparty: "Angel Packing",
      reference: "BANK-1",
      direction: "out",
      amount: 12500,
      kind: "supplier_payment",
      orderNumber: "ord-qa-7",
      supplierName: "Angel Packing",
      expenseCategory: null,
      destinationAmount: null,
      confidence: "high",
      reason: "Exact reference",
    }, {
      date: "not-a-date",
      description: "Unidentified credit",
      counterparty: null,
      reference: null,
      direction: "unknown",
      amount: null,
      kind: "unknown",
      orderNumber: "ORD-QA-7",
      supplierName: null,
      expenseCategory: null,
      destinationAmount: null,
      confidence: "low",
      reason: "Unreadable",
    }],
  }, context);
  assert.equal(result.transactions[0].orderId, 7);
  assert.equal(result.transactions[0].supplierId, 9);
  assert.equal(result.transactions[0].direction, "out");
  assert.equal(result.transactions[1].date, "");
  assert.equal(result.transactions[1].amount, null);
  assert.equal(result.closingBalance, 7500);
});

test("statement kind determines the account direction, never the currency label", () => {
  assert.equal(bankStatementDirection("client_payment"), "in");
  assert.equal(bankStatementDirection("other_income"), "in");
  assert.equal(bankStatementDirection("supplier_payment"), "out");
  assert.equal(bankStatementDirection("exchange"), "out");
  assert.equal(bankStatementDirection("unknown"), "");
});
