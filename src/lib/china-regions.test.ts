import { test } from "node:test";
import assert from "node:assert/strict";
import { goodsOriginOf, normalizeProvince, PROVINCES } from "./china-regions";
import { regionFromBooth } from "./customs";

test("all 31 provincial divisions, each once", () => {
  assert.equal(PROVINCES.length, 31);
  assert.equal(new Set(PROVINCES.map((p) => p.zh)).size, 31);
});

test("a province however it was written becomes its stored name", () => {
  assert.equal(normalizeProvince("浙江省"), "浙江省");
  assert.equal(normalizeProvince(" 浙江 "), "浙江省");
  assert.equal(normalizeProvince("Zhejiang"), "浙江省");
  assert.equal(normalizeProvince("guangdong province"), "广东省");
  assert.equal(normalizeProvince("广西"), "广西壮族自治区");
  assert.equal(normalizeProvince("内蒙古"), "内蒙古自治区");
  assert.equal(normalizeProvince("上海"), "上海市");
  assert.equal(normalizeProvince("Shaanxi"), "陕西省");
  assert.equal(normalizeProvince("Shanxi"), "山西省");
  assert.equal(normalizeProvince("山西"), "山西省");
  assert.equal(normalizeProvince("陕西"), "陕西省");
  assert.equal(normalizeProvince("Atlantis"), "");
  assert.equal(normalizeProvince(""), "");
});

test("the declaration's 境内货源地 reads province then city", () => {
  assert.equal(goodsOriginOf("浙江省", "义乌市"), "浙江省义乌市");
  assert.equal(goodsOriginOf("广东省", ""), "广东省");
  assert.equal(goodsOriginOf("", "永康市"), "永康市");
  assert.equal(goodsOriginOf("", ""), "");
  assert.equal(goodsOriginOf("上海市", "浦东新区"), "上海市浦东新区");
  assert.equal(goodsOriginOf("上海市", "上海市浦东新区"), "上海市浦东新区", "a city written in full is not doubled");
});

test("a Yiwu booth places a supplier in Yiwu; nothing else is guessed", () => {
  assert.deepEqual(regionFromBooth("No.4642, Yiwu International Trade City (义乌国际商贸城一区2楼C区9街4642店)"), { province: "浙江省", city: "义乌市" });
  assert.deepEqual(regionFromBooth("广州白马服装市场 3F"), { province: "", city: "" });
});
