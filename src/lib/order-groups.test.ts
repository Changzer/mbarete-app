import test from "node:test";
import assert from "node:assert/strict";
import { groupBySupplier } from "./order-groups";

const line = (id: number, supplierId: number | null, supplierName: string | null = supplierId ? `S${supplierId}` : null) => ({
  id,
  supplierId,
  supplierName,
});

test("groups keep first-appearance order and line order within a group", () => {
  const groups = groupBySupplier([line(1, 7), line(2, 3), line(3, 7), line(4, 3), line(5, 9)]);
  assert.deepEqual(
    groups.map((g) => [g.supplierId, g.rows.map((r) => r.id)]),
    [
      [7, [1, 3]],
      [3, [2, 4]],
      [9, [5]],
    ],
  );
  assert.equal(groups[0].supplierName, "S7");
});

test("lines without a supplier form one group, last, wherever they appeared", () => {
  const groups = groupBySupplier([line(1, null), line(2, 4), line(3, null), line(4, 4)]);
  assert.deepEqual(
    groups.map((g) => [g.supplierId, g.rows.map((r) => r.id)]),
    [
      [4, [2, 4]],
      [null, [1, 3]],
    ],
  );
  assert.equal(groups[1].supplierName, null);
});

test("an empty order has no groups", () => {
  assert.deepEqual(groupBySupplier([]), []);
});
