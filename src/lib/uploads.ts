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

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Scanned supplier invoices routinely run past 8MB; storage is a NAS volume,
// so the ceiling can be generous.
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_MB = 25;

/** Errors saveUpload throws, so callers can tell the user which rule bit. */
export class UnsupportedFileTypeError extends Error {}
export class FileTooLargeError extends Error {}

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

/**
 * Payment slips carry a recognisable prefix so the serving route can demand a
 * session for them even when they are photos — unlike product photos, a slip
 * is a financial record.
 */
const RECEIPT_PREFIX = "slip-";
export function isReceiptUploadName(name: string) {
  return name.startsWith(RECEIPT_PREFIX);
}

export async function saveUploadedImage(file: File): Promise<string> {
  return saveUpload(file, ALLOWED_TYPES, MAX_IMAGE_BYTES);
}

/** A payment slip: a photo of the bank receipt, or the receipt PDF itself. */
export async function saveUploadedReceipt(file: File): Promise<string> {
  return saveUpload(
    file,
    { ...ALLOWED_TYPES, "application/pdf": "pdf" },
    MAX_DOCUMENT_BYTES,
    RECEIPT_PREFIX,
  );
}

/** Same store as photos, wider set of types: invoices arrive as PDFs and sheets. */
export async function saveUploadedDocument(file: File): Promise<string> {
  return saveUpload(file, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES);
}

/**
 * What format a file really is, as far as saving it is concerned.
 *
 * Browsers fill `file.type` from the file's extension — except files handed
 * over by chat apps and mobile file managers, which often arrive typed as
 * `application/octet-stream` or nothing at all. For those the filename
 * extension is the only signal there is, so a missing or generic MIME type
 * falls back to it rather than rejecting a perfectly good PDF from WeChat.
 */
function detectExtension(file: File, allowed: Record<string, string>): string | null {
  const byType = allowed[file.type];
  if (byType) return byType;
  if (file.type && file.type !== "application/octet-stream") return null;

  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  const normalized = fromName === "jpeg" ? "jpg" : fromName;
  return Object.values(allowed).includes(normalized) ? normalized : null;
}

async function saveUpload(
  file: File,
  allowed: Record<string, string>,
  maxBytes: number,
  prefix = "",
): Promise<string> {
  const ext = detectExtension(file, allowed);
  if (!ext) {
    throw new UnsupportedFileTypeError(file.type || file.name);
  }
  if (file.size > maxBytes) {
    throw new FileTooLargeError(String(file.size));
  }

  const dir = uploadsDir();
  await fs.mkdir(dir, { recursive: true });

  const filename = `${prefix}${crypto.randomUUID()}.${ext}`;
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
