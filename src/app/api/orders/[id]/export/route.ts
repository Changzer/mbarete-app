import { NextResponse } from "next/server";
import { companyLifecycleBlock, sessionUser, getCompanyModules } from "@/lib/authz";
import { getOrderExportData } from "@/lib/export/order-export";
import { buildOrderXlsx } from "@/lib/export/order-xlsx";
import { buildOrderPdf } from "@/lib/export/order-pdf";
import { buildPackingListPdf } from "@/lib/export/packing-list-pdf";
import { getCustomsPackData } from "@/lib/export/customs-pack-data";
import { buildCustomsPackXlsx } from "@/lib/export/customs-pack-xlsx";
import { routing, type Locale } from "@/i18n/routing";
import { makeLimiter } from "@/lib/rate-limit";

// Generating a PDF/XLSX costs real CPU. Sixty per five minutes is far more
// than any person exports by hand and far less than a runaway loop.
const exportLimiter = makeLimiter({ max: 60, windowMs: 5 * 60 * 1000 });

/**
 * GET /api/orders/:id/export?format=xlsx|pdf&doc=proforma|packing|customs&locale=en|zh
 *
 * Three documents: the proforma (a price quote while the order is a draft),
 * the packing list, and the customs pack — the broker's five-sheet workbook
 * (shipment summary, invoice, packing list, contract, draft declaration),
 * only for a confirmed or shipped order and only as a spreadsheet. The
 * spreadsheet is otherwise the packing list; the PDF is the proforma unless
 * `doc=packing` asks for the list.
 *
 * A generated file, not a page — so agents get something they can attach to
 * WeChat/WhatsApp in one tap. Lives under /api (outside the middleware), so
 * it authenticates itself the same way the uploads route does, and the order
 * lookup is company-scoped: another tenant's order id is a plain 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await sessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (await companyLifecycleBlock(user)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  // Exports are the orders module leaving the building.
  if (!(await getCompanyModules(user.companyId)).orders) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (exportLimiter.hit(`u${user.id}`)) {
    return new NextResponse("Too Many Requests", { status: 429, headers: { "Retry-After": "300" } });
  }

  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (format !== "xlsx" && format !== "pdf") {
    return new NextResponse("Bad request", { status: 400 });
  }
  const localeParam = url.searchParams.get("locale");
  const locale: Locale = routing.locales.includes(localeParam as Locale)
    ? (localeParam as Locale)
    : routing.defaultLocale;

  if (url.searchParams.get("doc") === "customs") {
    if (format !== "xlsx") return new NextResponse("Bad request", { status: 400 });
    const customs = await getCustomsPackData(user.companyId, orderId);
    if (!customs) return new NextResponse("Not found", { status: 404 });
    // A draft is still a negotiation and a cancelled order ships nothing:
    // there is no export to declare.
    if (customs.status !== "confirmed" && customs.status !== "shipped") {
      return new NextResponse("Conflict", { status: 409 });
    }
    const body = await buildCustomsPackXlsx(customs.pack);
    const number = (customs.pack.docNo || `order-${orderId}`).trim();
    const ascii = `${number.replace(/[^A-Za-z0-9._-]+/g, "_") || `order-${orderId}`}_customs-pack`;
    const utf8 = encodeURIComponent(`${number} 报关资料.xlsx`);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${ascii}.xlsx"; filename*=UTF-8''${utf8}`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const data = await getOrderExportData(user.companyId, orderId, locale);
  if (!data) return new NextResponse("Not found", { status: 404 });

  const packing = format === "xlsx" || url.searchParams.get("doc") === "packing";
  const body =
    format === "xlsx" ? await buildOrderXlsx(data) : packing ? await buildPackingListPdf(data) : await buildOrderPdf(data);

  // Order numbers are free text; the ASCII fallback keeps the header valid
  // and filename* carries the real name for modern clients.
  const number = (data.doc.number || `order-${orderId}`).trim();
  const base = `${number}${packing ? ` ${data.labels.packingListTitle}` : ""}`;
  // The ASCII name keeps a readable suffix even when the title is Chinese.
  const ascii = `${number.replace(/[^A-Za-z0-9._-]+/g, "_") || `order-${orderId}`}${packing ? "_packing-list" : ""}`;
  const filename = `${ascii}.${format}`;
  const utf8 = encodeURIComponent(`${base}.${format}`);

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type":
        format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${utf8}`,
      "Cache-Control": "private, no-store",
    },
  });
}
