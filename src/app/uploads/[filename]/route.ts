import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { uploadsDir, isSafeUploadName, CONTENT_TYPES } from "@/lib/uploads";
import { auth } from "@/lib/auth";

// Anything that is not a product photo is an order document — supplier
// invoices, bank details, bills of lading — and must not be readable without
// signing in. Photos stay open: their names are unguessable UUIDs, and the
// image optimizer fetches them server-side without the user's cookies, so
// gating them would break every picture in the catalog.
const DOCUMENT_EXTENSIONS = new Set(["pdf", "xlsx", "xls", "docx"]);

// Serves uploaded files from the uploads volume. These cannot live in public/:
// standalone output resolves public/ at build time, so runtime-written files
// there are never served.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ filename: string }> },
) {
  const { filename } = await ctx.params;

  if (!isSafeUploadName(filename)) {
    return new NextResponse("not found", { status: 404 });
  }

  const ext = filename.split(".").pop()!;

  if (DOCUMENT_EXTENSIONS.has(ext)) {
    const session = await auth();
    if (!session?.user) {
      return new NextResponse("unauthorized", { status: 401 });
    }
  }
  const filePath = path.join(/* turbopackIgnore: true */ uploadsDir(), filename);

  try {
    const file = await fs.readFile(/* turbopackIgnore: true */ filePath);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
