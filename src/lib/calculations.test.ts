import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCbm,
  computeOrderTotals,
  convert,
  isBelowMoq,
  lineCbm,
  lineWeightKg,
  UnknownCurrencyError,
} from "./calculations";

const RATES = { USD: 1, CNY: 0.14 };

/**
 * Money is held as floats, so 100 * 0.14 lands on 14.000000000000002.
 * Displayed values are rounded to 2dp, so compare to well within a cent.
 */
function closeTo(actual: number, expected: number, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    msg ?? `expected ${actual} to be ~${expected}`,
  );
}

const chicken = {
  price: 10,       // CNY
  currency: "CNY",
  moq: 10,
  qtyPerBox: 1,
  weightKg: 0.3,
  cbm: 0.0002,
};

test("cbm converts cm^3 to m^3", () => {
  assert.equal(computeCbm(100, 100, 100), 1);
  assert.equal(computeCbm(4, 2, 30), 0.00024);
});

test("moq only trips for a non-zero quantity below the minimum", () => {
  assert.equal(isBelowMoq(0, 10), false);
  assert.equal(isBelowMoq(9, 10), true);
  assert.equal(isBelowMoq(10, 10), false);
});

test("convert applies the rate, not a 1:1 passthrough", () => {
  closeTo(convert(100, "CNY", "USD", RATES), 14);
  closeTo(convert(14, "USD", "CNY", RATES), 100);
  assert.equal(convert(100, "CNY", "CNY", RATES), 100);
});

test("an unconfigured currency throws instead of silently passing through", () => {
  // The real defect: product priced in "RMB" while the table only knew "CNY"
  // reported 100 RMB as 100 USD.
  assert.throws(
    () => convert(100, "RMB", "USD", RATES),
    (err: unknown) => err instanceof UnknownCurrencyError && err.currency === "RMB",
  );
});

test("line cbm and weight scale by boxes, not units", () => {
  const boxed = { ...chicken, qtyPerBox: 50, cbm: 0.3, weightKg: 12 };
  assert.equal(lineCbm(boxed, 500), 3);
  assert.equal(lineWeightKg(boxed, 500), 120);
});

test("totals report goods, commission and grand total in every target currency", () => {
  const totals = computeOrderTotals(
    [{ product: chicken, quantity: 10 }],
    ["USD", "CNY"],
    RATES,
    10, // 10% commission
  );

  assert.equal(totals.goods.CNY, 100);
  closeTo(totals.goods.USD, 14);
  assert.equal(totals.commission.CNY, 10);
  closeTo(totals.commission.USD, 1.4);
  assert.equal(totals.grandTotal.CNY, 110);
  closeTo(totals.grandTotal.USD, 15.4);
  assert.equal(totals.hasMoqViolation, false);
  assert.deepEqual(totals.missingRates, []);
});

test("zero commission leaves the goods total untouched", () => {
  const totals = computeOrderTotals(
    [{ product: chicken, quantity: 10 }],
    ["CNY"],
    RATES,
  );
  assert.equal(totals.commission.CNY, 0);
  assert.equal(totals.grandTotal.CNY, totals.goods.CNY);
});

test("mixed-currency lines are each converted before summing", () => {
  const usdProduct = { ...chicken, price: 5, currency: "USD" };
  const totals = computeOrderTotals(
    [
      { product: chicken, quantity: 10 },   // 100 CNY = 14 USD
      { product: usdProduct, quantity: 2 }, // 10 USD
    ],
    ["USD"],
    RATES,
  );
  closeTo(totals.goods.USD, 24);
});

test("a missing rate is reported rather than silently mispriced", () => {
  const rmbProduct = { ...chicken, currency: "RMB" };
  const totals = computeOrderTotals(
    [{ product: rmbProduct, quantity: 10 }],
    ["USD"],
    RATES,
  );
  assert.deepEqual(totals.missingRates, ["RMB"]);
  assert.equal(totals.goods.USD, 0, "unpriceable lines must not inflate the total");
});

test("below-MOQ quantities are flagged", () => {
  const totals = computeOrderTotals(
    [{ product: chicken, quantity: 5 }],
    ["CNY"],
    RATES,
  );
  assert.equal(totals.hasMoqViolation, true);
});
