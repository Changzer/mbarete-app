import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDecimalInput } from "./decimal-input";

test("comma is a decimal separator", () => {
  assert.equal(normalizeDecimalInput("1,5"), "1.5");
  assert.equal(normalizeDecimalInput("10,20"), "10.20");
  assert.equal(normalizeDecimalInput(" 4,80 "), "4.80");
});

test("comma groups of three digits are thousands separators", () => {
  assert.equal(normalizeDecimalInput("1,200"), "1200");
  assert.equal(normalizeDecimalInput("1,234,567"), "1234567");
  assert.equal(normalizeDecimalInput("1,234,567.89"), "1234567.89");
});

test("dot input and plain integers pass through unchanged", () => {
  assert.equal(normalizeDecimalInput("4.80"), "4.80");
  assert.equal(normalizeDecimalInput("1200"), "1200");
  assert.equal(normalizeDecimalInput(""), "");
});
