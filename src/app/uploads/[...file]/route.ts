import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import {
  uploadsDir,
  isSafeUploadName,
  isReceiptUploadName,
  uploadCompanyId,
  CONTENT_TYPES,
} from "@/lib/uploads";
import { sessionUser } from "@/lib/authz";

// Anything that is not a product photo is an order document — supplier
// invoices, bank details, bills of lading — and must not be readable without
// signing in, by someone from the company that owns it. Photos stay open:
// their names are unguessable UUIDs, and the image optimizer fetches them
// server-side without the user's cookies, so gating them would break every
// picture in the catalog.
const DOCUMENT_EXTENSIONS = new Set(["pdf", "xlsx", "xls", "docx"]);

// Serves uploaded files from the uploads volume. These cannot live in public/:
// standalone output resolves public/ at build time, so runtime-written files
// there are never served. Paths are `c<companyId>/<uuid>.<ext>`, or bare
// `<uuid>.<ext>` for files from before tenancy existed.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ file: string[] }> },
) {
  const { file } = await ctx.params;
  const filename = file.join("/");

  if (!isSafeUploadName(filename)) {
    return new NextResponse("not found", { status: 404 });
  }

  const ext = filename.split(".").pop()!;

  // Payment slips are photos as often as PDFs, so they are gated by their
  // name prefix rather than by extension like other documents.
  const gated = DOCUMENT_EXTENSIONS.has(ext) || isReceiptUploadName(filename);
  if (gated) {
    const user = await sessionUser();
    if (!user) {
      return new NextResponse("unauthorized", { status: 401 });
    }
    // A gated file inside a company folder is only that company's to read.
    // Pre-tenancy flat files carry no owner; a signed-in session suffices,
    // exactly as before the folders existed.
    const owner = uploadCompanyId(filename);
    if (owner !== null && owner !== user.companyId) {
      return new NextResponse("not found", { status: 404 });
    }
  }
  const filePath = path.join(/* turbopackIgnore: true */ uploadsDir(), filename);

  try {
    const fileBytes = await fs.readFile(/* turbopackIgnore: true */ filePath);
    return new NextResponse(new Uint8Array(fileBytes), {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        // Gated files were served with a session check — "private" keeps a
        // shared proxy or CDN from caching one signed-in user's invoice and
        // handing it to the next visitor.
        "Cache-Control": gated
          ? "private, max-age=3600"
          : "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
