import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, one } from "@/db";
import { contacts, orderItems, orders } from "@/db/schema";
import { companyLifecycleBlock, requireModuleAction, sessionUser } from "@/lib/authz";
import { limitedFormData, UploadBodyTooLargeError } from "@/lib/limited-form-data";
import { makeLimiter } from "@/lib/rate-limit";
import { reserveAiRead } from "@/lib/ai-budget";
import { recordAiUsage } from "@/lib/ai-usage";
import { visionProvider } from "@/lib/vision";
import { analyzeFinanceDocument, type FinanceIntakeContext } from "@/lib/finance-intake";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 1024 * 1024;
const INTENTS = ["auto", "attach", "payment_in", "payment_out", "expense"] as const;
const limiter = makeLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

export async function POST(request: NextRequest) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin" || await companyLifecycleBlock(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    await requireModuleAction(user, "finance");
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

  let form: FormData;
  try {
    form = await limitedFormData(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof UploadBodyTooLargeError) {
      return NextResponse.json({ error: "size", maxMb: 25 }, { status: 413 });
    }
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const orderId = Number(form.get("orderId"));
  const requestedIntent = String(form.get("intent") ?? "auto") as FinanceIntakeContext["intent"];
  const file = form.get("file");
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !INTENTS.includes(requestedIntent)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "size", maxMb: 25 }, { status: 413 });
  }

  const order = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, clientName: contacts.companyName })
    .from(orders)
    .leftJoin(contacts, eq(orders.clientId, contacts.id))
    .where(and(eq(orders.companyId, user.companyId), eq(orders.id, orderId)))
    .limit(1)
    .then(one);
  if (!order) return NextResponse.json({ error: "notFound" }, { status: 404 });

  const supplierRows = await db
    .select({ nameEn: orderItems.supplierNameEnSnapshot, nameZh: orderItems.supplierNameZhSnapshot })
    .from(orderItems)
    .where(and(eq(orderItems.companyId, user.companyId), eq(orderItems.orderId, orderId)));
  const context: FinanceIntakeContext = {
    orderNumber: order.orderNumber,
    clientName: order.clientName ?? "",
    suppliers: [...new Set(supplierRows.flatMap((row) => [row.nameEn, row.nameZh].filter(Boolean)))],
    intent: requestedIntent,
  };

  const budget = await reserveAiRead({ companyId: user.companyId, userId: user.id });
  if (budget !== "ok") return NextResponse.json({ error: "limit" }, { status: 429 });

  try {
    const fileSha256 = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
    const result = await analyzeFinanceDocument(file, context, (usage) =>
      recordAiUsage({ companyId: user.companyId, userId: user.id, kind: "finance", images: 1, ...usage }),
    );
    return NextResponse.json({ ok: true, ...result, fileSha256 });
  } catch (error) {
    console.error("Finance document analysis failed", error);
    return NextResponse.json({ error: "read" }, { status: 422 });
  }
}
