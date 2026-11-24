import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { intentForExtraction, sanitizeFinanceExtraction } from "./finance-intake";

const raw = (overrides = {}) => ({
  documentType: "supplier_payment" as const,
  amount: 12500,
  currency: "RMB",
  date: "2026-11-23",
  counterparty: "Angel Packing",
  reference: "XT-884912",
  category: "other",
  confidence: "high" as const,
  reason: "Clear receipt",
  ...overrides,
});

test("finance intake sanitizes legacy currency and keeps explicit order-scoped intent", () => {
  const extraction = sanitizeFinanceExtraction(raw());
  assert.equal(extraction.currency, "CNY");
  assert.equal(extraction.documentType, "supplier_payment");
  assert.equal(intentForExtraction("auto", extraction.documentType), "payment_out");
  assert.equal(intentForExtraction("payment_in", extraction.documentType), "payment_in");
});

test("finance intake lowers ambiguous documents and invalid fields instead of guessing", () => {
  const extraction = sanitizeFinanceExtraction(raw({
    amount: -10,
    date: "not-a-date",
    category: "unknown",
    confidence: "low",
  }));
  assert.equal(extraction.documentType, "unknown");
  assert.equal(extraction.amount, null);
  assert.equal(extraction.date, "");
  assert.equal(extraction.category, "");
  assert.equal(intentForExtraction("auto", extraction.documentType), "attach");
});

test("finance intake translations stay complete in English and Chinese", () => {
  const en = JSON.parse(readFileSync("messages/en.json", "utf8")).financeIntake;
  const zh = JSON.parse(readFileSync("messages/zh.json", "utf8")).financeIntake;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});
