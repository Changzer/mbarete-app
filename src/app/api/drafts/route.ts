import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ingestDraft, readDraft, type IngestFile } from "@/lib/drafts";

/**
 * Where a phone's offline captures land.
 *
 * This is a Route Handler and not a Server Action on purpose. A Server Action
 * is addressed by an id minted at build time and resolved against that build's
 * module map; a capture queued on Monday and delivered after the NAS pulled a
 * new image would come back "Failed to find Server Action" and be permanently
 * undeliverable. A queue that has to survive days of bad signal — and an app
 * update in the middle of them — needs a URL that means the same thing across
 * deploys. Route Handlers are also outside the proxy's matcher, so an expired
 * session answers 401 as JSON instead of a redirect to a login page the outbox
 * would have to parse.
 *
 * Answers are shaped for a machine that will retry: a 2xx means the capture is
 * safe to delete from the phone, a 5xx or a dead socket means try later, and a
 * 4xx means a human has to look. See src/lib/offline/draft.ts.
 */

/** Matches the product form's own ceiling; the phone shrinks photos first. */
const MAX_IMAGES = 8;

/**
 * Route handlers have no body-size limit of their own, and `formData()`
 * buffers the whole body before any per-file rule can run. Nine 8MB photos
 * plus fields and multipart overhead fit comfortably; anything bigger is not
 * a capture this app produced. Checked against Content-Length before parsing
 * so an oversized body is refused without ever being held in memory.
 */
const MAX_BODY_BYTES = 80 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    // Retryable on purpose: the trip outlasted the session, and signing in
    // again makes every queued capture deliverable.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const declaredBytes = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
    // 413 is a refusal retrying cannot fix: the phone parks the capture as
    // "needs attention" instead of re-sending the same oversized body.
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }

  const clientId = String(form.get("clientId") ?? "");
  const capturedAt = String(form.get("capturedAt") ?? "");
  const kind = form.get("kind") === "contact" ? "contact" : "product";

  let fields: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(String(form.get("fields") ?? "{}"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    fields = Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
  } catch {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }

  // Each form slot keeps its role so a contact draft's card photos and QR
  // crop can be told apart when the draft is promoted.
  const slots = [
    { field: "images", role: "image" },
    { field: "cardImages", role: "card" },
  ] as const;
  const files: IngestFile[] = [];
  for (const slot of slots) {
    for (const f of form.getAll(slot.field)) {
      if (f instanceof File && f.size > 0) files.push({ file: f, role: slot.role });
    }
  }
  // The QR crop rides outside the photo cap: it is one small image, and for a
  // contact it is the WeChat handle itself — the one file that must never be
  // the one a cap silently cuts.
  const qr = form.getAll("qrImage").find((f): f is File => f instanceof File && f.size > 0);

  const result = await ingestDraft({
    clientId,
    kind,
    capturedAt,
    fields,
    files: [...files.slice(0, MAX_IMAGES), ...(qr ? [{ file: qr, role: "qr" as const }] : [])],
    userId: Number(session.user.id),
  });

  if (!result.ok) {
    // Neither of these gets better by trying again, so they are 4xx and the
    // phone parks the capture where someone will see it.
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // The capture is on the NAS now, so the phone can be told immediately. The
  // AI read talks to a provider over the internet and can take seconds; making
  // the outbox wait for it would hold the queue behind a slow model on a link
  // that is already marginal.
  if (!result.duplicate) {
    void readDraft(result.draftId).catch(() => {});
  }

  return NextResponse.json(
    { draftId: result.draftId, duplicate: result.duplicate },
    { status: result.duplicate ? 200 : 201 },
  );
}

/**
 * The connectivity probe the capture form runs before choosing a path. On a
 * market network `navigator.onLine` happily reports true while nothing gets
 * through, so the form asks the actual server and gives it three seconds.
 * No auth and no body: reachability is the only question.
 */
export function HEAD() {
  return new Response(null, { status: 204 });
}
