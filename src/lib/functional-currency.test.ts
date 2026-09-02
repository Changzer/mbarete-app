import test from "node:test";
import assert from "node:assert/strict";
import { resolveFunctionalCurrency, pickReportCurrency } from "./functional-currency";

const RATES = { USD: 1, CNY: 0.14, BRL: 0.2 };

test("functional currency: the setting wins when the rate table knows it", () => {
  assert.equal(resolveFunctionalCurrency("brl", RATES), "BRL");
  assert.equal(resolveFunctionalCurrency(" CNY ", RATES), "CNY");
});

test("functional currency: unset or unknown falls back to RMB, then USD", () => {
  assert.equal(resolveFunctionalCurrency("", RATES), "CNY");
  assert.equal(resolveFunctionalCurrency("GBP", RATES), "CNY");
  assert.equal(resolveFunctionalCurrency("", { USD: 1, RMB: 0.14 }), "RMB");
  assert.equal(resolveFunctionalCurrency(undefined, { USD: 1 }), "USD");
});

test("report currency: the query string picks, a bad pick keeps the fallback", () => {
  assert.equal(pickReportCurrency("brl", "CNY", RATES), "BRL");
  assert.equal(pickReportCurrency("XXX", "CNY", RATES), "CNY");
  assert.equal(pickReportCurrency(undefined, "CNY", RATES), "CNY");
});
