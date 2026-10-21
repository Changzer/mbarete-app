import type { CartonLabel } from "@/lib/carton-labels";
import { INK, SUB, openPdf, pageFor } from "./pdf-common";

/**
 * Carton labels to print and stick on the boxes: two per A4 sheet, cut
 * along the dashed line. Each carries the order's marks, a large 报关件 — the
 * forwarder's sign that the box is declared under the exporter's own name
 * and must not ride in a consolidated declaration — the product, the
 * pieces inside and the carton's number out of the order's total.
 */
const PAGE = pageFor("portrait");
const HALF = PAGE.height / 2;
const PAD = 40;
const WIDTH = PAGE.width - PAD * 2;

export async function buildCartonLabelsPdf(input: {
  marks: string[];
  orderNumber: string;
  labels: CartonLabel[];
}): Promise<Buffer> {
  const { doc, done } = openPdf("portrait");
  // Every line is placed by hand: no flowing text, so pdfkit never adds a page of its own.
  const at = { lineBreak: false } as const;

  if (input.labels.length === 0) {
    doc.font("bold").fontSize(16).fillColor(INK).text("No cartons recorded on this order.", PAD, PAD, { width: WIDTH });
    doc.font("regular").fontSize(12).fillColor(SUB).text("订单上没有箱数。请在产品里填写每箱数量，再在订单上点“从目录更新”。", PAD, PAD + 30, { width: WIDTH });
    doc.end();
    return done;
  }

  input.labels.forEach((label, i) => {
    const slot = i % 2;
    if (i > 0 && slot === 0) doc.addPage();
    const top = slot * HALF + PAD - (slot === 0 ? 8 : 0);
    if (slot === 1) {
      doc.save().moveTo(16, HALF).lineTo(PAGE.width - 16, HALF).lineWidth(0.6).dash(5, { space: 4 }).strokeColor(SUB).stroke().restore();
    }

    // 报关件, boxed, top right.
    const stampW = 150;
    const stampX = PAD + WIDTH - stampW;
    doc.save().rect(stampX, top, stampW, 64).lineWidth(3).strokeColor(INK).stroke().restore();
    doc.font("bold").fontSize(34).fillColor(INK).text("报关件", stampX, top + 10, { ...at, width: stampW, align: "center" });

    // The marks, as many lines as the order has (up to six).
    const marks = input.marks.slice(0, 6);
    const markSize = marks.length > 4 ? 16 : 20;
    marks.forEach((line, j) => {
      doc.font("bold").fontSize(markSize).fillColor(INK).text(line, PAD, top + j * (markSize + 7), { ...at, width: WIDTH - stampW - 16, ellipsis: true });
    });

    // The product and what is inside.
    const productTop = top + Math.max(80, marks.length * (markSize + 7)) + 14;
    doc.save().moveTo(PAD, productTop - 8).lineTo(PAD + WIDTH, productTop - 8).lineWidth(0.8).strokeColor(SUB).stroke().restore();
    doc.font("bold").fontSize(15).fillColor(INK).text(label.nameEn, PAD, productTop, { ...at, width: WIDTH, ellipsis: true });
    if (label.nameZh && label.nameZh !== label.nameEn) {
      doc.font("regular").fontSize(13).fillColor(INK).text(label.nameZh, PAD, productTop + 22, { ...at, width: WIDTH, ellipsis: true });
    }

    const countTop = productTop + 64;
    if (label.pieces !== null) {
      doc.font("regular").fontSize(11).fillColor(SUB).text("QTY 数量", PAD, countTop, at);
      doc.font("bold").fontSize(24).fillColor(INK).text(`${label.pieces.toLocaleString("en-US")} PCS`, PAD, countTop + 15, at);
    }
    doc.font("regular").fontSize(11).fillColor(SUB).text("C/NO. 箱号", PAD + WIDTH / 2, countTop, { ...at, width: WIDTH / 2, align: "right" });
    doc.font("bold").fontSize(34).fillColor(INK).text(`${label.no} / ${label.of}`, PAD + WIDTH / 2, countTop + 12, { ...at, width: WIDTH / 2, align: "right" });

    // Clear of the page's bottom margin, or pdfkit would start a page of its own.
    const footTop = slot * HALF + HALF - PAD - 18;
    doc.font("regular").fontSize(10).fillColor(SUB).text(input.orderNumber, PAD, footTop, at);
    doc.font("bold").fontSize(10).fillColor(INK).text("MADE IN CHINA", PAD, footTop, { ...at, width: WIDTH, align: "right" });
  });

  doc.end();
  return done;
}
