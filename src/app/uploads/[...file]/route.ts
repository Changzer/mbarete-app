import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import {
  uploadsDir,
  isSafeUploadName,
  requiresUploadAuth,
  isGatedUploadName,
  uploadCompanyId,
  CONTENT_TYPES,
} from "@/lib/uploads";
import { sessionUser } from "@/lib/authz";

const IMAGE_EXTENSIONS = new Set(["jpg", "png", "webp", "gif"]);
// A finite set prevents arbitrary query strings from filling the derivative
// cache. Pick the first size that is at least as wide as the browser asks.
const IMAGE_WIDTHS = [64, 96, 128, 256, 384, 640, 828, 1080, 1600] as const;

function requestedWidth(request: Request, ext: string): number | null {
  if (!IMAGE_EXTENSIONS.has(ext) || ext === "gif") return null;
  const raw = Number(new URL(request.url).searchParams.get("w"));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return IMAGE_WIDTHS.find((width) => width >= raw) ?? IMAGE_WIDTHS.at(-1)!;
}

async function resizedImage(filename: string, source: Buffer, width: number): Promise<Buffer> {
  const cacheDir = path.join(/* turbopackIgnore: true */ uploadsDir(), ".variants");
  const cacheName = `${filename.replace("/", "--")}-${width}.webp`;
  const cachePath = path.join(cacheDir, cacheName);
  try {
    return await fs.readFile(/* turbopackIgnore: true */ cachePath);
  } catch {
    const { default: sharp } = await import("sharp");
    const output = await sharp(source)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(/* turbopackIgnore: true */ cachePath, output);
    return output;
  }
}

// Tenant-owned uploads include product photos, business cards and QR crops as
// well as financial documents. UUIDs are not authorization: every file in a
// company folder requires a session from that same company. Legacy flat image
// names have no owner metadata, so they retain their pre-tenancy behavior.
// Serves uploaded files from the uploads volume. These cannot live in public/:
// standalone output resolves public/ at build time, so runtime-written files
// there are never served. Paths are `c<companyId>/<uuid>.<ext>`, or bare
// `<uuid>.<ext>` for files from before tenancy existed.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ file: string[] }> },
) {
  const { file } = await ctx.params;
  const filename = file.join("/");

  if (!isSafeUploadName(filename)) {
    return new NextResponse("not found", { status: 404 });
  }

  const ext = filename.split(".").pop()!;

  // Financial files (payment slips, order documents) are gated by their name
  // prefix, because they arrive as photos as often as PDFs and would otherwise
  // ride the open photo path. Legacy pre-prefix documents are still caught by
  // their extension.
  const owner = uploadCompanyId(filename);
  const gated = requiresUploadAuth(filename);
  if (gated) {
    const user = await sessionUser();
    if (!user) {
      return new NextResponse("unauthorized", { status: 401 });
    }
    // A gated file inside a company folder is only that company's to read.
    // Pre-tenancy flat files carry no owner; a signed-in session suffices,
    // exactly as before the folders existed.
    if (owner !== null && owner !== user.companyId) {
      return new NextResponse("not found", { status: 404 });
    }
  }
  const filePath = path.join(/* turbopackIgnore: true */ uploadsDir(), filename);

  try {
    const fileBytes = await fs.readFile(/* turbopackIgnore: true */ filePath);
    const width = requestedWidth(request, ext);
    const responseBytes = width
      ? await resizedImage(filename, fileBytes, width).catch(() => fileBytes)
      : fileBytes;
    return new NextResponse(new Uint8Array(responseBytes), {
      headers: {
        "Content-Type": width && responseBytes !== fileBytes
          ? "image/webp"
          : CONTENT_TYPES[ext] ?? "application/octet-stream",
        // Auth-checked files must never sit in a shared proxy or CDN cache —
        // one user's file handed to the next visitor. But the browser's own
        // cache is fine for photos: their names are immutable UUIDs, and
        // no-store on every catalog image would mean re-downloading the whole
        // catalog on each visit. Financial files (slips, order documents) and
        // non-image files stay no-store — they are the sensitive ones, and
        // they are opened rarely enough that caching buys nothing.
        "Cache-Control": !gated
          ? "public, max-age=31536000, immutable"
          : isGatedUploadName(filename) || !IMAGE_EXTENSIONS.has(ext)
            ? "private, no-store"
            : "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
