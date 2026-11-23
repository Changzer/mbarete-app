import test from "node:test";
import assert from "node:assert/strict";
import { canonicalCurrencyCode, canonicalCurrencyRates } from "./currency";
import { productSchema } from "./validators";

test("currency codes canonicalize case, whitespace and the legacy RMB alias", () => {
  assert.equal(canonicalCurrencyCode(" rmb "), "CNY");
  assert.equal(canonicalCurrencyCode("cny"), "CNY");
  assert.equal(canonicalCurrencyCode("usd"), "USD");
  assert.equal(canonicalCurrencyCode(""), "");
});

test("rate tables contain one CNY entry and prefer an existing CNY value", () => {
  assert.deepEqual(canonicalCurrencyRates({ USD: 1, RMB: 0.14 }), { USD: 1, CNY: 0.14 });
  assert.deepEqual(canonicalCurrencyRates({ RMB: 0.15, CNY: 0.14 }), { CNY: 0.14 });
});

test("product validation stores legacy RMB input as CNY", () => {
  const product = productSchema.parse({
    nameEn: "Camera",
    categoryId: 1,
    price: 36,
    currency: "RMB",
    sellCurrency: "rmb",
    moq: 1,
    qtyPerBox: 1,
  });
  assert.equal(product.currency, "CNY");
  assert.equal(product.sellCurrency, "CNY");
});
