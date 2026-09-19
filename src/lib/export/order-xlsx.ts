import ExcelJS from "exceljs";
import type { OrderExportData } from "./order-export";

const BRAND = "FFC2410C"; // brand-600, ARGB
// Secondary text stays dark enough to read as black when printed.
const SUB = "FF3D3D3D";

/**
 * The order as a packing list — the spreadsheet the forwarder and the
 * warehouse work from: company header, one line per product with its
 * photo, SKU, quantity, cartons, and the volume and weight per carton and
 * for the line, then the shipment totals. No prices and no bank details:
 * money lives on the proforma (the PDF); this file is about the boxes.
 */
export async function buildOrderXlsx(data: OrderExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = data.company.name;
  const ws = wb.addWorksheet(data.labels.packingListTitle, {
    pageSetup: { paperSize: 9 /* A4 */, orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  ws.columns = [
    { width: 7 }, // line photo
    { width: 40 },
    { width: 12 },
    { width: 9 },
    { width: 9 },
    { width: 11 },
    { width: 12 },
    { width: 10 },
    { width: 11 },
  ];
  const LAST = 9;

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

  // Company header — the document title anchors the top right; the tenant's
  // logo (when uploaded) takes the first row and the name follows beneath it,
  // exactly like the on-screen letterhead. No logo = the original layout.
  set(r, LAST - 1, data.labels.packingListTitle, { bold: true, size: 14, align: "right" });
  ws.mergeCells(r, LAST - 1, r, LAST);
  if (data.company.logo) {
    const logo = data.company.logo;
    const scale = Math.min(150 / logo.width, 42 / logo.height, 1);
    const w = Math.round(logo.width * scale);
    const h = Math.round(logo.height * scale);
    const imageId = wb.addImage({ buffer: logo.data as never, extension: "png" });
    ws.addImage(imageId, {
      tl: { col: 0.05, row: r - 1 + 0.05 } as never,
      ext: { width: w, height: h },
      editAs: "oneCell",
    });
    // Row heights are points; the image extent is pixels (≈ 0.75 pt/px).
    ws.getRow(r).height = Math.max(30, h * 0.75 + 4);
    r += 1;
  }
  set(r, 1, data.company.name, { bold: true, size: 16, color: BRAND });
  r += 1;
  for (const line of data.company.addressLines) set(r++, 1, line, { color: SUB });
  const contactBits = [
    data.company.phone && `${data.labels.phone}: ${data.company.phone}`,
    data.company.email && `${data.labels.email}: ${data.company.email}`,
    data.company.website && data.company.website,
    data.company.taxId && `${data.labels.taxId}: ${data.company.taxId}`,
  ].filter(Boolean) as string[];
  for (const bit of contactBits) set(r++, 1, bit, { color: SUB });

  // Document meta on the right: the order's number and date. No validity —
  // a packing list describes the goods, it does not expire.
  let metaRow = 2;
  set(metaRow, LAST - 1, data.labels.number, { color: SUB, align: "right" });
  set(metaRow++, LAST, data.doc.number, { align: "right" });
  set(metaRow, LAST - 1, data.labels.date, { color: SUB, align: "right" });
  set(metaRow++, LAST, data.doc.issuedOn, { align: "right" });
  r = Math.max(r, metaRow) + 1;

  // Consignee: on a confirmed order the client is known; a draft names none.
  if (data.client) {
    set(r++, 1, data.labels.consignee.toUpperCase(), { bold: true, size: 9, color: SUB });
    const left = [
      data.client.name,
      data.client.address,
      data.client.contactPerson && `${data.labels.attn}: ${data.client.contactPerson}`,
      data.client.phone && `${data.labels.phone}: ${data.client.phone}`,
    ].filter(Boolean) as string[];
    left.forEach((line, i) => set(r + i, 1, line, { bold: i === 0 }));
    r += left.length + 1;
  }

  // Line items
  const header = [
    data.labels.photo,
    data.labels.item,
    data.labels.sku,
    data.labels.quantity,
    data.labels.cartons,
    data.labels.cbmPerCarton,
    data.labels.lineCbm,
    data.labels.kgPerCarton,
    data.labels.lineKg,
  ];
  header.forEach((h, i) => {
    const cell = set(r, i + 1, h, { bold: true, size: 9, color: "FFFFFFFF", align: i >= 3 ? "right" : "left" });
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
  });
  r += 1;
  // Volume to the litre, weight to the gram: what the figures are recorded in.
  const cbm = "0.000";
  const kg = "0.000";
  let totalCartons = 0;
  let totalCbm = 0;
  let totalKg = 0;
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
    // An unmeasured carton shows as a dash, never as a zero that sums quietly.
    set(r, 6, line.cartonCbm > 0 ? line.cartonCbm : "—", { align: "right", numFmt: cbm });
    set(r, 7, line.lineCbm > 0 ? line.lineCbm : "—", { align: "right", numFmt: cbm });
    set(r, 8, line.cartonWeightKg > 0 ? line.cartonWeightKg : "—", { align: "right", numFmt: kg });
    set(r, 9, line.lineWeightKg > 0 ? line.lineWeightKg : "—", { align: "right", numFmt: kg });
    totalCartons += line.cartons ?? 0;
    totalCbm += line.lineCbm;
    totalKg += line.lineWeightKg;
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

  // Shipment totals under their own columns, so the sheet foots by eye.
  set(r, 2, data.labels.totalCartons, { bold: true, align: "right" });
  set(r, 5, totalCartons, { bold: true, align: "right" });
  // A shipment nobody has measured yet totals to a dash, not a false zero.
  set(r, 7, totalCbm > 0 ? Math.round(totalCbm * 1000) / 1000 : "—", { bold: true, align: "right", numFmt: cbm });
  set(r, 9, totalKg > 0 ? Math.round(totalKg * 1000) / 1000 : "—", { bold: true, align: "right", numFmt: kg });
  ws.getRow(r).border = { top: { style: "thin" } };
  r += 2;

  for (const line of data.footerNote) set(r++, 1, line, { color: SUB, size: 9 });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
