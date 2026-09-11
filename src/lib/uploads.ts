import path from "node:path";
import { hasStorageFor } from "@/lib/entitlements";
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
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

// Loading and factory-floor videos for the rebate dossier. Only that one
// checklist item accepts them; the cap is an env knob because a reverse
// proxy in front (Caddy) has to allow the same body size.
const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
export const DOSSIER_VIDEO_MAX_MB = (() => {
  const n = Number(process.env.DOSSIER_VIDEO_MAX_MB);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 250;
})();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Scanned supplier invoices routinely run past 8MB; storage is a NAS volume,
// so the ceiling can be generous.
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_MB = 25;

/** Errors saveUpload throws, so callers can tell the user which rule bit. */
export class UnsupportedFileTypeError extends Error {}
export class FileTooLargeError extends Error {}
/** The company's plan has no storage room left for this file. */
export class StorageFullError extends Error {}

// Uploads deliberately live OUTSIDE public/. Next.js resolves public/ at build
// time in standalone output, so anything written there at runtime is never
// served (404). Files are written here and streamed back by the /uploads route.
export function uploadsDir() {
  return process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
}

/**
 * `<uuid>.<ext>`, optionally inside a per-company folder `c<id>/` — nothing
 * else, no traversal. Flat names are the pre-tenancy era's files, still
 * served so old rows keep their images.
 */
export function isSafeUploadName(name: string) {
  return /^(c\d+\/)?[A-Za-z0-9][A-Za-z0-9-]*\.(jpg|png|webp|gif|pdf|xlsx|xls|docx)$/.test(name);
}

/** The company a stored path belongs to, or null for pre-tenancy flat files. */
export function uploadCompanyId(name: string): number | null {
  const match = /^c(\d+)\//.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * Financial files carry a recognisable prefix so the serving route can demand
 * a session and company ownership for them even when they are photos — unlike
 * product/card photos, a payment slip or a supplier invoice is a record, and a
 * supplier invoice arrives as a JPG as often as a PDF. Without the prefix an
 * image-format invoice would be served on the open photo path.
 */
const RECEIPT_PREFIX = "slip-";
const DOCUMENT_PREFIX = "doc-";
/**
 * Photos attached to a public enquiry. These arrive from strangers with no
 * account, so they carry their own prefix for one reason: without it a flat
 * image name takes the OPEN path in the serving route and is handed to anyone
 * who asks, cached immutably. That would make the domain a free image host for
 * whatever the internet uploads. The prefix puts them behind the platform
 * admin instead — see the /uploads route.
 */
const ENQUIRY_PREFIX = "enq-";
export function isReceiptUploadName(name: string) {
  // The prefix marks slips in either era: flat or inside a company folder.
  return name.replace(/^c\d+\//, "").startsWith(RECEIPT_PREFIX);
}

/** A photo attached to a public enquiry: operator-only, never on the open path. */
export function isEnquiryUploadName(name: string) {
  return name.replace(/^c\d+\//, "").startsWith(ENQUIRY_PREFIX);
}

/** Order documents (supplier invoices, packing lists) — gated like slips. */
export function isDocumentUploadName(name: string) {
  return name.replace(/^c\d+\//, "").startsWith(DOCUMENT_PREFIX);
}

/** Anything the serving route must never hand out without a session + owner check. */
export function isGatedUploadName(name: string) {
  return isReceiptUploadName(name) || isDocumentUploadName(name) || isEnquiryUploadName(name);
}

/** Whether reading a stored path requires an authenticated owner check. */
export function requiresUploadAuth(name: string) {
  const ext = name.split(".").pop() ?? "";
  return (
    uploadCompanyId(name) !== null ||
    isGatedUploadName(name) ||
    new Set(["pdf", "xlsx", "xls", "docx", "mp4", "mov", "webm"]).has(ext)
  );
}

export async function saveUploadedImage(companyId: number, file: File): Promise<string> {
  return saveUpload(companyId, file, ALLOWED_TYPES, MAX_IMAGE_BYTES);
}

/** A payment slip: a photo of the bank receipt, or the receipt PDF itself. */
export async function saveUploadedReceipt(companyId: number, file: File): Promise<string> {
  return saveUpload(
    companyId,
    file,
    { ...ALLOWED_TYPES, "application/pdf": "pdf" },
    MAX_DOCUMENT_BYTES,
    RECEIPT_PREFIX,
  );
}

/** Same store as photos, wider set of types: invoices arrive as PDFs and sheets. */
export async function saveUploadedDocument(companyId: number, file: File): Promise<string> {
  return saveUpload(companyId, file, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, DOCUMENT_PREFIX);
}

/** A dossier video: mp4/mov/webm, gated like every document, capped by DOSSIER_VIDEO_MAX_MB. */
export async function saveUploadedVideo(companyId: number, file: File): Promise<string> {
  return saveUpload(companyId, file, VIDEO_TYPES, DOSSIER_VIDEO_MAX_MB * 1024 * 1024, DOCUMENT_PREFIX);
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

/** Bytes on disk under one company's upload folder; 0 when it has none. */
export async function companyStorageBytes(companyId: number): Promise<number> {
  const dir = path.join(/* turbopackIgnore: true */ uploadsDir(), `c${companyId}`);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      total += (await fs.stat(path.join(dir, entry.name))).size;
    }
    return total;
  } catch {
    return 0;
  }
}

async function saveUpload(
  companyId: number,
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
  // The plan's cap on everything this company stores; unmetered off SaaS.
  if (!(await hasStorageFor(companyId, file.size))) {
    throw new StorageFullError(String(file.size));
  }

  // Each company's files live in their own folder, so serving can check that
  // a gated file belongs to the session's company, and per-company export or
  // deletion is a folder operation.
  const dir = path.join(/* turbopackIgnore: true */ uploadsDir(), `c${companyId}`);
  await fs.mkdir(dir, { recursive: true });

  const filename = `${prefix}${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const target = path.join(/* turbopackIgnore: true */ dir, filename);
  await fs.writeFile(/* turbopackIgnore: true */ target, buffer);

  return `/uploads/c${companyId}/${filename}`;
}

/** How many photos one enquiry may carry, and how big each may arrive. */
export const ENQUIRY_IMAGE_MAX = 4;
export const ENQUIRY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * A photo attached to a public enquiry — a buyer showing us the thing they
 * want made.
 *
 * Unlike every other saver here there is no company and no plan behind it, so
 * there is no storage entitlement to check and no per-company folder to write
 * into. That also means nothing about the sender is trusted, and the bytes get
 * treated accordingly: instead of believing `file.type` and writing the buffer
 * through, the image is DECODED AND RE-ENCODED through sharp. That single step
 * does four jobs at once —
 *
 *   - it proves the bytes really are an image, which a declared MIME type
 *     never does and a polyglot file exploits,
 *   - it drops EXIF, so a buyer's phone does not hand us their home GPS
 *     coordinates along with a photo of a backpack,
 *   - it bounds the pixels, so a decompression-bomb PNG cannot be stored and
 *     re-decoded later by the operator panel,
 *   - it normalises everything to one format, so the serving route has one
 *     content type to reason about.
 */
export async function saveUploadedEnquiryImage(file: File): Promise<string> {
  if (file.size > ENQUIRY_IMAGE_MAX_BYTES) {
    throw new FileTooLargeError(String(file.size));
  }
  const { default: sharp } = await import("sharp");
  const source = Buffer.from(await file.arrayBuffer());

  let output: Buffer;
  try {
    output = await sharp(source, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    // sharp could not decode it, so it is not an image whatever it claimed.
    throw new UnsupportedFileTypeError(file.type || file.name);
  }

  const dir = uploadsDir();
  await fs.mkdir(/* turbopackIgnore: true */ dir, { recursive: true });
  const filename = `${ENQUIRY_PREFIX}${crypto.randomUUID()}.webp`;
  await fs.writeFile(/* turbopackIgnore: true */ path.join(dir, filename), output);
  return `/uploads/${filename}`;
}

/**
 * A product thumbnail produced server-side (the transcription pass crops the
 * main product out of the booth photo). Already-encoded JPEG bytes, same
 * per-company folder as every other upload.
 */
export async function saveThumbnail(companyId: number, jpeg: Buffer): Promise<string> {
  const dir = path.join(/* turbopackIgnore: true */ uploadsDir(), `c${companyId}`);
  await fs.mkdir(dir, { recursive: true });
  const filename = `thumb-${crypto.randomUUID()}.jpg`;
  await fs.writeFile(path.join(/* turbopackIgnore: true */ dir, filename), jpeg);
  return `/uploads/c${companyId}/${filename}`;
}

export async function deleteUpload(publicPath: string) {
  const filename = publicPath.replace(/^\/uploads\//, "");
  if (!isSafeUploadName(filename)) return;
  const target = path.join(/* turbopackIgnore: true */ uploadsDir(), filename);
  await fs.unlink(/* turbopackIgnore: true */ target).catch(() => {});

  // Resized variants use this deterministic prefix. They are derived data,
  // so deleting the original must not leave them consuming the NAS volume.
  const variantDir = path.join(/* turbopackIgnore: true */ uploadsDir(), ".variants");
  const prefix = `${filename.replace("/", "--")}-`;
  const variants = await fs.readdir(/* turbopackIgnore: true */ variantDir).catch(() => []);
  await Promise.all(
    variants
      .filter((name) => name.startsWith(prefix))
      .map((name) => fs.unlink(path.join(variantDir, name)).catch(() => {})),
  );
}
