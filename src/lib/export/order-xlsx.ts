import ExcelJS from "exceljs";
import type { OrderExportData } from "./order-export";

const BRAND = "FFC2410C"; // brand-600, ARGB
const SUB = "FF6B7280";

/**
 * The order as a shareable spreadsheet — the same document as the proforma,
 * shaped for WeChat/WhatsApp: company header, bill-to, sell-price lines,
 * totals, bank details, and the validity footer. Sell prices only; the cost
 * never enters this file (see order-export.ts).
 */
export async function buildOrderXlsx(data: OrderExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = data.company.name;
  const ws = wb.addWorksheet(data.labels.title, {
    pageSetup: { paperSize: 9 /* A4 */, orientation: "portrait", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = [
    { width: 7 }, // line photo
    { width: 36 },
    { width: 14 },
    { width: 10 },
    { width: 10 },
    { width: 14 },
    { width: 16 },
  ];

  let r = 1;
  const set = (
    row: number,
    col: number,
    value: ExcelJS.CellValue,
    opts?: { bold?: boolean; size?: number; color?: string; align?: "left" | "right"; numFmt?: string },
  ) => {
    const cell = ws.getCell(row, col);
    cell.value = value;
    cell.font = {
      bold: opts?.bold ?? false,
      size: opts?.size ?? 10,
      color: opts?.color ? { argb: opts.color } : undefined,
    };
    if (opts?.align) cell.alignment = { horizontal: opts.align };
    if (opts?.numFmt) cell.numFmt = opts.numFmt;
    return cell;
  };

  // Company header
  set(r, 1, data.company.name, { bold: true, size: 16, color: BRAND });
  set(r, 6, data.labels.title, { bold: true, size: 14, align: "right" });
  ws.mergeCells(r, 6, r, 7);
  r += 1;
  for (const line of data.company.addressLines) set(r++, 1, line, { color: SUB });
  const contactBits = [
    data.company.phone && `${data.labels.phone}: ${data.company.phone}`,
    data.company.email && `${data.labels.email}: ${data.company.email}`,
    data.company.website && data.company.website,
    data.company.taxId && `${data.labels.taxId}: ${data.company.taxId}`,
  ].filter(Boolean) as string[];
  for (const bit of contactBits) set(r++, 1, bit, { color: SUB });

  // Document meta on the right, aligned with the top of the header block
  let metaRow = 2;
  set(metaRow, 6, data.labels.number, { color: SUB, align: "right" });
  set(metaRow++, 7, data.doc.number, { align: "right" });
  set(metaRow, 6, data.labels.date, { color: SUB, align: "right" });
  set(metaRow++, 7, data.doc.issuedOn, { align: "right" });
  if (data.doc.validUntil) {
    set(metaRow, 6, data.labels.validUntil, { color: SUB, align: "right" });
    set(metaRow++, 7, data.doc.validUntil, { align: "right" });
  }
  r = Math.max(r, metaRow) + 1;

  // Bill-to and terms. A quote exports with client=null, so neither block
  // prints — nothing is billed or agreed while the client is still deciding.
  if (data.client) {
    set(r, 1, data.labels.billTo.toUpperCase(), { bold: true, size: 9, color: SUB });
    set(r, 5, data.labels.terms.toUpperCase(), { bold: true, size: 9, color: SUB });
    r += 1;
    const left: string[] = [
      data.client.name,
      data.client.contactPerson && `${data.labels.attn}: ${data.client.contactPerson}`,
      data.client.phone && `${data.labels.phone}: ${data.client.phone}`,
      data.client.whatsapp && `WhatsApp: ${data.client.whatsapp}`,
      data.client.wechat && `WeChat: ${data.client.wechat}`,
    ].filter(Boolean) as string[];
    const right: string[] = [
      data.terms.incoterms && `${data.labels.incoterms}: ${data.terms.incoterms}`,
      `${data.labels.currency}: ${data.doc.currency}`,
      `${data.labels.totalCartons}: ${data.terms.totalCartons}`,
      `${data.labels.totalCbm}: ${data.terms.totalCbm} m³`,
      `${data.labels.totalWeight}: ${data.terms.totalWeightKg} kg`,
      ...data.terms.paymentTerms,
    ].filter(Boolean) as string[];
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (left[i]) set(r + i, 1, left[i], { bold: i === 0 });
      if (right[i]) set(r + i, 5, right[i]);
    }
    r += Math.max(left.length, right.length) + 1;
  }

  // Line items
  const header = [
    data.labels.photo,
    data.labels.item,
    data.labels.sku,
    data.labels.quantity,
    data.labels.cartons,
    data.labels.unitPrice,
    data.labels.amount,
  ];
  header.forEach((h, i) => {
    const cell = set(r, i + 1, h, { bold: true, size: 9, color: "FFFFFFFF", align: i >= 3 ? "right" : "left" });
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
  });
  r += 1;
  for (const line of data.lines) {
    // The name cell carries the supplier's own style number on a second line,
    // so the factory can match the row to their catalog at a glance.
    const nameCell = set(
      r,
      2,
      line.supplierCode ? `${line.name}\n${line.supplierCode}` : line.name,
    );
    nameCell.alignment = { ...nameCell.alignment, wrapText: true, vertical: "middle" };
    set(r, 3, line.sku, { color: SUB });
    set(r, 4, line.quantity, { align: "right" });
    set(r, 5, line.cartons ?? "—", { align: "right" });
    set(r, 6, line.unitPrice, { align: "right", numFmt: "#,##0.00" });
    set(r, 7, line.amount, { align: "right", numFmt: "#,##0.00" });
    if (line.thumb) {
      // Photo rows are taller so a 42px image fits; ext is in pixels.
      ws.getRow(r).height = 36;
      const imageId = wb.addImage({ buffer: line.thumb as never, extension: "jpeg" });
      ws.addImage(imageId, {
        tl: { col: 0.15, row: r - 1 + 0.08 } as never,
        ext: { width: 42, height: 42 },
        editAs: "oneCell",
      });
    }
    r += 1;
  }
  r += 1;

  // Totals
  const money = "#,##0.00";
  set(r, 6, data.labels.goodsSubtotal, { color: SUB, align: "right" });
  set(r++, 7, data.totals.goods, { align: "right", numFmt: money });
  if (data.totals.commissionPct > 0) {
    set(r, 6, `${data.labels.commissionAmount} (${data.totals.commissionPct}%)`, { color: SUB, align: "right" });
    set(r++, 7, data.totals.commission, { align: "right", numFmt: money });
  }
  set(r, 6, `${data.labels.grandTotal} (${data.doc.currency})`, { bold: true, align: "right" });
  set(r++, 7, data.totals.grandTotal, { bold: true, align: "right", numFmt: money });
  for (const eq of data.totals.equivalents) {
    set(r, 6, `${data.labels.equivalent} (${eq.currency})`, { color: SUB, align: "right" });
    set(r++, 7, eq.amount, { color: SUB, align: "right", numFmt: money });
  }
  r += 1;

  // Bank details
  if (data.bank) {
    set(r++, 1, data.labels.bankDetails.toUpperCase(), { bold: true, size: 9, color: SUB });
    const bankLines = [
      data.bank.accountName && `${data.labels.bankAccountName}: ${data.bank.accountName}`,
      data.bank.bankName && `${data.labels.bankName}: ${data.bank.bankName}`,
      data.bank.accountNumber && `${data.labels.bankAccountNumber}: ${data.bank.accountNumber}`,
      data.bank.swift && `${data.labels.bankSwift}: ${data.bank.swift}`,
      ...data.bank.addressLines,
    ].filter(Boolean) as string[];
    for (const line of bankLines) set(r++, 1, line);
    r += 1;
  }

  if (data.notes) {
    set(r++, 1, data.labels.notes.toUpperCase(), { bold: true, size: 9, color: SUB });
    for (const line of data.notes.split("\n")) set(r++, 1, line);
    r += 1;
  }

  // Validity footer — the quote expires; the file says so.
  if (data.doc.validityDays > 0) set(r++, 1, data.labels.validityNote, { color: SUB, size: 9 });
  for (const line of data.footerNote) set(r++, 1, line, { color: SUB, size: 9 });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
