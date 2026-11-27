import test from "node:test";
import assert from "node:assert/strict";
import { orderCustomsRows } from "./customs-pack-data";

const row = (name: string, supplierId: number | null, supplierName: string | null) => ({ name, supplierId, supplierName });

test("customs rows follow the order page's supplier groups before product names", () => {
  const ordered = orderCustomsRows([
    row("Alpha product", 2, "Zulu supplier"),
    row("Beta product", 1, "Alpha supplier"),
    row("Delta product", 2, "Zulu supplier"),
    row("Gamma product", 1, "Alpha supplier"),
    row("Unassigned product", null, null),
  ]);
  assert.deepEqual(ordered.map((line) => line.name), [
    "Beta product",
    "Gamma product",
    "Alpha product",
    "Delta product",
    "Unassigned product",
  ]);
});
