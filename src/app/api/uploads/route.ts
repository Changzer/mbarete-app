import { NextResponse } from "next/server";
import { sessionUser } from "@/lib/authz";
import { saveUploadedImage } from "@/lib/uploads";
import { makeLimiter } from "@/lib/rate-limit";

// Each upload writes the volume. A market day of heavy capture is a few
// hundred photos; three hundred per ten minutes never touches a person and
// stops a script from filling the disk.
const uploadLimiter = makeLimiter({ max: 300, windowMs: 10 * 60 * 1000 });

export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (uploadLimiter.hit(`u${user.id}`)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
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
