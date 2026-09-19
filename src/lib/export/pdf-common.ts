import path from "path";
import PDFDocument from "pdfkit";
import type { OrderExportData } from "./order-export";

/**
 * What every order PDF shares: the embedded CJK fonts, the print palette,
 * the page geometry and the letterhead. Noto Sans SC is embedded because
 * agents work in Chinese — product names, addresses and bank details are
 * CJK, and the standard PDF fonts render them as boxes. The fonts are
 * traced into the standalone build via next.config.
 */
const FONT_DIR = path.join(process.cwd(), "src", "assets", "fonts");
export const REGULAR = path.join(FONT_DIR, "NotoSansSC-Regular.otf");
export const BOLD = path.join(FONT_DIR, "NotoSansSC-Bold.otf");

export const BRAND = "#C2410C";
// Documents print black: body text is true black, secondary a dark gray
// that still reads black on paper — never a light theme gray.
export const SUB = "#3D3D3D";
export const INK = "#000000";
export const LINE = "#E5E7EB";

export const MARGIN = 40;
const A4_PORTRAIT = { width: 595.28, height: 841.89 };

export type Page = { width: number; height: number; inner: number };

export function pageFor(orientation: "portrait" | "landscape"): Page {
  const { width, height } = orientation === "portrait" ? A4_PORTRAIT : { width: A4_PORTRAIT.height, height: A4_PORTRAIT.width };
  return { width, height, inner: width - MARGIN * 2 };
}

/** A document with both fonts registered and its bytes collected. */
export function openPdf(orientation: "portrait" | "landscape") {
  const doc = new PDFDocument({ size: "A4", layout: orientation, margin: MARGIN, font: REGULAR });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.registerFont("regular", REGULAR);
  doc.registerFont("bold", BOLD);
  return { doc, done };
}

export function hrule(doc: PDFKit.PDFDocument, page: Page, y: number, color = LINE, width = 0.7) {
  doc.moveTo(MARGIN, y).lineTo(page.width - MARGIN, y).lineWidth(width).strokeColor(color).stroke();
}

/**
 * The brand bar, the tenant's letterhead on the left (logo, name, address,
 * contacts) and the document's title and meta on the right, closed by a
 * rule. Leaves the cursor below the rule.
 */
export function drawLetterhead(
  doc: PDFKit.PDFDocument,
  page: Page,
  data: OrderExportData,
  title: string,
  meta: string[],
) {
  doc.rect(MARGIN, MARGIN, page.inner, 4).fill(BRAND);
  doc.y = MARGIN + 16;
  const headerTop = doc.y;
  // The tenant's letterhead logo, aspect-true within a letterhead-sized box;
  // the document title stays anchored to the top right beside it.
  let nameTop = headerTop;
  if (data.company.logo) {
    const logo = data.company.logo;
    const scale = Math.min(140 / logo.width, 44 / logo.height, 1);
    try {
      doc.image(logo.data, MARGIN, headerTop, { width: logo.width * scale, height: logo.height * scale });
      nameTop = headerTop + logo.height * scale + 8;
    } catch {
      // a corrupt logo never blocks the document
    }
  }
  doc.font("bold").fontSize(16).fillColor(INK).text(data.company.name, MARGIN, nameTop, { width: page.inner * 0.6 });
  doc.font("regular").fontSize(8.5).fillColor(SUB);
  for (const line of data.company.addressLines) doc.text(line, { width: page.inner * 0.6 });
  const contactBits = [
    data.company.phone && `${data.labels.phone}: ${data.company.phone}`,
    data.company.email && `${data.labels.email}: ${data.company.email}`,
    data.company.website && data.company.website,
    data.company.taxId && `${data.labels.taxId}: ${data.company.taxId}`,
  ].filter(Boolean) as string[];
  for (const bit of contactBits) doc.text(bit, { width: page.inner * 0.6 });
  const leftBottom = doc.y;

  doc.font("bold").fontSize(15).fillColor(INK);
  doc.text(title.toUpperCase(), MARGIN + page.inner * 0.55, headerTop, { width: page.inner * 0.45, align: "right" });
  doc.font("regular").fontSize(8.5).fillColor(SUB);
  for (const m of meta) doc.text(m, { width: page.inner * 0.45, align: "right" });

  doc.y = Math.max(leftBottom, doc.y) + 10;
  hrule(doc, page, doc.y);
  doc.y += 12;
}
