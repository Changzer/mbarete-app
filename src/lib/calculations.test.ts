import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCbm,
  computeOrderTotals,
  convert,
  isBelowMoq,
  lineCbm,
  lineWeightKg,
  formatCbm,
  cartonCount,
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

test("CBM and weight scale linearly with quantity", () => {
  // The reported doubt: does the total multiply by quantity, or show one unit?
  const unit = { ...chicken, qtyPerBox: 1, cbm: computeCbm(4, 2, 30), weightKg: 0.3 };
  for (const qty of [1, 10, 100, 1000]) {
    const totals = computeOrderTotals([{ product: unit, quantity: qty }], ["CNY"], RATES);
    closeTo(totals.totalCbm, qty * 0.00024, `CBM at qty ${qty}`);
    closeTo(totals.totalWeightKg, qty * 0.3, `weight at qty ${qty}`);
  }
});

test("dimensions describe the carton, so quantity is divided by qtyPerBox", () => {
  // 50 pieces per 40x30x25cm carton: 500 pieces is 10 cartons, not 500.
  const boxed = { ...chicken, qtyPerBox: 50, cbm: computeCbm(40, 30, 25), weightKg: 12 };
  assert.equal(cartonCount(boxed, 500), 10);
  closeTo(lineCbm(boxed, 500), 0.3);
  closeTo(lineWeightKg(boxed, 500), 120);

  const totals = computeOrderTotals([{ product: boxed, quantity: 500 }], ["CNY"], RATES);
  closeTo(totals.totalCbm, 0.3);
  assert.equal(totals.totalCartons, 10);
});

test("carton totals add up across several products", () => {
  const a = { ...chicken, qtyPerBox: 50, cbm: computeCbm(40, 30, 25), weightKg: 12 };
  const b = { ...chicken, qtyPerBox: 10, cbm: computeCbm(20, 20, 20), weightKg: 2 };
  const totals = computeOrderTotals(
    [
      { product: a, quantity: 500 }, // 10 cartons x 0.03 = 0.3
      { product: b, quantity: 100 }, // 10 cartons x 0.008 = 0.08
    ],
    ["CNY"],
    RATES,
  );
  assert.equal(totals.totalCartons, 20);
  closeTo(totals.totalCbm, 0.38);
  closeTo(totals.totalWeightKg, 10 * 12 + 10 * 2);
});

test("small CBM values keep enough precision to reconcile", () => {
  // 0.00024 must not render as "0.0002", which cannot be multiplied back up.
  assert.equal(formatCbm(0.00024), "0.000240");
  assert.equal(formatCbm(0.0024), "0.002400");
  assert.equal(formatCbm(0.3), "0.3000");
  assert.equal(formatCbm(0), "0.0000");
});
