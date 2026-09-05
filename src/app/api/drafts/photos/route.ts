import { NextResponse } from "next/server";
import { and, eq, max } from "drizzle-orm";
import { db, one } from "@/db";
import { captureDrafts, captureDraftImages, productImages } from "@/db/schema";
import { companyLifecycleBlock, sessionUser } from "@/lib/authz";
import { saveUploadedImage, deleteUpload } from "@/lib/uploads";
import { readDraft } from "@/lib/drafts";
import { makeLimiter } from "@/lib/rate-limit";

/**
 * Where an ADDENDUM lands: one photo added to a capture after it was sealed.
 *
 * A sealed capture's payload is frozen — a lost acknowledgement means the
 * server may already hold it, so the phone never resends a changed version
 * under the same id. Extra evidence therefore travels on its own: its own
 * id (unique here, so a redelivery finds its row), a reference to the
 * capture it belongs to, and a photo. Answers are shaped for a retrying
 * machine, like /api/drafts: 2xx means safe to delete from the phone, 409
 * means the capture itself has not arrived yet (try later, after it), 410
 * means the capture was put aside (a person decides), 5xx means later.
 *
 * One photo per addendum, by design: the unique id is on the image row.
 */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const addendumLimiter = makeLimiter({ max: 300, windowMs: 10 * 60 * 1000 });

export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const blocked = await companyLifecycleBlock(user);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });
  if (addendumLimiter.hit(`u${user.id}`)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const declared = request.headers.get("content-length");
  if (declared === null) return NextResponse.json({ error: "length-required" }, { status: 411 });
  const declaredBytes = Number(declared);
  if (!Number.isFinite(declaredBytes) || declaredBytes > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }
  const addendumId = String(form.get("addendumId") ?? "").trim().slice(0, 80);
  const captureClientId = String(form.get("captureClientId") ?? "").trim().slice(0, 80);
  const file = form.getAll("images").find((f): f is File => f instanceof File && f.size > 0);
  if (!addendumId || !captureClientId || !file) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // Redelivery: the photo is already here.
  const existing = await db
    .select({ id: captureDraftImages.id })
    .from(captureDraftImages)
    .where(
      and(
        eq(captureDraftImages.companyId, user.companyId),
        eq(captureDraftImages.clientAddendumId, addendumId),
      ),
    )
    .limit(1)
    .then(one);
  if (existing) return NextResponse.json({ imageId: existing.id, duplicate: true }, { status: 200 });

  const draft = await db
    .select({ id: captureDrafts.id, status: captureDrafts.status, productId: captureDrafts.productId })
    .from(captureDrafts)
    .where(and(eq(captureDrafts.companyId, user.companyId), eq(captureDrafts.clientId, captureClientId)))
    .limit(1)
    .then(one);
  if (!draft) return NextResponse.json({ error: "capture-not-arrived" }, { status: 409 });
  if (draft.status === "discarded") return NextResponse.json({ error: "capture-discarded" }, { status: 410 });

  let path: string;
  try {
    path = await saveUploadedImage(user.companyId, file);
  } catch {
    return NextResponse.json({ error: "image-error" }, { status: 400 });
  }

  let imageId: number;
  try {
    imageId = await db.transaction(async (tx) => {
      const [{ last }] = await tx
        .select({ last: max(captureDraftImages.sortOrder) })
        .from(captureDraftImages)
        .where(eq(captureDraftImages.draftId, draft.id));
      const [row] = await tx
        .insert(captureDraftImages)
        .values({
          companyId: user.companyId,
          draftId: draft.id,
          path,
          role: "image",
          sortOrder: (last ?? -1) + 1,
          clientAddendumId: addendumId,
        })
        .returning({ id: captureDraftImages.id });
      // Evidence for a capture already promoted goes onto its product as
      // well: the reviewer finished, the photo still belongs with the item.
      if (draft.status === "imported" && draft.productId !== null) {
        const [{ lastProduct }] = await tx
          .select({ lastProduct: max(productImages.sortOrder) })
          .from(productImages)
          .where(eq(productImages.productId, draft.productId));
        await tx.insert(productImages).values({
          companyId: user.companyId,
          productId: draft.productId,
          path,
          sortOrder: (lastProduct ?? -1) + 1,
        });
      }
      return row.id;
    });
  } catch {
    // A redelivery raced this one onto the unique id, or the write failed:
    // this attempt's file goes, and the answer is whatever the row says.
    await deleteUpload(path);
    const row = await db
      .select({ id: captureDraftImages.id })
      .from(captureDraftImages)
      .where(eq(captureDraftImages.clientAddendumId, addendumId))
      .limit(1)
      .then(one);
    return row
      ? NextResponse.json({ imageId: row.id, duplicate: true }, { status: 200 })
      : NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // A capture the AI has not read yet gets read with its new photo; one
  // already read is not re-spent on — "Read again" on the drafts page is
  // the reviewer's call.
  if (draft.status === "pending") {
    void readDraft(user.companyId, draft.id).catch(() => {});
  }

  return NextResponse.json({ imageId, duplicate: false }, { status: 201 });
}
