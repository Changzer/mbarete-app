import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, one } from "@/db";
import { orders } from "@/db/schema";
import { companyLifecycleBlock, sessionUser, requireModuleAction } from "@/lib/authz";
import { storeDossierDocument } from "@/lib/dossier-server";
import { classifyDossierDocument } from "@/lib/dossier-classify";
import { limitedFormData, UploadBodyTooLargeError } from "@/lib/limited-form-data";
import { makeLimiter } from "@/lib/rate-limit";
import { reserveAiRead } from "@/lib/ai-budget";
import { recordAiUsage } from "@/lib/ai-usage";
import { visionProvider } from "@/lib/vision";
import { DOSSIER_DOCUMENT_BODY_BYTES, DOSSIER_DOCUMENT_MAX_BYTES, DOSSIER_DOCUMENT_MAX_MB } from "@/lib/upload-limits";

export const runtime = "nodejs";
export const DOSSIER_SORT_MAX_FILES = 10;
const limiter = makeLimiter({ max: 20, windowMs: 60 * 60 * 1000 });
const sizeError = () => NextResponse.json({ error: "size", maxMb: DOSSIER_DOCUMENT_MAX_MB }, { status: 413 });

type FileResult = {
  name: string;
  status: "filed" | "unrecognized" | "error";
  kind?: string;
  reason?: string;
  error?: string;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await companyLifecycleBlock(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    await requireModuleAction(user, "orders");
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!visionProvider()) return NextResponse.json({ error: "notConfigured" }, { status: 503 });

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
  const files = form.getAll("file").filter((file): file is File => file instanceof File && file.size > 0);
  if (files.length === 0 || files.length > DOSSIER_SORT_MAX_FILES || files.length !== form.getAll("file").length) {
    return NextResponse.json({ error: "invalid", maxFiles: DOSSIER_SORT_MAX_FILES }, { status: 400 });
  }

  const results: FileResult[] = [];
  for (const file of files) {
    const name = file.name || "document";
    if (file.size > DOSSIER_DOCUMENT_MAX_BYTES) {
      results.push({ name, status: "error", error: "size" });
      continue;
    }
    const budget = await reserveAiRead({ companyId: user.companyId, userId: user.id });
    if (budget !== "ok") {
      results.push({ name, status: "error", error: "limit" });
      continue;
    }
    try {
      const classification = await classifyDossierDocument(file, (usage) =>
        recordAiUsage({ companyId: user.companyId, userId: user.id, kind: "dossier", images: 1, ...usage }),
      );
      if (!classification.kind) {
        results.push({ name, status: "unrecognized", reason: classification.reason });
        continue;
      }
      const stored = await storeDossierDocument(
        user,
        orderId,
        classification.kind,
        classification.fapiaoType,
        file,
        "ai",
      );
      if (stored.error) {
        results.push({ name, status: "error", error: stored.error });
        continue;
      }
      results.push({ name, status: "filed", kind: classification.kind });
    } catch (error) {
      console.error("Dossier AI sorting failed", error);
      results.push({ name, status: "error", error: "read" });
    }
  }
  return NextResponse.json({ ok: true, results });
}
