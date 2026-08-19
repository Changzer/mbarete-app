import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTranscription, type RawTranscription } from "./transcribe-product";

const CATEGORY_IDS = new Set([1, 2, 3]);

const raw = (overrides: Partial<RawTranscription>): RawTranscription => ({
  nameEn: null,
  nameZh: null,
  descriptionEn: null,
  descriptionZh: null,
  price: null,
  currency: null,
  moq: null,
  qtyPerBox: null,
  categoryId: null,
  notes: null,
  ...overrides,
});

test("a full reading passes through", () => {
  const { fields, notes } = sanitizeTranscription(
    raw({
      nameEn: "Acrylic paint highlight pens, 12 colours 1.0mm",
      nameZh: "丙烯马克笔 12色 1.0mm",
      price: 10.2,
      currency: "CNY",
      moq: 160,
      qtyPerBox: 160,
      categoryId: 2,
      notes: "Price read from a handwritten board.",
    }),
    CATEGORY_IDS,
  );
  assert.equal(fields.nameEn, "Acrylic paint highlight pens, 12 colours 1.0mm");
  assert.equal(fields.price, 10.2);
  assert.equal(fields.currency, "CNY");
  assert.equal(fields.moq, 160);
  assert.equal(fields.qtyPerBox, 160);
  assert.equal(fields.categoryId, 2);
  assert.equal(notes, "Price read from a handwritten board.");
});

test("nulls become absent fields, not empty strings or zeros", () => {
  const { fields, notes } = sanitizeTranscription(raw({}), CATEGORY_IDS);
  assert.deepEqual(fields, {
    nameEn: undefined,
    nameZh: undefined,
    descriptionEn: undefined,
    descriptionZh: undefined,
    price: undefined,
    currency: undefined,
    moq: undefined,
    qtyPerBox: undefined,
    categoryId: undefined,
  });
  assert.equal(notes, null);
});

test("blank and whitespace strings are dropped", () => {
  const { fields } = sanitizeTranscription(raw({ nameEn: "  ", nameZh: "" }), CATEGORY_IDS);
  assert.equal(fields.nameEn, undefined);
  assert.equal(fields.nameZh, undefined);
});

test("currency aliases and casing collapse to ISO codes", () => {
  assert.equal(
    sanitizeTranscription(raw({ currency: "rmb" }), CATEGORY_IDS).fields.currency,
    "CNY",
  );
  assert.equal(
    sanitizeTranscription(raw({ currency: "cny" }), CATEGORY_IDS).fields.currency,
    "CNY",
  );
  assert.equal(
    sanitizeTranscription(raw({ currency: "¥" }), CATEGORY_IDS).fields.currency,
    "CNY",
  );
  // Not a code the exchange-rate table could ever hold: drop rather than store noise.
  assert.equal(
    sanitizeTranscription(raw({ currency: "yuan renminbi" }), CATEGORY_IDS).fields.currency,
    undefined,
  );
});

test("prices are rounded to cents and negatives dropped", () => {
  assert.equal(
    sanitizeTranscription(raw({ price: 10.204999 }), CATEGORY_IDS).fields.price,
    10.2,
  );
  assert.equal(sanitizeTranscription(raw({ price: -3 }), CATEGORY_IDS).fields.price, undefined);
});

test("counts must be positive integers", () => {
  assert.equal(sanitizeTranscription(raw({ moq: 0 }), CATEGORY_IDS).fields.moq, undefined);
  assert.equal(sanitizeTranscription(raw({ qtyPerBox: 159.6 }), CATEGORY_IDS).fields.qtyPerBox, 160);
});

test("a category id outside the list is rejected", () => {
  assert.equal(
    sanitizeTranscription(raw({ categoryId: 99 }), CATEGORY_IDS).fields.categoryId,
    undefined,
  );
  assert.equal(
    sanitizeTranscription(raw({ categoryId: 3 }), CATEGORY_IDS).fields.categoryId,
    3,
  );
});
