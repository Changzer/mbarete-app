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
  assert.deepEqual(r, { currency: "USD", unitCost: 1.4, shipping: 0.06, cif: 1.46, duty: 0.292, total: 1.752, missing: [] });
  const inBrl = landedCost({ unitCost: 10, costCurrency: "CNY", cartonCbm: 0.05, qtyPerBox: 100, dutyPct: 20, rate: lcl, target: "BRL", rates });
  assert.equal(inBrl.total, 8.76);
});

test("missing pieces are named and contribute nothing, never an exception", () => {
  const noRate = landedCost({ unitCost: 10, costCurrency: "USD", cartonCbm: 0.05, qtyPerBox: 100, dutyPct: null, rate: null, target: "USD", rates });
  assert.deepEqual(noRate.missing, ["rate", "duty"]);
  assert.equal(noRate.total, 10);
  const noCarton = landedCost({ unitCost: 10, costCurrency: "USD", cartonCbm: 0, qtyPerBox: 100, dutyPct: 10, rate: lcl, target: "USD", rates });
  assert.deepEqual(noCarton.missing, ["carton"]);
  assert.equal(noCarton.total, 11);
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
  const latest = latestRates(rows);
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
  assert.equal(onlyLcl.fcl.total, 11);
});
