import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { saveUploadedImage } from "@/lib/uploads";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  try {
    const uploadedPath = await saveUploadedImage(file);
    return NextResponse.json({ path: uploadedPath });
  } catch {
    return NextResponse.json({ error: "upload failed" }, { status: 400 });
  }
}
