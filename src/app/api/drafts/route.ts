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

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    // Retryable on purpose: the trip outlasted the session, and signing in
    // again makes every queued capture deliverable.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
    { field: "qrImage", role: "qr" },
  ] as const;
  const files: IngestFile[] = [];
  for (const slot of slots) {
    for (const f of form.getAll(slot.field)) {
      if (f instanceof File && f.size > 0) files.push({ file: f, role: slot.role });
    }
  }

  const result = await ingestDraft({
    clientId,
    kind,
    capturedAt,
    fields,
    files: files.slice(0, MAX_IMAGES),
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
