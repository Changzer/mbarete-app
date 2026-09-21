import assert from "node:assert/strict";
import test from "node:test";
import { supplierVatPctSchema, productSchema } from "./validators";
import { supplierUnitCost, lineTotal, sellUnitPrice, sellCurrencyOf, quoteSellPrice, computeOrderTotals, deriveLineFigures } from "./calculations";
import { rankOffers } from "./offers";
import { collectDraftFields } from "./offline/draft";

const product = { price: 36, supplierVatPct: 3, currency: "CNY", sellPrice: 0, sellCurrency: "USD", moq: 1, qtyPerBox: 1, cbm: 0, weightKg: 0 };

test("blank supplier VAT means no surcharge; decimal percentages accept commas", () => {
  for (const value of [undefined, null, "", "  ", 0, "0"]) assert.equal(supplierVatPctSchema.parse(value), 0);
  for (let value = 1; value <= 13; value++) assert.equal(supplierVatPctSchema.parse(String(value)), value);
  assert.equal(supplierVatPctSchema.parse(" 2,5 "), 2.5);
  for (const value of [-1, "-1", 101, "abc", Infinity, "NaN", "3%", "1.001"]) {
    assert.equal(supplierVatPctSchema.safeParse(value).success, false, String(value));
  }
  assert.equal(productSchema.parse({ nameEn: "Camera", categoryId: 1, price: 36, currency: "CNY", moq: 1, qtyPerBox: 1 }).supplierVatPct, 0);
});

test("supplier VAT is added once to the unit cost and order cost", () => {
  assert.equal(supplierUnitCost(product), 37.08);
  assert.equal(lineTotal(product, 100), 3708);
  assert.equal(supplierUnitCost({ price: 36 }), 36);
  assert.equal(supplierUnitCost({ price: 36, supplierVatPct: 13 }), 40.68);
  assert.equal(supplierUnitCost({ price: 36, supplierVatPct: 2.5 }), 36.9);
  assert.equal(lineTotal({ ...product, price: 0.01, supplierVatPct: 13 }, 1000), 11.3, "keep sub-cent unit costs until the line is totaled");
  const frozen = deriveLineFigures({ unitPrice: supplierUnitCost(product), qtyPerBox: 1, cartonCbm: 0, cartonWeightKg: 0 }, 200);
  assert.equal(frozen.lineTotal, 7416, "editing quantity uses the already-taxed snapshot");
});

test("blank selling price uses inclusive cost in the cost currency, explicit selling price stays independent", () => {
  assert.equal(sellUnitPrice(product), 37.08);
  assert.equal(sellCurrencyOf(product), "CNY");
  assert.equal(quoteSellPrice(sellUnitPrice(product), sellCurrencyOf(product), "USD", { CNY: 0.14, USD: 1 }), 5.19);
  const sold = { ...product, sellPrice: 8 };
  assert.equal(sellUnitPrice(sold), 8);
  assert.equal(sellCurrencyOf(sold), "USD");
  const totals = computeOrderTotals([{ product: sold, quantity: 100 }], ["USD"], { CNY: 0.14, USD: 1 });
  assert.equal(totals.cost.USD, 519.12);
  assert.equal(totals.goods.USD, 800);
});

test("supplier comparison ranks the inclusive quote, even when the lower base price has VAT", () => {
  const offer = { supplierId: null, currency: "CNY", moq: 1, leadTimeDays: 0, quotedOn: "2026-09-21", active: true };
  const ranked = rankOffers([{ ...offer, id: 1, price: 36, supplierVatPct: 3 }, { ...offer, id: 2, price: 37, supplierVatPct: 0 }], { basis: "CNY", rates: { CNY: 0.14 } });
  assert.deepEqual(ranked.map((o) => o.id), [2, 1]);
});

test("offline capture retains typed VAT and selling currency for review", () => {
  const form = new FormData();
  form.set("price", "36"); form.set("supplierVatPct", "2,5"); form.set("sellCurrency", "USD");
  const fields = collectDraftFields(form);
  assert.equal(fields.supplierVatPct, "2,5");
  assert.equal(fields.sellCurrency, "USD");
});
