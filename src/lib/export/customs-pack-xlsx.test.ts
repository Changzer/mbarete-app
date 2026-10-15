import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildCustomsPack } from "../customs-pack";
import { buildCustomsPackXlsx } from "./customs-pack-xlsx";

const pack = buildCustomsPack({
  docNo: "ORD-20260524-001",
  contractDate: "2026-03-10",
  exportDate: "2026-05-24",
  customsDeclarationNo: "",
  companyName: "义乌玻汭进出口有限公司 | Yiwu Mbarete Import Export Co. Ltd.",
  addressLines: ["浙江省义乌市", "Room 1452"],
  phone: "+8619550534361",
  consignee: "JOTA TRADING SA.",
  incoterms: "FOB",
  paymentTerms: ["100% T/T"],
  notes: "The seller shall bear all transportation costs from domestic to designated overseas warehouses.",
  currency: "USD",
  portOfLoading: "Qingdao, CN",
  portOfDestination: "Montevideo, UY",
  destinationCountry: "PY",
  goodsOrigin: "山东省临沂市",
  lines: [
    {
      nameZh: "TPE环保汽车脚垫", nameEn: "TPE Car Floor Mats", cnHsCode: "3918909000",
      declarationElements: "脚垫，无品牌，热塑性弹性体，型号无，主要用于车内", unit: "set",
      quantity: 2200, unitPrice: 21.0232, amount: 46251, cartons: 225, grossKg: 10686.5, cbm: 50.77, supplier: "临沂某工厂",
    },
  ],
});

async function load() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildCustomsPackXlsx(pack)) as unknown as ArrayBuffer);
  return wb;
}

const text = (ws: ExcelJS.Worksheet) => {
  const out: string[] = [];
  ws.eachRow((row) => row.eachCell((c) => out.push(String(c.value ?? ""))));
  return out.join(" | ");
};

test("the pack has the broker's five sheets, in their order", async () => {
  const wb = await load();
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["出货清单", "inv", "pck", "合同", "报关单"]);
});

test("the declaration carries China's code, the Chinese name, unit, country and elements", async () => {
  const ws = (await load()).getWorksheet("报关单")!;
  assert.equal(ws.getCell("B22").value, "3918909000");
  assert.equal(ws.getCell("D22").value, "TPE环保汽车脚垫");
  assert.equal(ws.getCell("I22").value, 2200);
  assert.equal(ws.getCell("J22").value, "套");
  assert.equal(ws.getCell("K22").value, "巴拉圭");
  assert.equal(ws.getCell("O22").value, 46251);
  const all = text(ws);
  for (const fact of ["义乌玻汭进出口有限公司", "Qingdao, CN", "Montevideo, UY", "山东省临沂市", "FOB", "一般贸易 0110", "申报要素：脚垫，无品牌", "临沂某工厂"]) {
    assert.ok(all.includes(fact), `declaration names ${fact}`);
  }
  assert.equal(ws.getCell("F15").value, 225, "packages");
  assert.equal(ws.getCell("L15").value, 10686.5, "gross weight");
});

test("invoice, packing list and contract foot to the same totals", async () => {
  const wb = await load();
  const inv = text(wb.getWorksheet("inv")!);
  assert.ok(inv.includes("JOTA TRADING SA.") && inv.includes("TPE Car Floor Mats") && inv.includes("46251"));
  const pck = text(wb.getWorksheet("pck")!);
  assert.ok(pck.includes("PACKING LIST") && pck.includes("225") && pck.includes("10686.5") && pck.includes("50.77"));
  const contract = text(wb.getWorksheet("合同")!);
  assert.ok(contract.includes("SALES CONTRACT") && contract.includes("2026-03-10") && contract.includes("YIWU"));
  assert.ok(contract.includes("The seller shall bear all transportation costs"), "the order's terms restated");
  const summary = text(wb.getWorksheet("出货清单")!);
  assert.ok(summary.includes("临沂某工厂") && summary.includes("2026-05-24"));
});
