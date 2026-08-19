/**
 * Client-side photo shrinking, for phones at a supplier's stall.
 *
 * A modern phone camera produces 3–8MB per shot; over Tailscale through the
 * Chinese firewall that is a slow, failure-prone upload for a catalog thumb
 * that will be viewed at a few hundred pixels. Re-encoding in the browser
 * before submit keeps uploads fast, and as a side effect converts formats
 * the server does not accept (iPhone HEIC) into plain JPEG — Safari can
 * decode its own HEIC even though nothing else can.
 *
 * Anything that cannot be decoded is returned untouched and left to the
 * server's own validation, which answers with a message instead of saving.
 */

const MAX_EDGE_PX = 1800;
const JPEG_QUALITY = 0.85;
/** Under this size the original is already cheap to ship; keep it verbatim. */
const SKIP_BELOW_BYTES = 1024 * 1024;

/** Formats the server accepts as-is (see src/lib/uploads.ts). */
const SERVER_ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function decode(file: File): Promise<ImageBitmap | null> {
  try {
    // "from-image" applies the EXIF rotation phones record instead of
    // baking sideways pixels into the re-encoded copy.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      return null;
    }
  }
}

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  // Re-encoding a GIF would keep one frame and drop the rest.
  if (file.type === "image/gif") return file;

  const accepted = SERVER_ACCEPTED.has(file.type);
  if (accepted && file.size <= SKIP_BELOW_BYTES) return file;

  const bitmap = await decode(file);
  if (!bitmap) return file;

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  // Transparency (PNG logos) lands on white, matching the catalog's card.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) return file;
  // If shrinking did not actually help, only swap formats the server would
  // otherwise reject (HEIC); an accepted original stays untouched.
  if (accepted && blob.size >= file.size) return file;

  const stem = file.name.replace(/\.[A-Za-z0-9]+$/, "") || "photo";
  return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
}
