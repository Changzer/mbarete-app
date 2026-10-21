import test from "node:test";
import assert from "node:assert/strict";
import { buildCustomsPack, mainGoodsOrigin, shippingMarkLines, splitCompanyName, type CustomsPackInput } from "./customs-pack";

const base: CustomsPackInput = {
  docNo: "ORD-20260524-001",
  contractDate: "2026-03-10",
  exportDate: "2026-05-24",
  customsDeclarationNo: "",
  companyName: "义乌玻汭进出口有限公司 | Yiwu Mbarete Import Export Co. Ltd.",
  addressLines: ["Room 1452"],
  phone: "+86 195",
  consignee: "JOTA TRADING SA.",
  incoterms: "FOB",
  paymentTerms: ["100% T/T"],
  notes: "",
  currency: "USD",
  portOfLoading: "Qingdao, CN",
  portOfDestination: "Montevideo, UY",
  destinationCountry: "PY",
  goodsOrigin: "山东省临沂市",
  shippingMarks: "",
  lines: [
    {
      nameZh: "TPE环保汽车脚垫", nameEn: "TPE Car Floor Mats", cnHsCode: "3918909000",
      declarationElements: "脚垫，无品牌，热塑性弹性体，型号无，主要用于车内", unit: "set",
      quantity: 2000, unitPrice: 21.02, amount: 42040, cartons: 200, grossKg: 9700.25, cbm: 46.1, supplier: "临沂某工厂", goodsOrigin: "",
    },
    {
      nameZh: "汽车脚垫", nameEn: "Car Mats", cnHsCode: "3918909000",
      declarationElements: "脚垫，无品牌", unit: "set",
      quantity: 200, unitPrice: 21.055, amount: 4211, cartons: 25, grossKg: 986.25, cbm: 4.67, supplier: "临沂某工厂", goodsOrigin: "",
    },
  ],
};

test("the company name splits into the Chinese and English the sheets print", () => {
  assert.deepEqual(splitCompanyName(base.companyName), { zh: "义乌玻汭进出口有限公司", en: "Yiwu Mbarete Import Export Co. Ltd." });
  assert.deepEqual(splitCompanyName("Mbarete Ltd"), { zh: "Mbarete Ltd", en: "Mbarete Ltd" });
  assert.deepEqual(splitCompanyName("义乌玻汭进出口有限公司"), { zh: "义乌玻汭进出口有限公司", en: "义乌玻汭进出口有限公司" });
});

test("totals foot to the cent and the gram; one shared unit is named", () => {
  const pack = buildCustomsPack(base);
  assert.deepEqual(pack.totals, { quantity: 2200, unit: "set", amount: 46251, cartons: 225, grossKg: 10686.5, netKg: 10686.5, cbm: 50.77 });
  assert.equal(pack.lines[0].unitZh, "套");
  assert.equal(pack.lines[0].unitEn, "SET");
  assert.equal(pack.countryZh, "巴拉圭");
  assert.equal(pack.countryEn, "Paraguay");
  assert.equal(pack.factories, "临沂某工厂", "a factory is named once");
  assert.equal(pack.payment, "T/T");
  assert.equal(pack.companyZh, "义乌玻汭进出口有限公司");
  assert.deepEqual(pack.missing, { cnHsCode: 0, declarationElements: 0, logistics: 0, shipment: [] });
});

test("what the order does not know is named, never invented", () => {
  const pack = buildCustomsPack({
    ...base,
    exportDate: "",
    portOfLoading: "",
    destinationCountry: "",
    lines: [
      { ...base.lines[0], cnHsCode: "", declarationElements: " ", unit: "pcs" },
      { ...base.lines[1], cbm: 0, supplier: "另一工厂" },
    ],
  });
  assert.equal(pack.missing.cnHsCode, 1);
  assert.equal(pack.missing.declarationElements, 1);
  assert.equal(pack.missing.logistics, 1);
  assert.deepEqual(pack.missing.shipment, ["portOfLoading", "destinationCountry", "exportDate"]);
  assert.equal(pack.totals.unit, null, "mixed units name no total unit");
  assert.equal(pack.countryZh, "");
  assert.equal(pack.factories, "临沂某工厂、另一工厂");
});

test("the goods origin comes from the suppliers when the order names none", () => {
  const lines = [
    { ...base.lines[0], amount: 3000, supplier: "义乌天使", goodsOrigin: "浙江省金华市义乌市" },
    { ...base.lines[1], amount: 2000, supplier: "伟旭电子", goodsOrigin: "广东省深圳市宝安区" },
    { ...base.lines[1], amount: 1500, supplier: "越光", goodsOrigin: "浙江省金华市义乌市" },
    { ...base.lines[1], amount: 100, supplier: "无名", goodsOrigin: "" },
  ];
  const pack = buildCustomsPack({ ...base, goodsOrigin: "", lines });
  assert.equal(pack.goodsOrigin, "浙江省金华市义乌市", "the origin with the most money heads the declaration");
  assert.deepEqual(
    pack.lines.map((l) => l.goodsOrigin),
    ["浙江省金华市义乌市", "广东省深圳市宝安区", "浙江省金华市义乌市", "浙江省金华市义乌市"],
    "each line declares its own supplier's; an unknown one takes the header's",
  );
  assert.deepEqual(pack.missing.shipment, [], "a supplier's origin is enough");
  // The order's own word wins for the header; lines keep their suppliers'.
  const fixed = buildCustomsPack({ ...base, goodsOrigin: "浙江省义乌市", lines });
  assert.equal(fixed.goodsOrigin, "浙江省义乌市");
  assert.equal(fixed.lines[1].goodsOrigin, "广东省深圳市宝安区");
  assert.equal(fixed.lines[3].goodsOrigin, "浙江省义乌市");
  // Nobody knows: blank and named as missing.
  assert.deepEqual(buildCustomsPack({ ...base, goodsOrigin: "" }).missing.shipment, ["goodsOrigin"]);
});

test("the main origin weighs money, ties go to the first line", () => {
  assert.equal(mainGoodsOrigin([]), "");
  assert.equal(mainGoodsOrigin([{ goodsOrigin: "A", amount: 1 }, { goodsOrigin: "B", amount: 1 }]), "A");
  assert.equal(mainGoodsOrigin([{ goodsOrigin: " ", amount: 9 }, { goodsOrigin: "B", amount: 1 }]), "B");
});

test("shipping marks print line by line, N/M when the order has none", () => {
  assert.deepEqual(shippingMarkLines(""), ["N/M"]);
  assert.deepEqual(shippingMarkLines(" BLG-88 \n\n ORD-1\nPARAGUAY "), ["BLG-88", "ORD-1", "PARAGUAY"]);
  assert.deepEqual(buildCustomsPack({ ...base, shippingMarks: "BLG-88\nPARAGUAY" }).marks, ["BLG-88", "PARAGUAY"]);
});
