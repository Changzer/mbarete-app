import { NextResponse, type NextRequest } from "next/server";
import { ZipArchive } from "archiver";
import { Readable } from "stream";
import { companyLifecycleBlock, sessionUser, requireModuleAction } from "@/lib/authz";
import { makeLimiter } from "@/lib/rate-limit";
import { routing, type Locale } from "@/i18n/routing";
import { assembleDossier } from "@/lib/dossier-server";

/**
 * GET /api/export/dossier?order=<id>[&locale=en|zh]
 *
 * One shipment, one ZIP, root folder named by the customs declaration
 * number: the accountant's 单证包. It holds supplier-side documents, so it is
 * admin-only and behind the finance module, like the accountant pack.
 */
const dossierLimiter = makeLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

export async function GET(request: NextRequest) {
  const user = await sessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (await companyLifecycleBlock(user)) return new NextResponse("Forbidden", { status: 403 });
  if (user.role !== "admin") return new NextResponse("Forbidden", { status: 403 });
  try {
    await requireModuleAction(user, "finance");
  } catch {
    return new NextResponse("Finance module is off for this company", { status: 403 });
  }
  if (dossierLimiter.hit(`u${user.id}`)) {
    return new NextResponse("Too Many Requests", { status: 429, headers: { "Retry-After": "3600" } });
  }

  const params = request.nextUrl.searchParams;
  const orderId = Number(params.get("order"));
  if (!Number.isInteger(orderId) || orderId <= 0) return new NextResponse("Bad request", { status: 400 });
  const localeParam = params.get("locale");
  const locale: Locale = routing.locales.includes(localeParam as Locale)
    ? (localeParam as Locale)
    : routing.defaultLocale;

  const dossier = await assembleDossier({
    companyId: user.companyId,
    orderId,
    locale,
    generatedBy: { id: user.id, email: user.email },
  });
  if (!dossier) return new NextResponse("Not found", { status: 404 });

  const archive = new ZipArchive({ zlib: { level: 6 } });
  for (const entry of dossier.entries) archive.append(entry.data, { name: entry.name });
  archive.finalize();

  const ascii = dossier.folder.replace(/[^A-Za-z0-9._-]+/g, "_") || `order-${orderId}`;
  return new NextResponse(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encodeURIComponent(dossier.folder)}.zip`,
      "Cache-Control": "private, no-store",
    },
  });
}
