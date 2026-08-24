import path from "node:path";
import fs from "node:fs/promises";
import { uploadsDir, isSafeUploadName } from "@/lib/uploads";

/**
 * A product photo shrunk to order-sheet size, as JPEG bytes ready for the
 * XLSX/PDF builders to embed. Every failure — a stale path, a deleted file, a
 * corrupt image — returns null: a missing picture must never block a quote.
 */
export async function readExportThumb(publicPath: string | null): Promise<Buffer | null> {
  if (!publicPath) return null;
  const filename = publicPath.replace(/^\/uploads\//, "");
  if (!isSafeUploadName(filename)) return null;
  if (!/\.(jpg|png|webp)$/.test(filename)) return null;
  try {
    const source = await fs.readFile(
      path.join(/* turbopackIgnore: true */ uploadsDir(), filename),
    );
    const { default: sharp } = await import("sharp");
    return await sharp(source)
      .rotate()
      .resize(120, 120, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
  } catch {
    return null;
  }
}
