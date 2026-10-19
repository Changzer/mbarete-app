import test from "node:test";
import assert from "node:assert/strict";
import { compareNames, sortByName } from "./name-order";

const named = (id: number, name: string) => ({ id, name });

test("order lines read alphabetically, numbers by value, dashes as spaces", () => {
  const lines = [
    "FREE - Electric Scooter Charger",
    "Folding Electric Scooter 8.5-inch",
    "Foldable Electric Scooter 10-inch",
    "Electric Scooter Controller",
    "FREE- Electric Drift Tricycle Battery 3.0AH",
    "electric drift tricycle charger",
    "Bag 10",
    "Bag 9",
    "Pen Holder",
    "Penguin",
  ].map((name, i) => named(i + 1, name));
  assert.deepEqual(
    sortByName(lines, (l) => l.name, "en").map((l) => l.name),
    [
      "Bag 9",
      "Bag 10",
      "electric drift tricycle charger",
      "Electric Scooter Controller",
      "Foldable Electric Scooter 10-inch",
      "Folding Electric Scooter 8.5-inch",
      "FREE- Electric Drift Tricycle Battery 3.0AH",
      "FREE - Electric Scooter Charger",
      "Pen Holder",
      "Penguin",
    ],
  );
});

test("Chinese names sort by pinyin", () => {
  assert.deepEqual(
    ["电动滑板车", "安全帽", "充电器"].sort(compareNames("zh")),
    ["安全帽", "充电器", "电动滑板车"],
  );
});

test("equal names keep a stable order by id and the input is not changed", () => {
  const input = [named(3, "Charger"), named(1, "charger"), named(2, "Battery")];
  assert.deepEqual(sortByName(input, (l) => l.name, "en").map((l) => l.id), [2, 1, 3]);
  assert.deepEqual(input.map((l) => l.id), [3, 1, 2]);
});
