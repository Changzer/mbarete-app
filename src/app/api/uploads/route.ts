import { NextResponse } from "next/server";
import { sessionUser } from "@/lib/authz";
import { saveUploadedImage } from "@/lib/uploads";

export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
