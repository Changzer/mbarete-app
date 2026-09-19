import type { OrderExportData } from "./order-export";
import { BRAND, INK, LINE, MARGIN, SUB, drawLetterhead, hrule, openPdf, pageFor } from "./pdf-common";

/**
 * The order as a downloadable A4 PDF — the proforma (or the price quote
 * while the order is a draft): company header, sell prices only, bank
 * details, notes and the validity footer. Fonts, palette and letterhead
 * are shared with the packing list in pdf-common.ts.
 */
const A4 = pageFor("portrait");
const INNER = A4.inner;

export async function buildOrderPdf(data: OrderExportData): Promise<Buffer> {
  const { doc, done } = openPdf("portrait");

  const money = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const hr = (y: number, color = LINE, width = 0.7) => hrule(doc, A4, y, color, width);

  /** Start a new page when fewer than `need` points remain above the margin. */
  const ensure = (need: number) => {
    if (doc.y + need > A4.height - MARGIN) doc.addPage();
  };

  const meta: string[] = [
    `${data.labels.number}: ${data.doc.number}`,
    `${data.labels.date}: ${data.doc.issuedOn}`,
  ];
  if (data.doc.validUntil) meta.push(`${data.labels.validUntil}: ${data.doc.validUntil}`);
  drawLetterhead(doc, A4, data, data.labels.title, meta);

  // Bill-to (left) and terms (right). A quote exports with client=null and
  // prints neither: nothing is billed or agreed while the client is deciding.
  if (data.client) {
    const twoColTop = doc.y;
    const colW = INNER * 0.46;
    doc.font("bold").fontSize(8).fillColor(SUB).text(data.labels.billTo.toUpperCase(), MARGIN, twoColTop);
    doc.font("bold").fontSize(10).fillColor(INK).text(data.client.name || "—", { width: colW });
    doc.font("regular").fontSize(8.5).fillColor(SUB);
    const clientBits = [
      data.client.address,
      data.client.taxId && `${data.labels.taxId}: ${data.client.taxId}`,
      data.client.contactPerson && `${data.labels.attn}: ${data.client.contactPerson}`,
      data.client.phone && `${data.labels.phone}: ${data.client.phone}`,
      data.client.email && `${data.labels.email}: ${data.client.email}`,
      data.client.whatsapp && `WhatsApp: ${data.client.whatsapp}`,
      data.client.wechat && `WeChat: ${data.client.wechat}`,
    ].filter(Boolean) as string[];
    for (const bit of clientBits) doc.text(bit, { width: colW });
    const billBottom = doc.y;

    const rightX = MARGIN + INNER * 0.54;
    doc.font("bold").fontSize(8).fillColor(SUB).text(data.labels.terms.toUpperCase(), rightX, twoColTop);
    doc.font("regular").fontSize(8.5).fillColor(SUB);
    const termBits = [
      data.terms.incoterms && `${data.labels.incoterms}: ${data.terms.incoterms}`,
      `${data.labels.currency}: ${data.doc.currency}`,
      `${data.labels.totalCartons}: ${data.terms.totalCartons}`,
      `${data.labels.totalCbm}: ${data.terms.totalCbm} m³`,
      `${data.labels.totalWeight}: ${data.terms.totalWeightKg} kg`,
      ...data.terms.paymentTerms,
    ].filter(Boolean) as string[];
    for (const bit of termBits) doc.text(bit, { width: INNER * 0.46 });

    doc.y = Math.max(billBottom, doc.y) + 12;
    hr(doc.y);
    doc.y += 10;
  }

  // Line-item table. The first column is the product photo.
  const PHOTO = 30;
  const cols = [
    { label: data.labels.photo, x: MARGIN, w: PHOTO + 4, align: "left" as const },
    { label: data.labels.item, x: MARGIN + PHOTO + 8, w: 146, align: "left" as const },
    { label: data.labels.sku, x: MARGIN + 184, w: 70, align: "left" as const },
    { label: data.labels.quantity, x: MARGIN + 258, w: 50, align: "right" as const },
    { label: data.labels.cartons, x: MARGIN + 312, w: 45, align: "right" as const },
    { label: data.labels.unitPrice, x: MARGIN + 361, w: 70, align: "right" as const },
    { label: data.labels.amount, x: MARGIN + 435, w: INNER - 435, align: "right" as const },
  ];

  const tableHeader = () => {
    const y = doc.y;
    doc.rect(MARGIN, y - 3, INNER, 16).fill(BRAND);
    doc.font("bold").fontSize(8).fillColor("#FFFFFF");
    for (const c of cols) doc.text(c.label, c.x + 2, y, { width: c.w - 4, align: c.align });
    doc.y = y + 16;
  };

  tableHeader();
  for (const line of data.lines) {
    ensure(line.thumb ? PHOTO + 12 : 28);
    if (doc.y === MARGIN) tableHeader(); // repeated header on a fresh page
    const y = doc.y;
    const cells: { text: string; col: (typeof cols)[number]; sub?: boolean }[] = [
      { text: line.name, col: cols[1] },
      { text: line.sku, col: cols[2], sub: true },
      { text: String(line.quantity), col: cols[3] },
      { text: line.cartons != null ? String(line.cartons) : "—", col: cols[4] },
      { text: `${money(line.unitPrice)} ${line.currency}`, col: cols[5] },
      { text: `${money(line.amount)} ${line.currency}`, col: cols[6] },
    ];
    let rowBottom = y;
    doc.fontSize(8.5).font("regular");
    for (const cell of cells) {
      doc.fillColor(cell.sub ? SUB : INK);
      doc.text(cell.text, cell.col.x + 2, y + 3, { width: cell.col.w - 4, align: cell.col.align });
      rowBottom = Math.max(rowBottom, doc.y);
    }
    // The supplier's own style number under the name, so the factory can
    // match the row against their catalog.
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
    doc.y = rowBottom + 3;
    hr(doc.y, LINE, 0.4);
    doc.y += 2;
  }

  // Totals, right-aligned block
  ensure(90);
  doc.y += 8;
  const totalsX = MARGIN + INNER - 220;
  const totalRow = (label: string, value: string, opts?: { bold?: boolean; sub?: boolean }) => {
    const y = doc.y;
    doc.font(opts?.bold ? "bold" : "regular").fontSize(opts?.bold ? 10.5 : 9);
    doc.fillColor(opts?.sub || !opts?.bold ? SUB : INK).text(label, totalsX, y, { width: 130 });
    doc.fillColor(opts?.bold ? INK : SUB).text(value, totalsX + 130, y, { width: 90, align: "right" });
    doc.y = y + (opts?.bold ? 16 : 13);
  };
  totalRow(data.labels.goodsSubtotal, `${money(data.totals.goods)} ${data.doc.currency}`);
  if (data.totals.commissionPct > 0) {
    totalRow(
      `${data.labels.commissionAmount} (${data.totals.commissionPct}%)`,
      `${money(data.totals.commission)} ${data.doc.currency}`,
    );
  }
  doc.moveTo(totalsX, doc.y).lineTo(A4.width - MARGIN, doc.y).lineWidth(0.7).strokeColor(INK).stroke();
  doc.y += 4;
  totalRow(data.labels.grandTotal, `${money(data.totals.grandTotal)} ${data.doc.currency}`, { bold: true });
  for (const eq of data.totals.equivalents) {
    totalRow(data.labels.equivalent, `${money(eq.amount)} ${eq.currency}`, { sub: true });
  }

  // Bank details
  if (data.bank) {
    ensure(100);
    doc.y += 10;
    hr(doc.y);
    doc.y += 8;
    doc.font("bold").fontSize(8).fillColor(SUB).text(data.labels.bankDetails.toUpperCase(), MARGIN, doc.y);
    doc.font("regular").fontSize(8.5).fillColor(INK);
    const bankBits = [
      data.bank.accountName && `${data.labels.bankAccountName}: ${data.bank.accountName}`,
      data.bank.bankName && `${data.labels.bankName}: ${data.bank.bankName}`,
      data.bank.accountNumber && `${data.labels.bankAccountNumber}: ${data.bank.accountNumber}`,
      data.bank.swift && `${data.labels.bankSwift}: ${data.bank.swift}`,
      ...data.bank.addressLines,
    ].filter(Boolean) as string[];
    for (const bit of bankBits) doc.text(bit, MARGIN, doc.y, { width: INNER });
  }

  // Notes
  if (data.notes) {
    ensure(60);
    doc.y += 10;
    doc.font("bold").fontSize(8).fillColor(SUB).text(data.labels.notes.toUpperCase(), MARGIN, doc.y);
    doc.font("regular").fontSize(8.5).fillColor(INK).text(data.notes, MARGIN, doc.y, { width: INNER });
  }

  // Footer: validity note first — the file itself says when the quote dies.
  ensure(50);
  doc.y += 14;
  hr(doc.y);
  doc.y += 6;
  doc.font("regular").fontSize(7.5).fillColor(SUB);
  if (data.doc.validityDays > 0) doc.text(data.labels.validityNote, MARGIN, doc.y, { width: INNER });
  for (const line of data.footerNote) doc.text(line, MARGIN, doc.y, { width: INNER });

  doc.end();
  return done;
}
