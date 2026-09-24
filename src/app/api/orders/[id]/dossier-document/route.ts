import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, one } from "@/db";
import { orders } from "@/db/schema";
import { companyLifecycleBlock, sessionUser, requireModuleAction } from "@/lib/authz";
import { dossierItem } from "@/lib/dossier";
import { storeDossierDocument } from "@/lib/dossier-server";
import { limitedFormData, UploadBodyTooLargeError } from "@/lib/limited-form-data";
import { makeLimiter } from "@/lib/rate-limit";
import { DOSSIER_DOCUMENT_BODY_BYTES, DOSSIER_DOCUMENT_MAX_MB } from "@/lib/upload-limits";

// API routes bypass both the Server Action body cap and proxy.ts's body buffer.
export const runtime = "nodejs";
const limiter = makeLimiter({ max: 120, windowMs: 60 * 60 * 1000 });
const sizeError = () => NextResponse.json({ error: "size", maxMb: DOSSIER_DOCUMENT_MAX_MB }, { status: 413 });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await companyLifecycleBlock(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    await requireModuleAction(user, "orders");
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Retain the same-origin protection the old Server Action supplied.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() ?? request.headers.get("host");
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (origin) {
    try {
      if (new URL(origin).host !== host) throw new Error("Origin mismatch");
    } catch {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  if (limiter.hit(`u${user.id}`)) {
    return NextResponse.json({ error: "rate" }, { status: 429, headers: { "Retry-After": "3600" } });
  }
  const orderId = Number((await params).id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "notFound" }, { status: 404 });
  }
  // Reject another company's order before reading a potentially large body.
  const order = await db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.companyId, user.companyId), eq(orders.id, orderId))).limit(1).then(one);
  if (!order) return NextResponse.json({ error: "notFound" }, { status: 404 });

  let form: FormData;
  try {
    form = await limitedFormData(request, DOSSIER_DOCUMENT_BODY_BYTES);
  } catch (error) {
    if (error instanceof UploadBodyTooLargeError) return sizeError();
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const kind = form.get("kind");
  const file = form.get("file");
  const fapiaoType = form.get("fapiaoType");
  const item = typeof kind === "string" ? dossierItem(kind) : undefined;
  if (!item || item.video || !(file instanceof File) || form.getAll("file").length !== 1) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  try {
    const result = await storeDossierDocument(user, orderId, item.key,
      typeof fapiaoType === "string" ? fapiaoType : null, file);
    if (result.error === "size") return sizeError();
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.error === "notFound" ? 404 : 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Dossier document upload failed", error);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
