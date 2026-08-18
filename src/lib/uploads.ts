import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Order documents: what suppliers actually send. Excel and Word are accepted
// because supplier invoices and packing lists very often arrive as either.
const DOCUMENT_TYPES: Record<string, string> = {
  ...ALLOWED_TYPES,
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
  return /^[A-Za-z0-9][A-Za-z0-9-]*\.(jpg|png|webp|gif|pdf|xlsx|xls|docx)$/.test(name);
}

export async function saveUploadedImage(file: File): Promise<string> {
  return saveUpload(file, ALLOWED_TYPES);
}

/** Same store as photos, wider set of types: invoices arrive as PDFs and sheets. */
export async function saveUploadedDocument(file: File): Promise<string> {
  return saveUpload(file, DOCUMENT_TYPES);
}

async function saveUpload(file: File, allowed: Record<string, string>): Promise<string> {
  const ext = allowed[file.type];
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
  const target = path.join(/* turbopackIgnore: true */ dir, filename);
  await fs.writeFile(/* turbopackIgnore: true */ target, buffer);

  return `/uploads/${filename}`;
}

export async function deleteUpload(publicPath: string) {
  const filename = publicPath.replace(/^\/uploads\//, "");
  if (!isSafeUploadName(filename)) return;
  const target = path.join(/* turbopackIgnore: true */ uploadsDir(), filename);
  await fs.unlink(/* turbopackIgnore: true */ target).catch(() => {});
}
