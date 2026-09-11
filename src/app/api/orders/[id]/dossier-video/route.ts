import { NextResponse, type NextRequest } from "next/server";
import { companyLifecycleBlock, sessionUser, requireModuleAction } from "@/lib/authz";
import { makeLimiter } from "@/lib/rate-limit";
import { storeDossierDocument } from "@/lib/dossier-server";
import { DOSSIER_VIDEO_MAX_MB } from "@/lib/uploads";

/**
 * POST /api/orders/:id/dossier-video — multipart, field "file".
 *
 * Item 19 of the dossier takes videos far above the server-action body
 * limit, so it arrives through a route handler. Same session and module
 * checks as the documents action; the size cap is DOSSIER_VIDEO_MAX_MB and
 * the reverse proxy in front must allow the same body.
 */
const videoLimiter = makeLimiter({ max: 30, windowMs: 60 * 60 * 1000 });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await companyLifecycleBlock(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    await requireModuleAction(user, "orders");
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (videoLimiter.hit(`u${user.id}`)) {
    return NextResponse.json({ error: "rate" }, { status: 429, headers: { "Retry-After": "3600" } });
  }
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) return NextResponse.json({ error: "notFound" }, { status: 404 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > (DOSSIER_VIDEO_MAX_MB + 2) * 1024 * 1024) {
    return NextResponse.json({ error: "size", maxMb: DOSSIER_VIDEO_MAX_MB }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const result = await storeDossierDocument(user, orderId, "loading_video", null, file);
  if (result.error === "size") return NextResponse.json({ error: "size", maxMb: DOSSIER_VIDEO_MAX_MB }, { status: 413 });
  if (result.error === "notFound") return NextResponse.json({ error: "notFound" }, { status: 404 });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
