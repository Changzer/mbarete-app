import test from "node:test";
import assert from "node:assert/strict";
import { landedCost, latestPerDestination, ratePerCbm, shippingPerUnit, type ShippingRate } from "./landed-cost";

const rates = { USD: 1, CNY: 0.14, BRL: 0.2 };
const lcl: ShippingRate = { destination: "BR", basis: "per_cbm", amount: 120, currency: "USD", usableCbm: 68, effectiveFrom: "2026-09-01" };
const fcl: ShippingRate = { destination: "PY", basis: "per_40hq", amount: 6800, currency: "USD", usableCbm: 68, effectiveFrom: "2026-09-01" };

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

test("the newest row per destination wins, by date then by id", () => {
  const rows = [
    { id: 1, destination: "BR", effectiveFrom: "2026-08-01" },
    { id: 2, destination: "BR", effectiveFrom: "2026-09-01" },
    { id: 3, destination: "BR", effectiveFrom: "2026-09-01" },
    { id: 4, destination: "PY", effectiveFrom: "2026-07-01" },
  ];
  const latest = latestPerDestination(rows);
  assert.equal(latest.get("BR")!.id, 3);
  assert.equal(latest.get("PY")!.id, 4);
  assert.equal(latest.size, 2);
});
