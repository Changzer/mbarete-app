import test from "node:test";
import assert from "node:assert/strict";
import { landedCost, landedCostByMode, latestRates, rateKey, ratePerCbm, shippingPerUnit, type ShippingRate } from "./landed-cost";

const rates = { USD: 1, CNY: 0.14, BRL: 0.2 };
const lcl: ShippingRate = { destination: "BR", mode: "lcl", basis: "per_cbm", amount: 120, currency: "USD", usableCbm: 68, effectiveFrom: "2026-09-01" };
const fcl: ShippingRate = { destination: "PY", mode: "fcl", basis: "per_40hq", amount: 6800, currency: "USD", usableCbm: 68, effectiveFrom: "2026-09-01" };

test("a container rate spreads over its usable volume", () => {
  assert.equal(ratePerCbm(lcl), 120);
  assert.equal(ratePerCbm(fcl), 100);
  assert.equal(ratePerCbm({ ...fcl, usableCbm: 0 }), 0);
});

test("freight per piece is the carton's share of a cubic metre", () => {
  // 0.05 m³ carton of 100 pieces at 120/m³: 6.00 per carton, 0.06 per piece
  assert.equal(shippingPerUnit(lcl, 0.05, 100), 0.06);
  assert.equal(shippingPerUnit(lcl, 0, 100), 0);
  assert.equal(shippingPerUnit(lcl, 0.05, 0), 0);
});

test("landed cost adds freight then duty on the CIF, in the target currency", () => {
  const r = landedCost({ unitCost: 10, costCurrency: "CNY", cartonCbm: 0.05, qtyPerBox: 100, dutyPct: 20, rate: lcl, target: "USD", rates });
  // 10 CNY = 1.40 USD; freight 0.06; CIF 1.46; duty 0.292; total 1.752
  assert.deepEqual(r, { currency: "USD", unitCost: 1.4, shipping: 0.06, costAndFreight: 1.46, duty: 0.292, total: 1.752, missing: [] });
  const inBrl = landedCost({ unitCost: 10, costCurrency: "CNY", cartonCbm: 0.05, qtyPerBox: 100, dutyPct: 20, rate: lcl, target: "BRL", rates });
  assert.equal(inBrl.total, 8.76);
});

test("missing pieces keep dependent amounts unknown", () => {
  const noRate = landedCost({ unitCost: 10, costCurrency: "USD", cartonCbm: 0.05, qtyPerBox: 100, dutyPct: null, rate: null, target: "USD", rates });
  assert.deepEqual(noRate.missing, ["rate", "duty"]);
  assert.equal(noRate.total, null);
  assert.equal(noRate.shipping, null);
  assert.equal(noRate.duty, null);
  assert.equal(noRate.unitCost, 10);
  const noCarton = landedCost({ unitCost: 10, costCurrency: "USD", cartonCbm: 0, qtyPerBox: 100, dutyPct: 10, rate: lcl, target: "USD", rates });
  assert.deepEqual(noCarton.missing, ["carton"]);
  assert.equal(noCarton.total, null);
  assert.equal(noCarton.costAndFreight, null);
  const noPrice = landedCost({ unitCost: 0, costCurrency: "USD", cartonCbm: 0.05, qtyPerBox: 100, dutyPct: 10, rate: lcl, target: "USD", rates });
  assert.deepEqual(noPrice.missing, ["price"]);
  const badCurrency = landedCost({ unitCost: 10, costCurrency: "XXX", cartonCbm: 0.05, qtyPerBox: 100, dutyPct: 10, rate: lcl, target: "USD", rates });
  assert.deepEqual(badCurrency.missing, ["currency"]);
});

test("the newest row per destination and mode wins, by date then by id", () => {
  const rows = [
    { id: 1, destination: "BR", mode: "lcl", effectiveFrom: "2026-08-01" },
    { id: 2, destination: "BR", mode: "lcl", effectiveFrom: "2026-09-01" },
    { id: 3, destination: "BR", mode: "lcl", effectiveFrom: "2026-09-01" },
    { id: 4, destination: "BR", mode: "fcl", effectiveFrom: "2026-07-01" },
    { id: 5, destination: "PY", mode: "lcl", effectiveFrom: "2026-07-01" },
  ];
  const latest = latestRates(rows, "2026-09-17");
  assert.equal(latest.get(rateKey("BR", "lcl"))!.id, 3);
  assert.equal(latest.get(rateKey("BR", "fcl"))!.id, 4);
  assert.equal(latest.get(rateKey("PY", "lcl"))!.id, 5);
  assert.equal(latest.get(rateKey("PY", "fcl")), undefined);
  assert.equal(latest.size, 3);
});

test("both modes are estimated side by side; a mode without a rate says so", () => {
  const input = { unitCost: 10, costCurrency: "USD", cartonCbm: 0.05, qtyPerBox: 100, dutyPct: 10, target: "USD", rates };
  const both = landedCostByMode(input, { lcl, fcl: { ...fcl, destination: "BR" } });
  // LCL 120/m³ → 0.06 per piece; FCL 6800/68 = 100/m³ → 0.05 per piece
  assert.equal(both.lcl.shipping, 0.06);
  assert.equal(both.fcl.shipping, 0.05);
  assert.equal(both.lcl.total, 11.066);
  assert.equal(both.fcl.total, 11.055);
  const onlyLcl = landedCostByMode(input, { lcl });
  assert.deepEqual(onlyLcl.lcl.missing, []);
  assert.deepEqual(onlyLcl.fcl.missing, ["rate"]);
  assert.equal(onlyLcl.fcl.total, null);
});


test("future quotes never replace a quote before their effective day", () => {
  const rows = [
    { id: 1, ...lcl },
    { id: 2, ...lcl, effectiveFrom: "2026-10-01" },
    { id: 3, ...fcl, effectiveFrom: "2026-10-01" },
  ];
  assert.equal(latestRates(rows, "2026-09-17").get("BR:lcl")?.id, 1);
  assert.equal(latestRates(rows, "2026-09-17").has("PY:fcl"), false);
  assert.equal(latestRates(rows, "2026-10-01").get("BR:lcl")?.id, 2);
  assert.equal(latestRates(rows, "2026-08-31").size, 0);
});

test("explicit zero duty is complete, unknown duty is not", () => {
  const input = { unitCost: 10, costCurrency: "USD", cartonCbm: 0.05, qtyPerBox: 100, rate: lcl, target: "USD", rates };
  assert.equal(landedCost({ ...input, dutyPct: 0 }).total, 10.06);
  assert.equal(landedCost({ ...input, dutyPct: 0 }).duty, 0);
  for (const dutyPct of [null, NaN, -1, 201]) {
    const estimate = landedCost({ ...input, dutyPct });
    assert.equal(estimate.total, null);
    assert.ok(estimate.missing.includes("duty"));
  }
});

test("one mode with a missing exchange rate never gets a cheap total", () => {
  const input = { unitCost: 10, costCurrency: "USD", cartonCbm: 0.05, qtyPerBox: 100, dutyPct: 10, target: "USD", rates };
  const result = landedCostByMode(input, { lcl, fcl: { ...fcl, currency: "XXX" } });
  assert.equal(result.lcl.total, 11.066);
  assert.equal(result.fcl.total, null);
  assert.equal(result.fcl.shipping, null);
  assert.deepEqual(result.fcl.missing, ["currency"]);
});

test("invalid freight, volume and exchange values never become zero-cost shipping", () => {
  const input = { unitCost: 10, costCurrency: "CNY", cartonCbm: 0.05, qtyPerBox: 100, dutyPct: 10, rate: fcl, target: "USD", rates };
  for (const rate of [{ ...fcl, usableCbm: 0 }, { ...fcl, amount: -10 }, { ...fcl, amount: Infinity }]) {
    assert.equal(landedCost({ ...input, rate }).total, null);
  }
  assert.equal(landedCost({ ...input, cartonCbm: Infinity }).total, null);
  for (const invalid of [0, -1, Infinity, NaN]) {
    assert.equal(landedCost({ ...input, rates: { ...rates, CNY: invalid } }).unitCost, null);
  }
});
