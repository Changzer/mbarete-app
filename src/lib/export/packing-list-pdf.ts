import type { OrderExportData } from "./order-export";
import { BRAND, INK, LINE, MARGIN, SUB, drawLetterhead, hrule, openPdf, pageFor } from "./pdf-common";

/**
 * The packing list as a landscape A4 PDF — the same document as the
 * spreadsheet, for the forwarder who wants a file that prints as is:
 * letterhead, consignee once the order is confirmed, one line per product
 * with photo, SKU, quantity, cartons, and volume and weight per carton and
 * for the line, then the shipment totals. Never a price.
 */
const PAGE = pageFor("landscape");
const INNER = PAGE.inner;

export async function buildPackingListPdf(data: OrderExportData): Promise<Buffer> {
  const { doc, done } = openPdf("landscape");
  const hr = (y: number, color = LINE, width = 0.7) => hrule(doc, PAGE, y, color, width);
  const ensure = (need: number) => {
    if (doc.y + need > PAGE.height - MARGIN) doc.addPage();
  };
  // Volume to the litre, weight to the gram; a dash where nothing was measured.
  const fig = (n: number) => (n > 0 ? n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—");

  drawLetterhead(doc, PAGE, data, data.labels.packingListTitle, [
    `${data.labels.number}: ${data.doc.number}`,
    `${data.labels.date}: ${data.doc.issuedOn}`,
  ]);

  if (data.client) {
    doc.font("bold").fontSize(8).fillColor(SUB).text(data.labels.consignee.toUpperCase(), MARGIN, doc.y);
    doc.font("bold").fontSize(10).fillColor(INK).text(data.client.name || "—", { width: INNER * 0.5 });
    doc.font("regular").fontSize(8.5).fillColor(SUB);
    const bits = [
      data.client.address,
      data.client.contactPerson && `${data.labels.attn}: ${data.client.contactPerson}`,
      data.client.phone && `${data.labels.phone}: ${data.client.phone}`,
    ].filter(Boolean) as string[];
    for (const bit of bits) doc.text(bit, { width: INNER * 0.5 });
    doc.y += 12;
    hr(doc.y);
    doc.y += 10;
  }

  // Nine columns across the landscape page; the photo leads.
  const PHOTO = 30;
  const numW = 62;
  const right = MARGIN + INNER;
  const cols = [
    { label: data.labels.photo, x: MARGIN, w: PHOTO + 4, align: "left" as const },
    { label: data.labels.item, x: MARGIN + PHOTO + 8, w: 0, align: "left" as const },
    { label: data.labels.sku, x: 0, w: 66, align: "left" as const },
    { label: data.labels.quantity, x: 0, w: 48, align: "right" as const },
    { label: data.labels.cartons, x: 0, w: 48, align: "right" as const },
    { label: data.labels.cbmPerCarton, x: 0, w: numW, align: "right" as const },
    { label: data.labels.lineCbm, x: 0, w: numW, align: "right" as const },
    { label: data.labels.kgPerCarton, x: 0, w: numW, align: "right" as const },
    { label: data.labels.lineKg, x: 0, w: numW, align: "right" as const },
  ];
  // Fixed columns pack against the right edge; the description takes the rest.
  let x = right;
  for (let i = cols.length - 1; i >= 2; i--) {
    x -= cols[i].w + 4;
    cols[i].x = x;
  }
  cols[1].w = cols[2].x - cols[1].x - 4;

  const tableHeader = () => {
    const y = doc.y;
    doc.rect(MARGIN, y - 3, INNER, 16).fill(BRAND);
    doc.font("bold").fontSize(8).fillColor("#FFFFFF");
    for (const c of cols) doc.text(c.label, c.x + 2, y, { width: c.w - 4, align: c.align });
    doc.y = y + 16;
  };

  tableHeader();
  let totalCartons = 0;
  let totalCbm = 0;
  let totalKg = 0;
  for (const line of data.lines) {
    ensure(line.thumb ? PHOTO + 12 : 28);
    if (doc.y === MARGIN) tableHeader();
    const y = doc.y;
    const cells: { text: string; col: (typeof cols)[number]; sub?: boolean }[] = [
      { text: line.name, col: cols[1] },
      { text: line.sku, col: cols[2], sub: true },
      { text: String(line.quantity), col: cols[3] },
      { text: line.cartons != null ? String(line.cartons) : "—", col: cols[4] },
      { text: fig(line.cartonCbm), col: cols[5] },
      { text: fig(line.lineCbm), col: cols[6] },
      { text: fig(line.cartonWeightKg), col: cols[7] },
      { text: fig(line.lineWeightKg), col: cols[8] },
    ];
    let rowBottom = y;
    doc.fontSize(8.5).font("regular");
    for (const cell of cells) {
      doc.fillColor(cell.sub ? SUB : INK);
      doc.text(cell.text, cell.col.x + 2, y + 3, { width: cell.col.w - 4, align: cell.col.align });
      rowBottom = Math.max(rowBottom, doc.y);
    }
    if (line.supplierCode) {
      doc.fontSize(7.5).fillColor(SUB);
      doc.text(line.supplierCode, cols[1].x + 2, rowBottom + 1, { width: cols[1].w - 4 });
      rowBottom = Math.max(rowBottom, doc.y);
    }
    if (line.thumb) {
      try {
        doc.image(line.thumb, cols[0].x + 1, y + 3, { fit: [PHOTO, PHOTO] });
        rowBottom = Math.max(rowBottom, y + 3 + PHOTO);
      } catch {
        // a corrupt image never blocks the document
      }
    }
    totalCartons += line.cartons ?? 0;
    totalCbm += line.lineCbm;
    totalKg += line.lineWeightKg;
    doc.y = rowBottom + 3;
    hr(doc.y, LINE, 0.4);
    doc.y += 2;
  }

  // Totals under their own columns, so the page foots by eye.
  ensure(30);
  doc.y += 4;
  const y = doc.y;
  doc.font("bold").fontSize(9).fillColor(INK);
  doc.text(data.labels.totalCartons, cols[1].x + 2, y + 3, { width: cols[1].w - 4, align: "right" });
  doc.text(String(totalCartons), cols[4].x + 2, y + 3, { width: cols[4].w - 4, align: "right" });
  doc.text(fig(totalCbm), cols[6].x + 2, y + 3, { width: cols[6].w - 4, align: "right" });
  doc.text(fig(totalKg), cols[8].x + 2, y + 3, { width: cols[8].w - 4, align: "right" });
  doc.y = y + 18;
  doc.moveTo(MARGIN, y).lineTo(right, y).lineWidth(0.7).strokeColor(INK).stroke();

  if (data.footerNote.length > 0) {
    ensure(40);
    doc.y += 14;
    hr(doc.y);
    doc.y += 6;
    doc.font("regular").fontSize(7.5).fillColor(SUB);
    for (const line of data.footerNote) doc.text(line, MARGIN, doc.y, { width: INNER });
  }

  doc.end();
  return done;
}
