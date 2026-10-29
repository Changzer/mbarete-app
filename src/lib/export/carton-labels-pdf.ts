import type { CartonLabel } from "@/lib/carton-labels";
import { INK, SUB, openPdf, pageFor } from "./pdf-common";

/**
 * Carton labels to print and stick on the boxes: two per A4 sheet, cut
 * along the dashed line. Each carries the order's marks (the title lines the
 * forwarder asks for), the product, the pieces inside, the carton's gross
 * weight and volume, the carton's number out of the order's total, where the
 * goods are delivered in China and where they finally go — and, when the
 * goods are declared under the exporter's own name, a large 报关件: the
 * forwarder's sign that the box must not ride in a consolidated declaration.
 */
const PAGE = pageFor("portrait");
const HALF = PAGE.height / 2;
const PAD = 40;
const WIDTH = PAGE.width - PAD * 2;

export async function buildCartonLabelsPdf(input: {
  marks: string[];
  orderNumber: string;
  labels: CartonLabel[];
  /** The forwarder's warehouse in China, as printed lines; empty prints no block. */
  warehouse: string[];
  /** The final consignee, as printed lines; empty prints no block. */
  consignee: string[];
  customsStamp: boolean;
}): Promise<Buffer> {
  const { doc, done } = openPdf("portrait");
  // Every line is placed by hand: no flowing text, so pdfkit never adds a page of its own.
  const at = { lineBreak: false } as const;

  if (input.labels.length === 0) {
    doc.font("bold").fontSize(16).fillColor(INK).text("No cartons recorded on this order.", PAD, PAD, { width: WIDTH });
    doc.font("regular").fontSize(12).fillColor(SUB).text("订单上没有箱数。请在订单的“装箱”里填写每箱数量。", PAD, PAD + 30, { width: WIDTH });
    doc.end();
    return done;
  }

  // Text that would run past its space is cut with "…", measured in the
  // font it prints in — never wrapped onto the line below.
  const fit = (text: string, font: "bold" | "regular", size: number, width: number) => {
    doc.font(font).fontSize(size);
    if (doc.widthOfString(text) <= width) return text;
    let cut = text;
    while (cut.length > 1 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  };
  const line = (text: string, font: "bold" | "regular", size: number, x: number, y: number, width: number) =>
    doc.font(font).fontSize(size).fillColor(INK).text(fit(text, font, size, width), x, y, { ...at, width });

  const marks = input.marks.slice(0, 6);
  // Six title lines and both addresses still fit half a sheet.
  const markSize = marks.length <= 3 ? 20 : marks.length === 4 ? 17 : 13;
  const markStep = markSize + (marks.length <= 4 ? 6 : 4);
  const stampW = input.customsStamp ? 150 : 0;
  const hasAddresses = input.warehouse.length > 0 || input.consignee.length > 0;

  input.labels.forEach((label, i) => {
    const slot = i % 2;
    if (i > 0 && slot === 0) doc.addPage();
    const top = slot * HALF + PAD - (slot === 0 ? 8 : 0);
    if (slot === 1) {
      doc.save().moveTo(16, HALF).lineTo(PAGE.width - 16, HALF).lineWidth(0.6).dash(5, { space: 4 }).strokeColor(SUB).stroke().restore();
    }

    // 报关件, boxed, top right — only for goods declared under the exporter's name.
    if (input.customsStamp) {
      const stampX = PAD + WIDTH - stampW;
      doc.save().rect(stampX, top, stampW, 64).lineWidth(3).strokeColor(INK).stroke().restore();
      doc.font("bold").fontSize(34).fillColor(INK).text("报关件", stampX, top + 10, { ...at, width: stampW, align: "center" });
    }

    // The title: the marks, as many lines as the order has (up to six).
    marks.forEach((mark, j) => line(mark, "bold", markSize, PAD, top + j * markStep, WIDTH - (stampW ? stampW + 16 : 0)));

    // The product.
    const productTop = top + Math.max(input.customsStamp ? 64 : 0, marks.length * markStep) + 16;
    doc.save().moveTo(PAD, productTop - 8).lineTo(PAD + WIDTH, productTop - 8).lineWidth(0.8).strokeColor(SUB).stroke().restore();
    line(label.nameEn, "bold", 15, PAD, productTop, WIDTH);
    if (label.nameZh && label.nameZh !== label.nameEn) line(label.nameZh, "regular", 13, PAD, productTop + 21, WIDTH);

    // What is inside, what it weighs, and which box it is.
    const countTop = productTop + 46;
    if (label.pieces !== null) {
      doc.font("regular").fontSize(10).fillColor(SUB).text("QTY 数量", PAD, countTop, at);
      doc.font("bold").fontSize(22).fillColor(INK).text(`${label.pieces.toLocaleString("en-US")} PCS`, PAD, countTop + 13, at);
    }
    const middle = PAD + WIDTH * 0.36;
    if (label.grossKg !== null) {
      doc.font("regular").fontSize(10).fillColor(SUB).text("G.W. 毛重", middle, countTop, at);
      doc.font("bold").fontSize(14).fillColor(INK).text(`${label.grossKg.toLocaleString("en-US")} KG`, middle, countTop + 13, at);
    }
    if (label.cbm !== null) {
      const meas = middle + WIDTH * 0.2;
      doc.font("regular").fontSize(10).fillColor(SUB).text("MEAS. 体积", meas, countTop, at);
      doc.font("bold").fontSize(14).fillColor(INK).text(`${label.cbm.toLocaleString("en-US", { maximumFractionDigits: 4 })} CBM`, meas, countTop + 13, at);
    }
    doc.font("regular").fontSize(10).fillColor(SUB).text("C/NO. 箱号", PAD + WIDTH / 2, countTop, { ...at, width: WIDTH / 2, align: "right" });
    doc.font("bold").fontSize(30).fillColor(INK).text(`${label.no} / ${label.of}`, PAD + WIDTH / 2, countTop + 11, { ...at, width: WIDTH / 2, align: "right" });

    // Where it goes: the forwarder's warehouse in China, and the final consignee.
    if (hasAddresses) {
      // Clear of the carton number above, which reaches about 45 below countTop.
      const addressTop = countTop + 66;
      doc.save().moveTo(PAD, addressTop - 8).lineTo(PAD + WIDTH, addressTop - 8).lineWidth(0.5).strokeColor(SUB).stroke().restore();
      const column = (heading: string, lines: string[], x: number) => {
        if (lines.length === 0) return;
        doc.font("bold").fontSize(9).fillColor(SUB).text(heading, x, addressTop, { ...at, width: WIDTH / 2 - 10 });
        lines.slice(0, 4).forEach((text, j) => line(text, j === 0 ? "bold" : "regular", 11, x, addressTop + 14 + j * 15, WIDTH / 2 - 10));
      };
      column("DELIVER TO 送货地址", input.warehouse, PAD);
      column("FINAL DESTINATION 最终收货人", input.consignee, PAD + WIDTH / 2 + 10);
    }

    // Clear of the page's bottom margin, or pdfkit would start a page of its own.
    const footTop = slot * HALF + HALF - PAD - 18;
    doc.font("regular").fontSize(10).fillColor(SUB).text(input.orderNumber, PAD, footTop, at);
    doc.font("bold").fontSize(10).fillColor(INK).text("MADE IN CHINA", PAD, footTop, { ...at, width: WIDTH, align: "right" });
  });

  doc.end();
  return done;
}
