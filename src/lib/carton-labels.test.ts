import { test } from "node:test";
import assert from "node:assert/strict";
import { cartonLabels, labelMarks } from "./carton-labels";

test("cartons are numbered across the order; the last of a line holds the rest", () => {
  const { labels, unlabelled } = cartonLabels([
    { nameEn: "50ml Foam Pump Bottle", nameZh: "50毫升泡沫泵瓶", quantity: 1995, cartons: 4, perCarton: 600 },
    { nameEn: "Mini Thumb Digital Camera", nameZh: "迷你数码相机", quantity: 400, cartons: 2, perCarton: 200 },
    { nameEn: "Unmeasured", nameZh: "", quantity: 10, cartons: null, perCarton: 0 },
  ]);
  assert.equal(unlabelled, 1);
  assert.deepEqual(
    labels.map((l) => [l.no, l.of, l.nameEn.slice(0, 4), l.pieces]),
    [
      [1, 6, "50ml", 600],
      [2, 6, "50ml", 600],
      [3, 6, "50ml", 600],
      [4, 6, "50ml", 195],
      [5, 6, "Mini", 200],
      [6, 6, "Mini", 200],
    ],
  );
});

test("an unknown carton size prints no piece count", () => {
  const { labels } = cartonLabels([{ nameEn: "Brush", nameZh: "刷子", quantity: 720, cartons: 1, perCarton: 0 }]);
  assert.equal(labels[0].pieces, null);
});

test("labels lead with the order's marks, else its number and destination", () => {
  assert.deepEqual(labelMarks(["BLG-88", "PARAGUAY"], "ORD-1", "Paraguay"), ["BLG-88", "PARAGUAY"]);
  assert.deepEqual(labelMarks(["N/M"], "ORD-1", "Paraguay"), ["ORD-1", "PARAGUAY"]);
  assert.deepEqual(labelMarks(["N/M"], "ORD-1", ""), ["ORD-1"]);
});
