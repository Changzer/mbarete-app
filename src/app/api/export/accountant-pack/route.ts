import { NextResponse, type NextRequest } from "next/server";
import { ZipArchive } from "archiver";
import { Readable } from "stream";
import { sessionUser, requireModuleAction } from "@/lib/authz";
import { makeLimiter } from "@/lib/rate-limit";
import { assembleAccountantPack, periodKey } from "@/lib/accountant-pack-server";

/**
 * GET /api/export/accountant-pack?from=YYYY-MM&to=YYYY-MM[&currency=CCY]
 *
 * One period, one ZIP: the reports plus every referenced evidence file,
 * manifest last. Admin-only and finance-gated — this is the INTERNAL pack
 * and deliberately contains cost data; it must never feed a client-facing
 * surface. No params = the current month; ?period= is shorthand for both.
 */

// Heavier than an order export, lighter than the full backup.
const packLimiter = makeLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: NextRequest) {
  const user = await sessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (user.role !== "admin") return new NextResponse("Forbidden", { status: 403 });
  try {
    await requireModuleAction(user, "finance");
  } catch {
    return new NextResponse("Finance module is off for this company", { status: 403 });
  }
  if (packLimiter.hit(`u${user.id}`)) {
    return new NextResponse("Too Many Requests", { status: 429, headers: { "Retry-After": "3600" } });
  }

  const params = request.nextUrl.searchParams;
  const shorthand = params.get("period") ?? "";
  const thisMonth = new Date().toISOString().slice(0, 7);
  const from = params.get("from") ?? shorthand ?? "";
  const to = params.get("to") ?? shorthand ?? "";
  const period = {
    from: MONTH.test(from) ? from : thisMonth,
    to: MONTH.test(to) ? to : thisMonth,
  };
  if (period.from > period.to) return new NextResponse("from is after to", { status: 400 });
  // A runaway range would read years of receipts into one response.
  const [fy, fm] = period.from.split("-").map(Number);
  const [ty, tm] = period.to.split("-").map(Number);
  if ((ty - fy) * 12 + (tm - fm) > 23) {
    return new NextResponse("range too long (max 24 months)", { status: 400 });
  }
  const currencyParam = (params.get("currency") ?? "").toUpperCase();
  // RMB is the functional currency of the audience; anything explicit wins.
  const reportCurrency = /^[A-Z]{3}$/.test(currencyParam) ? currencyParam : "RMB";

  const { built, xlsx, fileBuffers } = await assembleAccountantPack({
    companyId: user.companyId,
    period,
    reportCurrency,
    generatedBy: { id: user.id, email: user.email },
  });

  const archive = new ZipArchive({ zlib: { level: 6 } });
  for (const entry of built.entries) archive.append(entry.data, { name: entry.name });
  archive.append(xlsx, { name: "report.xlsx" });
  for (const [zipName, data] of fileBuffers) archive.append(data, { name: zipName });
  // Manifest last, like the backup: its presence marks a complete archive.
  archive.append(JSON.stringify(built.manifest, null, 2), { name: "manifest.json" });
  archive.finalize();

  const stamp = periodKey(period).replace("~", "-to-");
  return new NextResponse(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="accountant-pack-${stamp}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
