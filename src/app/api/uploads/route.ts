import { NextResponse } from "next/server";
import { companyLifecycleBlock, sessionUser } from "@/lib/authz";
import { saveUploadedImage } from "@/lib/uploads";
import { makeLimiter } from "@/lib/rate-limit";

// Each upload writes the volume. A market day of heavy capture is a few
// hundred photos; three hundred per ten minutes never touches a person and
// stops a script from filling the disk.
const uploadLimiter = makeLimiter({ max: 300, windowMs: 10 * 60 * 1000 });

// One photo (8MB cap in uploads.ts) plus multipart overhead. Checked against
// Content-Length before the body is parsed, and a body with no length at all
// is refused outright: formData() would otherwise buffer a chunked upload to
// its end, whatever that end is.
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const blocked = await companyLifecycleBlock(user);
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 403 });
  }
  if (uploadLimiter.hit(`u${user.id}`)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const declared = request.headers.get("content-length");
  if (declared === null) {
    return NextResponse.json({ error: "length-required" }, { status: 411 });
  }
  const declaredBytes = Number(declared);
  if (!Number.isFinite(declaredBytes) || declaredBytes > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  try {
    const uploadedPath = await saveUploadedImage(user.companyId, file);
    return NextResponse.json({ path: uploadedPath });
  } catch {
    return NextResponse.json({ error: "upload failed" }, { status: 400 });
  }
}
