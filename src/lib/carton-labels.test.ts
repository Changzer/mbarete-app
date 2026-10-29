import { test } from "node:test";
import assert from "node:assert/strict";
import { addressLines, cartonLabels, clientConsignee, labelMarks } from "./carton-labels";

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

test("each carton says what it weighs; the part-full last one its share, so the labels add up to the packing list", () => {
  const { labels } = cartonLabels([
    { nameEn: "Charger", nameZh: "充电器", quantity: 250, cartons: 3, perCarton: 100, cartonKg: 12.3, cartonCbm: 0.046 },
    { nameEn: "Unweighed", nameZh: "", quantity: 5, cartons: 1, perCarton: 5 },
  ]);
  assert.deepEqual(
    labels.map((l) => [l.pieces, l.grossKg, l.cbm]),
    [
      [100, 12.3, 0.046],
      [100, 12.3, 0.046],
      [50, 6.2, 0.046],
      [5, null, null],
    ],
  );
  // The packing list's line weight for the same line: 250 / 100 × 12.3.
  assert.ok(Math.abs(labels.slice(0, 3).reduce((s, l) => s + (l.grossKg ?? 0), 0) - 30.8) < 0.11);
});

test("an address block prints as typed, four lines at most; the client fills an empty destination", () => {
  assert.deepEqual(addressLines(" Yiwu Hengli Logistics \n\n No.88 Chouzhou Rd, Yiwu\nTel 138 0000 0000\n入仓号 YW-2231\nextra"), [
    "Yiwu Hengli Logistics",
    "No.88 Chouzhou Rd, Yiwu",
    "Tel 138 0000 0000",
    "入仓号 YW-2231",
  ]);
  assert.equal(
    clientConsignee({ companyName: "Loja Azul Ltda", address: "Av. Paulista 1000\nSão Paulo", countryEn: "Brazil" }),
    "Loja Azul Ltda\nAv. Paulista 1000\nSão Paulo\nBRAZIL",
  );
  assert.equal(clientConsignee({ companyName: "Loja Azul", address: "", countryEn: "" }), "Loja Azul");
});
