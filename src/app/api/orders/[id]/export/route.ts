import { NextResponse } from "next/server";
import { sessionUser } from "@/lib/authz";
import { getOrderExportData } from "@/lib/export/order-export";
import { buildOrderXlsx } from "@/lib/export/order-xlsx";
import { buildOrderPdf } from "@/lib/export/order-pdf";
import { routing, type Locale } from "@/i18n/routing";
import { makeLimiter } from "@/lib/rate-limit";

// Generating a PDF/XLSX costs real CPU. Sixty per five minutes is far more
// than any person exports by hand and far less than a runaway loop.
const exportLimiter = makeLimiter({ max: 60, windowMs: 5 * 60 * 1000 });

/**
 * GET /api/orders/:id/export?format=xlsx|pdf&locale=en|zh
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

  const data = await getOrderExportData(user.companyId, orderId, locale);
  if (!data) return new NextResponse("Not found", { status: 404 });

  const body = format === "xlsx" ? await buildOrderXlsx(data) : await buildOrderPdf(data);

  // Order numbers are free text; the ASCII fallback keeps the header valid
  // and filename* carries the real name for modern clients.
  const base = (data.doc.number || `order-${orderId}`).trim();
  const ascii = base.replace(/[^A-Za-z0-9._-]+/g, "_") || `order-${orderId}`;
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
