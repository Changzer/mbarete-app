import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPackingListKg } from "./packing-list-pdf";

test("packing-list kilograms use a decimal comma and exactly two decimals", () => {
  assert.equal(formatPackingListKg(317.2), "317,20");
  assert.equal(formatPackingListKg(28), "28,00");
  assert.equal(formatPackingListKg(19.199), "19,20");
  assert.equal(formatPackingListKg(1234.5), "1.234,50");
});

test("unmeasured packing-list weights stay visibly unknown", () => {
  assert.equal(formatPackingListKg(0), "—");
  assert.equal(formatPackingListKg(-1), "—");
});
