import ExcelJS from "exceljs";
import type { CustomsPack } from "@/lib/customs-pack";

/**
 * The customs pack as the broker receives it: one workbook, six sheets,
 * laid out like the files Mbarete has filed with — 出货清单, inv, pck, 合同,
 * 报关单 — so the broker reads them without relearning anything, and the
 * 委托书 a forwarder asks for before declaring in Mbarete's name. Labels are
 * the fixed bilingual customs wording of those files, not app translations.
 * Blank cells are facts the order does not hold yet; the broker fills them.
 */

type Style = {
  bold?: boolean;
  size?: number;
  align?: "left" | "center" | "right";
  numFmt?: string;
  border?: boolean;
  wrap?: boolean;
};

const THIN = { style: "thin" as const };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const MONEY = "#,##0.00##";
const MEASURE = "#,##0.00#";

function put(ws: ExcelJS.Worksheet, ref: string, value: ExcelJS.CellValue, style: Style = {}) {
  const cell = ws.getCell(ref);
  cell.value = value === "" ? null : value;
  cell.font = { name: "SimSun", bold: style.bold ?? false, size: style.size ?? 10 };
  cell.alignment = { horizontal: style.align, vertical: "middle", wrapText: style.wrap };
  if (style.numFmt) cell.numFmt = style.numFmt;
  if (style.border) cell.border = BOX;
  return cell;
}

/** Merge a range and write its first cell. */
function band(ws: ExcelJS.Worksheet, range: string, value: ExcelJS.CellValue, style: Style = {}) {
  ws.mergeCells(range);
  return put(ws, range.split(":")[0], value, style);
}

/** The letterhead every sheet but the summary opens with. */
function letterhead(ws: ExcelJS.Worksheet, pack: CustomsPack, lastCol: string, withPhone = true) {
  band(ws, `A1:${lastCol}1`, pack.companyZh, { bold: true, size: 16, align: "center" });
  band(ws, `A2:${lastCol}2`, pack.companyEn.toUpperCase(), { bold: true, size: 12, align: "center" });
  band(ws, `A3:${lastCol}3`, pack.addressLines.join(" "), { size: 9, align: "center", wrap: true });
  if (withPhone) band(ws, `A4:${lastCol}4`, pack.phone ? `TEL: ${pack.phone}` : "", { size: 9, align: "center" });
  ws.getRow(3).height = 28;
}

/** The marks down column A from `row`, one line per row; returns the first row after them. */
function marksDown(ws: ExcelJS.Worksheet, pack: CustomsPack, row: number): number {
  pack.marks.forEach((line, i) => put(ws, `A${row + i}`, line, { size: 9 }));
  return row + pack.marks.length;
}

function summarySheet(wb: ExcelJS.Workbook, pack: CustomsPack) {
  const ws = wb.addWorksheet("出货清单");
  ws.columns = [16, 26, 10, 7, 11, 13, 18, 10, 12, 12, 11, 18].map((width) => ({ width }));
  put(ws, "A3", "合同号", { bold: true });
  put(ws, "B3", pack.docNo);
  put(ws, "E3", "开票工厂", { bold: true });
  band(ws, "F3:L3", pack.factories);
  put(ws, "A5", "收货人", { bold: true });
  band(ws, "B5:D5", pack.consignee);
  put(ws, "E5", "境内货源地", { bold: true });
  band(ws, "F5:L5", pack.goodsOrigin);
  put(ws, "A7", "装柜日期", { bold: true });
  put(ws, "B7", pack.exportDate);
  put(ws, "E7", "唛头", { bold: true });
  band(ws, "F7:L7", pack.marks.join(" / "), { wrap: true });
  put(ws, "A9", "目的港", { bold: true });
  put(ws, "B9", pack.portOfDestination);

  const head = ["中文品名", "英文品名", "数量", "单位", "单价", "总金额", "开票工厂", "箱数 CTNS", "毛重 KGS", "净重 KGS", "体积 CBM", "境内货源地"];
  head.forEach((h, i) => put(ws, `${String.fromCharCode(65 + i)}12`, h, { bold: true, border: true, align: "center", wrap: true }));
  let r = 13;
  for (const l of pack.lines) {
    put(ws, `A${r}`, l.nameZh, { border: true, wrap: true });
    put(ws, `B${r}`, l.nameEn, { border: true, wrap: true });
    put(ws, `C${r}`, l.quantity, { border: true, align: "right" });
    put(ws, `D${r}`, l.unitEn, { border: true, align: "center" });
    put(ws, `E${r}`, l.unitPrice, { border: true, align: "right", numFmt: MONEY });
    put(ws, `F${r}`, l.amount, { border: true, align: "right", numFmt: MONEY });
    put(ws, `G${r}`, l.supplier, { border: true, wrap: true });
    put(ws, `H${r}`, l.cartons ?? "", { border: true, align: "right" });
    put(ws, `I${r}`, l.grossKg || "", { border: true, align: "right", numFmt: MEASURE });
    put(ws, `J${r}`, l.netKg || "", { border: true, align: "right", numFmt: MEASURE });
    put(ws, `K${r}`, l.cbm || "", { border: true, align: "right", numFmt: MEASURE });
    put(ws, `L${r}`, l.goodsOrigin, { border: true, wrap: true });
    r += 1;
  }
  put(ws, `A${r}`, "合计 TOTAL", { bold: true, border: true });
  put(ws, `C${r}`, pack.totals.quantity, { bold: true, border: true, align: "right" });
  put(ws, `D${r}`, pack.totals.unit ? pack.lines[0].unitEn : "", { bold: true, border: true, align: "center" });
  put(ws, `F${r}`, pack.totals.amount, { bold: true, border: true, align: "right", numFmt: MONEY });
  put(ws, `H${r}`, pack.totals.cartons, { bold: true, border: true, align: "right" });
  put(ws, `I${r}`, pack.totals.grossKg, { bold: true, border: true, align: "right", numFmt: MEASURE });
  put(ws, `J${r}`, pack.totals.netKg, { bold: true, border: true, align: "right", numFmt: MEASURE });
  put(ws, `K${r}`, pack.totals.cbm, { bold: true, border: true, align: "right", numFmt: MEASURE });
  for (const c of ["B", "E", "G", "L"]) put(ws, `${c}${r}`, "", { border: true });
}

function invoiceSheet(wb: ExcelJS.Workbook, pack: CustomsPack) {
  const ws = wb.addWorksheet("inv");
  ws.columns = [14, 8, 6, 34, 10, 7, 13, 13, 6].map((width) => ({ width }));
  letterhead(ws, pack, "I");
  put(ws, "A7", "TO：", { bold: true });
  band(ws, "B7:D7", pack.consignee, { bold: true });
  band(ws, "E8:F9", "发     票", { bold: true, size: 16, align: "center" });
  band(ws, "E10:F11", "INVOICE", { bold: true, size: 16, align: "center" });
  put(ws, "G9", "发票号码");
  put(ws, "G10", "Invoice Number");
  band(ws, "H10:I10", pack.docNo);
  put(ws, "G11", "日期");
  put(ws, "G12", "Date");
  band(ws, "H12:I12", pack.exportDate);
  put(ws, "G13", "付款方式");
  put(ws, "G14", "Payment");
  band(ws, "H14:I14", pack.payment);

  band(ws, "A16:B16", "唛头号码", { bold: true, align: "center" });
  band(ws, "A17:B17", "Marks & Numbers", { bold: true, align: "center" });
  band(ws, "C16:F16", "数量与品名", { bold: true, align: "center" });
  band(ws, "C17:F17", "Quantities and Descriptions", { bold: true, align: "center" });
  put(ws, "G16", "单价", { bold: true, align: "center" });
  put(ws, "G17", `Unit Price (${pack.currency})`, { bold: true, align: "center" });
  put(ws, "H16", "总价", { bold: true, align: "center" });
  put(ws, "H17", `Amount (${pack.currency})`, { bold: true, align: "center" });
  let r = 19;
  const afterMarks = marksDown(ws, pack, 19);
  for (const l of pack.lines) {
    put(ws, `D${r}`, l.nameEn, { wrap: true });
    put(ws, `E${r}`, l.quantity, { align: "right" });
    put(ws, `F${r}`, l.unitEn);
    put(ws, `G${r}`, l.unitPrice, { align: "right", numFmt: MONEY });
    put(ws, `H${r}`, l.amount, { align: "right", numFmt: MONEY });
    r += 1;
  }
  r = Math.max(r, afterMarks) + 1;
  put(ws, `G${r}`, "TOTAL:", { bold: true, align: "right" });
  put(ws, `H${r}`, pack.totals.amount, { bold: true, align: "right", numFmt: MONEY });
  put(ws, `I${r}`, pack.currency, { bold: true });
  if (pack.incoterms) put(ws, `D${r + 2}`, `${pack.incoterms} ${pack.portOfLoading}`.trim());
}

function packingSheet(wb: ExcelJS.Workbook, pack: CustomsPack) {
  const ws = wb.addWorksheet("pck");
  ws.columns = [14, 30, 9, 6, 8, 5, 11, 5, 11, 5, 10, 5].map((width) => ({ width }));
  letterhead(ws, pack, "L");
  band(ws, "B6:G7", "装箱单", { bold: true, size: 16, align: "center" });
  band(ws, "B9:G10", "PACKING LIST", { bold: true, size: 16, align: "center" });
  band(ws, "I7:J7", "发票号码");
  band(ws, "I8:J8", "Invoice Number");
  band(ws, "K8:L8", pack.docNo);
  band(ws, "I9:J9", "日期");
  band(ws, "I10:J10", "Date");
  band(ws, "K10:L10", pack.exportDate);

  put(ws, "A12", "唛头号码", { bold: true, align: "center" });
  put(ws, "A13", "Marks & Numbers", { bold: true, align: "center" });
  band(ws, "B12:D12", "品名和数量", { bold: true, align: "center" });
  band(ws, "B13:D13", "Descriptions and Quantities", { bold: true, align: "center" });
  band(ws, "E12:F12", "件数", { bold: true, align: "center" });
  band(ws, "E13:F13", "CTN", { bold: true, align: "center" });
  band(ws, "G12:H12", "毛重", { bold: true, align: "center" });
  band(ws, "G13:H13", "G.W.(KGS)", { bold: true, align: "center" });
  band(ws, "I12:J12", "净重", { bold: true, align: "center" });
  band(ws, "I13:J13", "N.W.(KGS)", { bold: true, align: "center" });
  band(ws, "K12:L12", "体积", { bold: true, align: "center" });
  band(ws, "K13:L13", "MEAS(CBM)", { bold: true, align: "center" });
  let r = 15;
  const afterMarks = marksDown(ws, pack, 15);
  for (const l of pack.lines) {
    put(ws, `B${r}`, l.nameEn, { wrap: true });
    put(ws, `C${r}`, l.quantity, { align: "right" });
    put(ws, `D${r}`, l.unitEn);
    put(ws, `E${r}`, l.cartons ?? "", { align: "right" });
    put(ws, `F${r}`, "CTN");
    put(ws, `G${r}`, l.grossKg || "", { align: "right", numFmt: MEASURE });
    put(ws, `H${r}`, "KGS");
    put(ws, `I${r}`, l.netKg || "", { align: "right", numFmt: MEASURE });
    put(ws, `J${r}`, "KGS");
    put(ws, `K${r}`, l.cbm || "", { align: "right", numFmt: MEASURE });
    put(ws, `L${r}`, "CBM");
    r += 1;
  }
  r = Math.max(r, afterMarks) + 1;
  put(ws, `B${r}`, "TOTAL:", { bold: true, align: "right" });
  put(ws, `C${r}`, pack.totals.quantity, { bold: true, align: "right" });
  put(ws, `D${r}`, pack.totals.unit ? pack.lines[0].unitEn : "", { bold: true });
  put(ws, `E${r}`, pack.totals.cartons, { bold: true, align: "right" });
  put(ws, `F${r}`, "CTN", { bold: true });
  put(ws, `G${r}`, pack.totals.grossKg, { bold: true, align: "right", numFmt: MEASURE });
  put(ws, `H${r}`, "KGS", { bold: true });
  put(ws, `I${r}`, pack.totals.netKg, { bold: true, align: "right", numFmt: MEASURE });
  put(ws, `J${r}`, "KGS", { bold: true });
  put(ws, `K${r}`, pack.totals.cbm, { bold: true, align: "right", numFmt: MEASURE });
  put(ws, `L${r}`, "CBM", { bold: true });
}

function contractSheet(wb: ExcelJS.Workbook, pack: CustomsPack) {
  const ws = wb.addWorksheet("合同");
  ws.columns = [14, 14, 14, 10, 10, 10, 7, 13, 8, 13].map((width) => ({ width }));
  // The contract opens with its title where the other sheets carry the phone.
  letterhead(ws, pack, "J", false);
  band(ws, "A4:J4", "售  货  合  同", { bold: true, size: 16, align: "center" });
  band(ws, "A5:J5", "SALES CONTRACT", { bold: true, size: 14, align: "center" });
  put(ws, "H6", "合同号码:");
  put(ws, "A7", "买   方:", { bold: true });
  band(ws, "B7:F7", pack.consignee, { bold: true });
  put(ws, "H7", "Contract No.:");
  band(ws, "I7:J7", pack.docNo);
  put(ws, "A8", "Buyer:");
  put(ws, "H8", "日期:");
  put(ws, "H9", "Date");
  band(ws, "I9:J9", pack.contractDate);
  put(ws, "H10", "签约地点");
  put(ws, "A11", "卖    方:", { bold: true });
  band(ws, "B11:F11", pack.companyEn.toUpperCase(), { bold: true });
  put(ws, "H11", "Concluded at:");
  band(ws, "I11:J11", /yiwu|义乌/i.test(`${pack.companyEn}${pack.addressLines.join(" ")}`) ? "YIWU" : "");
  put(ws, "A12", "Seller:");
  band(ws, "A13:J13", "      双方同意按下列条款由买方购进卖方售出下列货物");
  band(ws, "A14:J14", "      The Buyer agrees to buy and the Seller agrees to sell the undermentioned commodity on terms and conditions as set forth below:", { wrap: true });
  ws.getRow(14).height = 28;

  band(ws, "A15:E15", "(1)  货物名称、规格、包装及装运唛头", { bold: true, border: true });
  band(ws, "A16:E16", "Name of Commodity Specifications Packing and Shipping Marks", { bold: true, border: true, wrap: true });
  band(ws, "F15:G15", "(2)  数 量", { bold: true, border: true, align: "center" });
  band(ws, "F16:G16", "Quantity", { bold: true, border: true, align: "center" });
  put(ws, "H15", "(3)  单 价", { bold: true, border: true, align: "center" });
  put(ws, "H16", "Unit price", { bold: true, border: true, align: "center" });
  band(ws, "I15:J15", "(4)  总 值", { bold: true, border: true, align: "center" });
  band(ws, "I16:J16", "Total Amount", { bold: true, border: true, align: "center" });
  let r = 18;
  for (const l of pack.lines) {
    band(ws, `A${r}:E${r}`, l.nameEn, { wrap: true });
    put(ws, `F${r}`, l.quantity, { align: "right" });
    put(ws, `G${r}`, l.unitEn);
    put(ws, `H${r}`, l.unitPrice, { align: "right", numFmt: MONEY });
    put(ws, `I${r}`, pack.currency);
    put(ws, `J${r}`, l.amount, { align: "right", numFmt: MONEY });
    r += 1;
  }
  r += 1;
  put(ws, `H${r}`, "TOTAL:", { bold: true, align: "right" });
  put(ws, `I${r}`, pack.currency, { bold: true });
  put(ws, `J${r}`, pack.totals.amount, { bold: true, align: "right", numFmt: MONEY });
  if (pack.incoterms) put(ws, `A${r}`, `${pack.incoterms} ${pack.portOfLoading}`.trim(), { bold: true });
  r += 1;
  band(ws, `A${r}:J${r}`, `Shipping Marks 唛头: ${pack.marks.join(" / ")}`, { wrap: true });

  r += 3;
  put(ws, `A${r}`, "(1) 装运期限", { bold: true });
  put(ws, `E${r}`, "(6) 装运数量允许有  5    %的增减", { bold: true });
  put(ws, `A${r + 1}`, "Shipment:");
  put(ws, `B${r + 1}`, pack.exportDate);
  put(ws, `E${r + 1}`, "Shipment quantity     5     % more or less allowed.");
  put(ws, `A${r + 2}`, "(2) 装运口岸", { bold: true });
  put(ws, `E${r + 2}`, "(8) 目的港", { bold: true });
  put(ws, `A${r + 3}`, "Port of loading:");
  put(ws, `B${r + 3}`, pack.portOfLoading);
  put(ws, `E${r + 3}`, "Port of Destination:");
  put(ws, `G${r + 3}`, pack.portOfDestination);
  r += 4;
  // The order's notes are the terms the proforma already carried (FOB,
  // inspection, freight); the contract restates them.
  put(ws, `A${r}`, "(3) 运费及其他条款", { bold: true });
  r += 1;
  for (const line of pack.notes.split("\n").map((s) => s.trim()).filter(Boolean)) {
    band(ws, `A${r}:J${r}`, line, { wrap: true });
    r += 1;
  }
  put(ws, `A${r}`, "(4) 付款 方式", { bold: true });
  r += 1;
  band(ws, `A${r}:J${r}`, `Payment:                                ${pack.paymentTerms[0] ?? pack.payment}`);
  r += 3;
  put(ws, `A${r}`, "卖方签字盖章", { bold: true });
  put(ws, `F${r}`, "买方签字", { bold: true });
  put(ws, `A${r + 1}`, "The seller's signature:");
  put(ws, `F${r + 1}`, "The buyer's signature:");
}

function declarationSheet(wb: ExcelJS.Workbook, pack: CustomsPack) {
  const ws = wb.addWorksheet("报关单");
  ws.columns = [6, 8, 8, 8, 8, 8, 8, 13, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8].map((width) => ({ width }));
  band(ws, "A1:R1", "中华人民共和国海关出口货物报关单（草稿）", { bold: true, size: 14, align: "center" });
  band(ws, "A3:I3", "预录入编号：");
  band(ws, "J3:R3", `海关编号：${pack.customsDeclarationNo}`);

  // Header grid: label row, value row, as on the paper form.
  const grid: [string, string, string][][] = [
    [["A4:H4", "出口口岸", ""], ["I4:K4", "备案号", ""], ["L4:O4", "出口日期：", ""], ["P4:R4", "申报日期", ""]],
    [["A5:H5", "", pack.portOfLoading], ["I5:K5", "", ""], ["L5:O5", "", pack.exportDate], ["P5:R5", "", ""]],
    [["A6:F6", "生产销售单位：", ""], ["G6:H6", "运输方式", ""], ["I6:L6", "运输工具名称：", ""], ["N6:R6", "提运单号", ""]],
    [["A7:F7", "", pack.companyZh], ["G7:H7", "", "水路运输"], ["I7:L7", "", ""], ["N7:R7", "", ""]],
    [["A8:F8", "发货单位:", ""], ["G8:J8", "贸易方式", ""], ["K8:N8", "征免性质", ""], ["O8:R8", "结汇方式", ""]],
    [["A9:F9", "", pack.companyZh], ["G9:J9", "", "一般贸易 0110"], ["K9:N9", "", "一般征税"], ["O9:R9", "", pack.payment.replace("/", "")]],
    [["A10:E10", "许可证号", ""], ["F10:I10", "运抵国（地区）", ""], ["J10:N10", "指运港", ""], ["O10:R10", "境内货源地", ""]],
    [["A11:E11", "", ""], ["F11:I11", "", pack.countryZh], ["J11:N11", "", pack.portOfDestination], ["O11:R11", "", pack.goodsOrigin]],
    [["A12:E12", "批准文号(核销单号）", ""], ["F12:H12", "成交方式", ""], ["I12:K12", "运费", ""], ["L12:N12", "保费", ""], ["O12:R12", "杂费", ""]],
    [["A13:E13", "", ""], ["F13:H13", "", pack.incoterms], ["I13:K13", "", ""], ["L13:N13", "", ""], ["O13:R13", "", ""]],
    [["A14:E14", "合同协议号", ""], ["F14:H14", "件数", ""], ["I14:K14", "包装种类", ""], ["L14:N14", "毛重（千克）", ""], ["O14:R14", "净重（千克）", ""]],
  ];
  for (const row of grid) {
    for (const [range, label, value] of row) band(ws, range, label || value, { border: true, bold: !!label, size: label ? 9 : 10 });
  }
  const valueRow15: [string, ExcelJS.CellValue][] = [
    ["A15:E15", pack.docNo],
    ["F15:H15", pack.totals.cartons],
    ["I15:K15", "纸箱"],
    ["L15:N15", pack.totals.grossKg],
    ["O15:R15", pack.totals.netKg],
  ];
  for (const [range, value] of valueRow15) band(ws, range, value, { border: true, align: typeof value === "number" ? "right" : undefined });
  band(ws, "A16:E16", "集装箱号", { border: true, bold: true, size: 9 });
  band(ws, "F16:N16", "随附单据", { border: true, bold: true, size: 9 });
  band(ws, "O16:R16", "生产厂家", { border: true, bold: true, size: 9 });
  band(ws, "A17:E17", "", { border: true });
  band(ws, "F17:N17", "", { border: true });
  band(ws, "O17:R17", pack.factories, { border: true, wrap: true });
  band(ws, "A18:R18", "标记唛码及备注", { border: true, bold: true, size: 9 });
  band(ws, "A19:R19", pack.marks.join("  "), { border: true, wrap: true });

  const head: [string, string][] = [
    ["A21:A21", "项号"], ["B21:C21", "商品编号"], ["D21:G21", "商品名称、规格型号"], ["H21:H21", "境内货源地"], ["I21:J21", "数量及单位"],
    ["K21:L21", "最终目的国"], ["M21:N21", "单价"], ["O21:P21", "总价"], ["Q21:Q21", "币制"], ["R21:R21", "征免"],
  ];
  for (const [range, label] of head) {
    if (range.split(":")[0] === range.split(":")[1]) put(ws, range.split(":")[0], label, { bold: true, border: true, align: "center", size: 9 });
    else band(ws, range, label, { bold: true, border: true, align: "center", size: 9 });
  }
  let r = 22;
  pack.lines.forEach((l, i) => {
    put(ws, `A${r}`, i + 1, { border: true, align: "center" });
    band(ws, `B${r}:C${r}`, l.cnHsCode, { border: true });
    band(ws, `D${r}:G${r}`, l.nameZh, { border: true, wrap: true });
    put(ws, `H${r}`, l.goodsOrigin, { border: true, wrap: true, size: 9 });
    put(ws, `I${r}`, l.quantity, { border: true, align: "right" });
    put(ws, `J${r}`, l.unitZh, { border: true, align: "center" });
    band(ws, `K${r}:L${r}`, pack.countryZh, { border: true, align: "center" });
    band(ws, `M${r}:N${r}`, l.unitPrice, { border: true, align: "right", numFmt: MONEY });
    band(ws, `O${r}:P${r}`, l.amount, { border: true, align: "right", numFmt: MONEY });
    put(ws, `Q${r}`, pack.currency, { border: true, align: "center" });
    put(ws, `R${r}`, "照章征税", { border: true, align: "center", size: 9 });
    r += 1;
  });
  r += 1;
  // 申报要素: one line per item, numbered like the items above.
  pack.lines.forEach((l, i) => {
    band(ws, `A${r}:R${r}`, `${i + 1}. 申报要素：${l.declarationElements}`, { wrap: true });
    r += 1;
  });
  r += 2;
  put(ws, `A${r}`, "录入员", { size: 9 });
  put(ws, `C${r}`, "录入单位", { size: 9 });
  band(ws, `E${r}:K${r}`, "兹声明以上申报无讹并承担法律责任", { size: 9 });
  band(ws, `L${r}:R${r}`, "海关审单批注及放行日期（签章）", { size: 9 });
  put(ws, `A${r + 2}`, "报关员", { size: 9 });
  put(ws, `L${r + 2}`, "审单", { size: 9 });
  band(ws, `E${r + 3}:K${r + 3}`, "申报单位（签章）", { size: 9 });
}

/**
 * 代理报关委托书 and 委托报关协议: the letter a forwarder needs before it can
 * declare in Mbarete's name, in the customs brokers' association's standard
 * wording. The seller's half is filled from the order; the forwarder's half,
 * the choices and the stamps stay for the people who sign.
 */
function attorneySheet(wb: ExcelJS.Workbook, pack: CustomsPack) {
  const ws = wb.addWorksheet("委托书");
  ws.columns = [14, 12, 12, 12, 14, 12, 12, 12].map((width) => ({ width }));
  const main = [...pack.lines].sort((a, b) => b.amount - a.amount)[0];
  const total = `${pack.currency} ${pack.totals.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const blankDate = "        年      月      日";

  band(ws, "A1:H1", "代理报关委托书", { bold: true, size: 16, align: "center" });
  band(ws, "E2:H2", `编号：${pack.docNo}`, { align: "right" });
  band(
    ws,
    "A4:H6",
    "        我单位现  A  （A.逐票  B.长期）委托贵公司代理  ________  （A.填单申报  B.辅助查验  C.垫缴税款  D.办理海关证明联  E.审批手册  F.核销手册  G.申办减免税手续  H.其他）等通关事宜，详见《委托报关协议》。",
    { wrap: true },
  );
  band(ws, "A7:H8", "        我单位保证遵守《海关法》和国家有关法规，保证所提供的情况真实、完整、单货相符。否则，愿承担相关法律责任。", { wrap: true });
  band(ws, "A9:H9", `        本委托书有效期自签字之日起至${blankDate}止。`);
  band(ws, "E11:H11", `委托方（盖章）：${pack.companyZh}`);
  band(ws, "E12:H13", "法定代表人或其授权签署《代理报关委托书》的人（签字）：", { wrap: true });
  band(ws, "E14:H14", blankDate);

  band(ws, "A16:H16", "委托报关协议", { bold: true, size: 14, align: "center" });
  band(ws, "A17:H17", "        为明确委托报关具体事项和各自责任，双方经平等协商签定协议如下：");
  const rows: [string, ExcelJS.CellValue, string, ExcelJS.CellValue][] = [
    ["委托方", pack.companyZh, "被委托方", ""],
    ["主要货物名称", main ? `${main.nameZh}${pack.lines.length > 1 ? " 等" : ""}` : "", "*报关单编码", `No. ${pack.customsDeclarationNo}`],
    ["HS编码", main?.cnHsCode ?? "", "收到单证日期", blankDate],
    ["货物总价", total, "收到单证情况", "合同□  发票□  装箱清单□  提（运）单□  加工贸易手册□  许可证件□  其他"],
    ["进出口日期", pack.exportDate, "报关收费", "人民币：            元"],
    ["提单号", "", "承诺说明", ""],
    ["贸易方式", "一般贸易", "", ""],
    ["原产地/货源地", pack.goodsOrigin, "", ""],
    ["传真电话", pack.phone, "", ""],
    ["其他要求", "", "", ""],
  ];
  let r = 18;
  for (const [leftLabel, leftValue, rightLabel, rightValue] of rows) {
    put(ws, `A${r}`, leftLabel, { bold: true, border: true, size: 9 });
    band(ws, `B${r}:D${r}`, leftValue, { border: true, wrap: true });
    put(ws, `E${r}`, rightLabel, { bold: true, border: true, size: 9 });
    band(ws, `F${r}:H${r}`, rightValue, { border: true, wrap: true, size: 9 });
    ws.getRow(r).height = 22;
    r += 1;
  }
  const terms = "背面所列通用条款是本协议不可分割的一部分，对本协议的签署构成了对背面通用条款的同意。";
  band(ws, `A${r}:D${r + 1}`, terms, { border: true, wrap: true, size: 9 });
  band(ws, `E${r}:H${r + 1}`, terms, { border: true, wrap: true, size: 9 });
  r += 2;
  band(ws, `A${r}:D${r}`, "委托方业务签章：", { border: true });
  band(ws, `E${r}:H${r}`, "被委托方业务签章：", { border: true });
  band(ws, `A${r + 1}:D${r + 1}`, "经办人签章：", { border: true });
  band(ws, `E${r + 1}:H${r + 1}`, "经办报关员签章：", { border: true });
  band(ws, `A${r + 2}:D${r + 2}`, `联系电话：${pack.phone}${blankDate}`, { border: true });
  band(ws, `E${r + 2}:H${r + 2}`, `联系电话：${blankDate}`, { border: true });
}

export async function buildCustomsPackXlsx(pack: CustomsPack): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = pack.companyEn;
  summarySheet(wb, pack);
  invoiceSheet(wb, pack);
  packingSheet(wb, pack);
  contractSheet(wb, pack);
  declarationSheet(wb, pack);
  attorneySheet(wb, pack);
  for (const ws of wb.worksheets) {
    ws.pageSetup = { paperSize: 9, orientation: ws.name === "报关单" || ws.name === "出货清单" ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
