import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const MAX_BYTES = 8 * 1024 * 1024;

// Uploads deliberately live OUTSIDE public/. Next.js resolves public/ at build
// time in standalone output, so anything written there at runtime is never
// served (404). Files are written here and streamed back by the /uploads route.
export function uploadsDir() {
  return process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
}

/** Only ever a bare `<uuid>.<ext>` — no separators, no traversal. */
export function isSafeUploadName(name: string) {
  return /^[A-Za-z0-9][A-Za-z0-9-]*\.(jpg|png|webp|gif)$/.test(name);
}

export async function saveUploadedImage(file: File): Promise<string> {
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    throw new Error("unsupported file type");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("file too large");
  }

  const dir = uploadsDir();
  await fs.mkdir(dir, { recursive: true });

  const filename = `${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, filename), buffer);

  return `/uploads/${filename}`;
}

export async function deleteUpload(publicPath: string) {
  const filename = publicPath.replace(/^\/uploads\//, "");
  if (!isSafeUploadName(filename)) return;
  await fs.unlink(path.join(uploadsDir(), filename)).catch(() => {});
}
