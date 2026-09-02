import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCbm,
  computeOrderTotals,
  lineTotal,
  roundMoney,
  convert,
  isBelowMoq,
  lineCbm,
  lineWeightKg,
  formatCbm,
  cartonCount,
  fullCartons,
  isPartialCarton,
  suggestedQuantity,
  UnknownCurrencyError,
  computeSnapshotTotals,
  estimateCartonCbm,
  estimateCartonWeightKg,
  DEFAULT_PACKING_ALLOWANCE_PCT,
  formatWeightKg,
  missingCartonFigures,
  computeOrderFinance,
  computeOrderFinanceView,
  sellUnitPrice,
  deriveLineFigures,
} from "./calculations";
import type { SnapshotLine } from "./calculations";

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
});

test("CBM at order-total scale shows two decimals, never thousand-lookalikes", () => {
  // "6.0000" misreads as six thousand; a metre and up is two decimals.
  assert.equal(formatCbm(6), "6.00");
  assert.equal(formatCbm(1), "1.00");
  assert.equal(formatCbm(12.3456), "12.35");
  assert.equal(formatCbm(0), "0.00");
});

test("a part-filled carton is flagged and still ships as a whole carton", () => {
  const boxed = { ...chicken, qtyPerBox: 50, moq: 100 };
  assert.equal(isPartialCarton(boxed, 100), false); // exactly 2 cartons
  assert.equal(isPartialCarton(boxed, 75), true);   // 1.5 cartons
  assert.equal(cartonCount(boxed, 75), 1.5);
  assert.equal(fullCartons(boxed, 75), 2, "a partial carton still travels as one");
  assert.equal(isPartialCarton(boxed, 0), false, "an empty line is not a partial carton");
});

test("suggested quantity clears MOQ and fills whole cartons at once", () => {
  const boxed = { ...chicken, qtyPerBox: 50, moq: 120 };
  // below MOQ -> lift to MOQ, then round up to a whole carton (120 -> 150)
  assert.equal(suggestedQuantity(boxed, 10), 150);
  // above MOQ but a partial carton -> round up only (160 -> 200)
  assert.equal(suggestedQuantity(boxed, 160), 200);
  // already valid -> unchanged
  assert.equal(suggestedQuantity(boxed, 200), 200);
});

test("suggested quantity copes with a product sold loose", () => {
  const loose = { ...chicken, qtyPerBox: 1, moq: 10 };
  assert.equal(suggestedQuantity(loose, 3), 10);
  assert.equal(suggestedQuantity(loose, 17), 17);
  assert.equal(isPartialCarton(loose, 17), false);
});

test("a part-filled carton is quoted at full carton volume", () => {
  // 175 pcs at 50/carton ships as 4 cartons, so it occupies 4 x 0.03 m3 —
  // not 3.5. Under-counting this understates the freight quote.
  const boxed = { ...chicken, qtyPerBox: 50, cbm: 0.03, weightKg: 12, moq: 1 };
  assert.equal(fullCartons(boxed, 175), 4);
  closeTo(lineCbm(boxed, 175), 0.12);

  const totals = computeOrderTotals([{ product: boxed, quantity: 175 }], ["CNY"], RATES);
  assert.equal(totals.totalCartons, 4, "order total must agree with the line");
  closeTo(totals.totalCbm, 0.12);
  // weight stays proportional: a half-full carton is lighter
  closeTo(totals.totalWeightKg, 3.5 * 12);
});

test("exact carton quantities are unchanged by the whole-carton rule", () => {
  const boxed = { ...chicken, qtyPerBox: 50, cbm: 0.03, weightKg: 12, moq: 1 };
  closeTo(lineCbm(boxed, 200), 0.12);
  assert.equal(fullCartons(boxed, 200), 4);
  closeTo(lineWeightKg(boxed, 200), 48);
});

// --- computeSnapshotTotals -------------------------------------------------

const snapshotLine = (over: Partial<SnapshotLine> = {}): SnapshotLine => ({
  quantity: 10,
  unitPrice: 10,
  currency: "CNY",
  moq: 1,
  lineCbm: 0.0024,
  lineWeightKg: 3,
  cartons: 10,
  ...over,
});

test("snapshot totals sum stored cartons, not quantities", () => {
  // The reported defect: an order of 10 pcs at 1/carton plus 5 pcs at
  // 1280/carton reported 15 cartons — the two quantities added together —
  // because the saved lines were pushed through computeOrderTotals with a
  // synthetic qtyPerBox of 1, making every piece its own carton.
  const totals = computeSnapshotTotals(
    [
      snapshotLine({ quantity: 10, cartons: 10 }),
      snapshotLine({ quantity: 5, unitPrice: 1.7, cartons: 1, lineCbm: 0.0012, lineWeightKg: 0 }),
    ],
    ["CNY"],
    RATES,
  );
  assert.equal(totals.totalCartons, 11);
});

test("snapshot totals sum stored volume and weight as-is", () => {
  const totals = computeSnapshotTotals(
    [
      snapshotLine({ lineCbm: 0.0024, lineWeightKg: 3 }),
      snapshotLine({ lineCbm: 0.0012, lineWeightKg: 0.5 }),
    ],
    ["CNY"],
    RATES,
  );
  closeTo(totals.totalCbm, 0.0036);
  closeTo(totals.totalWeightKg, 3.5);
});

test("snapshot totals convert and apply commission", () => {
  const totals = computeSnapshotTotals(
    [snapshotLine({ quantity: 10, unitPrice: 10, currency: "CNY" })],
    ["CNY", "USD"],
    RATES,
    15,
  );
  closeTo(totals.goods.CNY, 100);
  closeTo(totals.goods.USD, 14);
  closeTo(totals.commission.CNY, 15);
  closeTo(totals.grandTotal.CNY, 115);
  closeTo(totals.grandTotal.USD, 16.1);
});

test("snapshot totals flag a currency with no rate instead of assuming 1:1", () => {
  // What the deployed app hit: products priced in RMB, a rate table holding
  // only USD and CNY, and every total rendering 0.00.
  const totals = computeSnapshotTotals(
    [snapshotLine({ currency: "RMB" })],
    ["CNY"],
    RATES,
  );
  assert.deepEqual(totals.missingRates, ["RMB"]);
  assert.equal(totals.goods.CNY, 0);
});

test("snapshot totals price RMB once a rate exists", () => {
  const totals = computeSnapshotTotals(
    [snapshotLine({ quantity: 10, unitPrice: 10, currency: "RMB" })],
    ["CNY", "USD"],
    { ...RATES, RMB: 0.14 },
  );
  assert.deepEqual(totals.missingRates, []);
  closeTo(totals.goods.CNY, 100);
  closeTo(totals.goods.USD, 14);
});

test("snapshot totals flag a line below its saved MOQ", () => {
  const totals = computeSnapshotTotals(
    [snapshotLine({ quantity: 5, moq: 50 })],
    ["CNY"],
    RATES,
  );
  assert.equal(totals.hasMoqViolation, true);
});

// --- estimating a carton from a single piece ---------------------------------

test("carton volume estimated from a piece scales with pieces per carton", () => {
  const piece = { lengthCm: 10, widthCm: 10, heightCm: 10 }; // 0.001 m^3
  // 24 pieces + 15% allowance
  closeTo(estimateCartonCbm(piece, 24, 15), 0.001 * 24 * 1.15);
  // Twice the pieces, twice the carton.
  closeTo(estimateCartonCbm(piece, 48, 15), estimateCartonCbm(piece, 24, 15) * 2);
});

test("a zero allowance estimates the bare goods volume", () => {
  const piece = { lengthCm: 10, widthCm: 10, heightCm: 10 };
  closeTo(estimateCartonCbm(piece, 24, 0), 0.024);
});

test("the estimate is never smaller than the goods it contains", () => {
  const piece = { lengthCm: 4, widthCm: 2, heightCm: 30 };
  const bare = computeCbm(4, 2, 30) * 50;
  assert.ok(estimateCartonCbm(piece, 50, DEFAULT_PACKING_ALLOWANCE_PCT) >= bare);
});

test("carton estimates are zero when pieces per carton is unset", () => {
  const piece = { lengthCm: 10, widthCm: 10, heightCm: 10 };
  assert.equal(estimateCartonCbm(piece, 0, 15), 0);
  assert.equal(estimateCartonWeightKg(2, 0, 15), 0);
});

test("carton weight estimated from a piece includes the allowance", () => {
  closeTo(estimateCartonWeightKg(0.3, 10, 15), 0.3 * 10 * 1.15);
  closeTo(estimateCartonWeightKg(0.3, 10, 0), 3);
});

test("an estimated carton feeds order totals like a measured one", () => {
  // A product registered from piece dimensions only: 10x10x10 cm, 24/carton.
  const piece = { lengthCm: 10, widthCm: 10, heightCm: 10 };
  const estimated = {
    price: 5,
    currency: "CNY",
    moq: 1,
    qtyPerBox: 24,
    weightKg: estimateCartonWeightKg(0.2, 24),
    cbm: estimateCartonCbm(piece, 24),
  };
  const totals = computeOrderTotals([{ product: estimated, quantity: 48 }], ["CNY"], RATES);
  assert.equal(totals.totalCartons, 2);
  closeTo(totals.totalCbm, estimated.cbm * 2);
  closeTo(totals.totalWeightKg, estimated.weightKg * 2);
});

test("weights display without floating-point noise", () => {
  // 0.2 x 24 x 1.15 lands on 5.5200000000000005 in binary floating point.
  assert.equal(formatWeightKg(estimateCartonWeightKg(0.2, 24, 15)), "5.52");
  // Hand-typed values are untouched.
  assert.equal(formatWeightKg(0.3), "0.3");
  assert.equal(formatWeightKg(5), "5");
  assert.equal(formatWeightKg(0), "0");
});

test("a product with no measurements is reported as missing them", () => {
  assert.equal(missingCartonFigures({ cbm: 0, weightKg: 0 }), true);
  // Half-entered counts as missing: either figure alone distorts a quote.
  assert.equal(missingCartonFigures({ cbm: 0.024, weightKg: 0 }), true);
  assert.equal(missingCartonFigures({ cbm: 0, weightKg: 5 }), true);
  assert.equal(missingCartonFigures({ cbm: 0.024, weightKg: 5 }), false);
});

// --- order finance -----------------------------------------------------------

test("order finance: a settled order nets the commission minus expenses", () => {
  // 5352 RMB of goods quoted to the client at +15% in USD: revenue 861.67,
  // cost 749.28. Client paid in full in USD, supplier paid in full in RMB.
  const fin = computeOrderFinance(
    {
      expectedRevenue: 861.67,
      expectedCost: 749.28,
      paymentsIn: [{ amount: 861.67, currency: "USD" }],
      paymentsOut: [{ amount: 5352, currency: "CNY" }],
      expenses: [
        { amount: 200, currency: "CNY" },   // 28 USD freight
        { amount: 15, currency: "USD" },    // bank fee
      ],
    },
    "USD",
    RATES,
  );
  closeTo(fin.received, 861.67);
  closeTo(fin.paidOut, 749.28);
  closeTo(fin.expensesTotal, 43);
  closeTo(fin.clientOutstanding, 0);
  closeTo(fin.supplierOutstanding, 0);
  closeTo(fin.netActual, 69.39);
  closeTo(fin.netExpected, 69.39);
  assert.ok(fin.marginPct !== null && Math.abs(fin.marginPct - 8.053) < 0.01);
});

test("order finance: mid-order, actual is negative and outstandings say why", () => {
  // 30% client deposit in, 100% supplier payment out, freight paid.
  const fin = computeOrderFinance(
    {
      expectedRevenue: 1000,
      expectedCost: 800,
      paymentsIn: [{ amount: 300, currency: "USD" }],
      paymentsOut: [{ amount: 800, currency: "USD" }],
      expenses: [{ amount: 50, currency: "USD" }],
    },
    "USD",
    RATES,
  );
  closeTo(fin.netActual, -550);          // cash out of pocket right now
  closeTo(fin.netExpected, 150);         // where it lands once settled
  closeTo(fin.clientOutstanding, 700);   // the balance still to collect
  closeTo(fin.supplierOutstanding, 0);
  // The identity that makes the numbers trustworthy:
  closeTo(fin.netActual + fin.clientOutstanding - fin.supplierOutstanding, fin.netExpected);
});

test("order finance: an unconvertible payment is flagged, not counted as zero silently", () => {
  const fin = computeOrderFinance(
    {
      expectedRevenue: 1000,
      expectedCost: 800,
      paymentsIn: [{ amount: 500, currency: "GBP" }],
      paymentsOut: [],
      expenses: [],
    },
    "USD",
    RATES,
  );
  assert.deepEqual(fin.missingRates, ["GBP"]);
  closeTo(fin.received, 0);
});

test("order finance: margin is null rather than dividing by zero", () => {
  const fin = computeOrderFinance(
    { expectedRevenue: 0, expectedCost: 0, paymentsIn: [], paymentsOut: [], expenses: [] },
    "USD",
    RATES,
  );
  assert.equal(fin.marginPct, null);
});

// --- selling prices ----------------------------------------------------------

test("a product with no selling price sells at cost", () => {
  assert.equal(sellUnitPrice({ price: 1.5 }), 1.5);
  assert.equal(sellUnitPrice({ price: 1.5, sellPrice: 0 }), 1.5);
  assert.equal(sellUnitPrice({ price: 1.5, sellPrice: 1.8 }), 1.8);
});

test("per-line markup flows into goods, and commission stacks on top of it", () => {
  // Buy at 1.5, invoice at 1.8, 1000 pcs: cost 1500, goods 1800.
  const marked = { ...chicken, price: 1.5, sellPrice: 1.8, qtyPerBox: 100, moq: 1 };
  const totals = computeOrderTotals([{ product: marked, quantity: 1000 }], ["CNY"], RATES, 10);
  closeTo(totals.cost.CNY, 1500);
  closeTo(totals.goods.CNY, 1800);
  // 10% commission on the invoiced 1800, not on the 1500 cost.
  closeTo(totals.commission.CNY, 180);
  closeTo(totals.grandTotal.CNY, 1980);
});

test("without selling prices, cost equals goods and nothing else moves", () => {
  // The exact behaviour of every order saved before selling prices existed.
  const totals = computeOrderTotals([{ product: chicken, quantity: 10 }], ["CNY"], RATES, 10);
  closeTo(totals.cost.CNY, totals.goods.CNY);
  closeTo(totals.goods.CNY, 100);
  closeTo(totals.grandTotal.CNY, 110);
});

test("snapshot totals honour the frozen sell price and keep cost apart", () => {
  const totals = computeSnapshotTotals(
    [snapshotLine({ quantity: 100, unitPrice: 1.5, sellPrice: 1.8, currency: "CNY" })],
    ["CNY", "USD"],
    RATES,
    10,
  );
  closeTo(totals.cost.CNY, 150);
  closeTo(totals.goods.CNY, 180);
  closeTo(totals.grandTotal.CNY, 198);
  closeTo(totals.goods.USD, 25.2);
});

test("snapshot lines without a sell price behave exactly as before", () => {
  const totals = computeSnapshotTotals(
    [snapshotLine({ quantity: 10, unitPrice: 10, sellPrice: 0, currency: "CNY" })],
    ["CNY"],
    RATES,
  );
  closeTo(totals.goods.CNY, 100);
  closeTo(totals.cost.CNY, 100);
});

// --- per-day rates and FX ----------------------------------------------------

test("a payment converts at the rates of its own day", () => {
  // Quote priced at CNY 0.14; the client's 7140 CNY arrived on a day when
  // CNY was worth 0.135 — the money banked is 963.90 USD, not 999.60.
  const fin = computeOrderFinance(
    {
      expectedRevenue: 999.6,
      expectedCost: 800,
      paymentsIn: [{ amount: 7140, currency: "CNY", rates: { USD: 1, CNY: 0.135 } }],
      paymentsOut: [],
      expenses: [],
    },
    "USD",
    RATES,
  );
  closeTo(fin.received, 963.9);
  // The shortfall stays visible as outstanding, and the FX line names it.
  closeTo(fin.clientOutstanding, 999.6 - 963.9);
  closeTo(fin.fxGainLoss, 963.9 - 999.6);
});

test("FX nets across directions: losing on receipts, gaining on payouts", () => {
  const fin = computeOrderFinance(
    {
      expectedRevenue: 1000,
      expectedCost: 700,
      paymentsIn: [{ amount: 7140, currency: "CNY", rates: { USD: 1, CNY: 0.135 } }],
      // Paying the supplier when CNY was cheap costs fewer USD than quoted.
      paymentsOut: [{ amount: 5000, currency: "CNY", rates: { USD: 1, CNY: 0.135 } }],
      expenses: [],
    },
    "USD",
    RATES,
  );
  // in: 963.90 vs 999.60 → −35.70 ; out: 675 vs 700 → saved 25 → net −10.70
  closeTo(fin.fxGainLoss, -35.7 + 25);
});

test("entries without their own rates behave exactly as before", () => {
  const fin = computeOrderFinance(
    {
      expectedRevenue: 1000,
      expectedCost: 800,
      paymentsIn: [{ amount: 300, currency: "USD" }],
      paymentsOut: [{ amount: 5714.29, currency: "CNY" }],
      expenses: [{ amount: 50, currency: "USD" }],
    },
    "USD",
    RATES,
  );
  closeTo(fin.fxGainLoss, 0);
});

test("the identity holds with per-day rates: actual + outstandings = expected", () => {
  const fin = computeOrderFinance(
    {
      expectedRevenue: 1000,
      expectedCost: 700,
      paymentsIn: [{ amount: 2000, currency: "BRL", rates: { USD: 1, BRL: 0.19 } }],
      paymentsOut: [{ amount: 3000, currency: "CNY", rates: { USD: 1, CNY: 0.142 } }],
      expenses: [{ amount: 100, currency: "CNY", rates: { USD: 1, CNY: 0.138 } }],
    },
    "USD",
    { USD: 1, CNY: 0.14, BRL: 0.18 },
  );
  closeTo(
    fin.netActual + fin.clientOutstanding - fin.supplierOutstanding,
    fin.netExpected,
  );
});

test("roundMoney lands on exact cents for classic float traps", () => {
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(19.99 * 100, 2), 1999);
  assert.equal(roundMoney(-1.005), -1.01);
  assert.equal(roundMoney(1.2345, 4), 1.2345);
});

test("line totals are exact for sub-cent unit prices", () => {
  // 0.115 RMB per piece × 3000 pieces: raw floats give 344.99999999999994.
  const cheap = { ...chicken, price: 0.115, sellPrice: 0 };
  assert.equal(lineTotal(cheap, 3000), 345);
});

test("summing many rounded lines stays cent-exact", () => {
  const lines = Array.from({ length: 1000 }, () =>
    snapshotLine({ quantity: 3, unitPrice: 0.1, sellPrice: 0.1, currency: "USD" }),
  );
  const totals = computeSnapshotTotals(lines, ["USD"], { USD: 1 });
  // 1000 × (3 × 0.10) — naive float summation drifts; rounded sums do not.
  assert.equal(totals.cost.USD, 300);
  assert.equal(totals.grandTotal.USD, 300);
});

test("commission lands on cents and the grand total reconciles exactly", () => {
  const lines = [snapshotLine({ quantity: 7, unitPrice: 3.33, sellPrice: 3.33, currency: "USD" })];
  const totals = computeSnapshotTotals(lines, ["USD"], { USD: 1 }, 7.5);
  assert.equal(totals.goods.USD, 23.31);
  assert.equal(totals.commission.USD, 1.75);
  assert.equal(totals.grandTotal.USD, roundMoney(totals.goods.USD + totals.commission.USD));
  assert.equal(totals.grandTotal.USD, 25.06);
});

test("a line's own carton inputs re-derive its figures exactly as a fresh line would", () => {
  const product = { price: 4.5, currency: "CNY", moq: 100, qtyPerBox: 50, weightKg: 12, cbm: 0.06 };
  const derived = deriveLineFigures(
    { unitPrice: 4.5, qtyPerBox: 50, cartonCbm: 0.06, cartonWeightKg: 12 },
    175,
  );
  assert.equal(derived.lineTotal, lineTotal(product, 175));
  assert.equal(derived.lineCbm, lineCbm(product, 175)); // 4 cartons: partials take full space
  assert.equal(derived.lineWeightKg, lineWeightKg(product, 175)); // weight stays proportional
  assert.equal(derived.cartons, fullCartons(product, 175));
});

test("the sell side converts from ITS currency; a moved cost currency cannot relabel the quote", () => {
  // Cost was refreshed from 10 CNY to 1.40 USD; the client was quoted 15 CNY.
  const line = {
    quantity: 10,
    unitPrice: 1.4,
    sellPrice: 15,
    currency: "USD",
    sellCurrency: "CNY",
    moq: 1,
    lineCbm: 0,
    lineWeightKg: 0,
    cartons: 1,
  };
  const rates = { USD: 1, CNY: 0.14 };
  const totals = computeSnapshotTotals([line], ["USD"], rates);
  assert.equal(totals.goods.USD, 21); // 150 CNY × 0.14 — not 150 USD
  assert.equal(totals.cost.USD, 14);
  // Old rows carry no sellCurrency and keep meaning the cost currency.
  const old = { ...line, sellCurrency: undefined, unitPrice: 10, currency: "CNY" };
  assert.equal(computeSnapshotTotals([old], ["USD"], rates).goods.USD, 21);
});

// --- order finance, per side ---------------------------------------------------

const RATES3 = { USD: 1, CNY: 0.14, BRL: 0.2 };

// Quoted 1000 BRL to the client; the goods cost 700 CNY (= 490 BRL at these
// rates). Client paid 400 BRL, supplier got 400 CNY, 70 CNY of freight.
const SIDES = {
  expectedRevenue: 1000,
  expectedCost: 490,
  paymentsIn: [{ amount: 400, currency: "BRL" }],
  paymentsOut: [{ amount: 400, currency: "CNY" }],
  expenses: [{ amount: 70, currency: "CNY" }],
};

test("finance view: each side reads in its own currency, the result in the chosen one", () => {
  const fin = computeOrderFinanceView(
    SIDES,
    { quote: "BRL", supplier: "CNY", result: "CNY" },
    RATES3,
  );
  assert.equal(fin.client.currency, "BRL");
  closeTo(fin.client.expected, 1000);
  closeTo(fin.client.received, 400);
  closeTo(fin.client.outstanding, 600);

  assert.equal(fin.supplier.currency, "CNY");
  closeTo(fin.supplier.expected, 700);
  closeTo(fin.supplier.paid, 400); // exactly what was typed — no round trip
  closeTo(fin.supplier.outstanding, 300);

  assert.equal(fin.result.currency, "CNY");
  closeTo(fin.result.expensesTotal, 70);
  closeTo(fin.result.netExpected, (1000 * 0.2) / 0.14 - 700 - 70);
  closeTo(fin.result.netActual, (400 * 0.2) / 0.14 - 400 - 70);
  closeTo(fin.result.fxGainLoss, 0);
  assert.deepEqual(fin.missingRates, []);
});

test("finance view: switching the result currency never moves either side", () => {
  const inCny = computeOrderFinanceView(
    SIDES,
    { quote: "BRL", supplier: "CNY", result: "CNY" },
    RATES3,
  );
  const inBrl = computeOrderFinanceView(
    SIDES,
    { quote: "BRL", supplier: "CNY", result: "BRL" },
    RATES3,
  );
  assert.deepEqual(inCny.client, inBrl.client);
  assert.deepEqual(inCny.supplier, inBrl.supplier);
  closeTo(inBrl.result.netExpected, 1000 - 490 - (70 * 0.14) / 0.2);
  closeTo(inBrl.result.netExpected, (inCny.result.netExpected * 0.14) / 0.2);
});

test("finance view: FX lands in the result currency when a payment's day rate differs", () => {
  // The client's 400 BRL arrived on a day BRL was worth 0.25 USD, not 0.2.
  const fin = computeOrderFinanceView(
    {
      ...SIDES,
      paymentsIn: [{ amount: 400, currency: "BRL", rates: { USD: 1, CNY: 0.14, BRL: 0.25 } }],
    },
    { quote: "BRL", supplier: "CNY", result: "CNY" },
    RATES3,
  );
  closeTo(fin.result.fxGainLoss, (400 * 0.25) / 0.14 - (400 * 0.2) / 0.14);
  // On the client's own side 400 BRL is 400 BRL, whatever the day's rate.
  closeTo(fin.client.received, 400);
  closeTo(fin.client.outstanding, 600);
});

test("finance view: an unknown result currency is flagged, not a crash", () => {
  const fin = computeOrderFinanceView(
    SIDES,
    { quote: "BRL", supplier: "CNY", result: "GBP" },
    RATES3,
  );
  assert.deepEqual(fin.missingRates, ["GBP"]);
  closeTo(fin.client.received, 400);
  closeTo(fin.supplier.paid, 400);
});
