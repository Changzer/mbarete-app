import path from "node:path";
import fs from "node:fs/promises";
import { uploadsDir, isSafeUploadName } from "@/lib/uploads";

/**
 * A product photo shrunk to order-sheet size, as JPEG bytes ready for the
 * XLSX/PDF builders to embed. Every failure — a stale path, a deleted file, a
 * corrupt image — returns null: a missing picture must never block a quote.
 */
export type ExportLogo = { data: Buffer; width: number; height: number };

/**
 * The tenant's letterhead logo as PNG bytes plus real dimensions, so the
 * PDF and XLSX builders can place it aspect-true. PNG rather than JPEG:
 * logos are usually marks on transparency, and a white letterhead must not
 * gain a baked-in box. Normalised through sharp because uploads may be
 * WebP, which neither PDFKit nor ExcelJS can embed. Failures return null —
 * a missing logo must never block a quote.
 */
export async function readExportLogo(publicPath: string | null): Promise<ExportLogo | null> {
  if (!publicPath) return null;
  const filename = publicPath.replace(/^\/uploads\//, "");
  if (!isSafeUploadName(filename)) return null;
  try {
    const source = await fs.readFile(
      path.join(/* turbopackIgnore: true */ uploadsDir(), filename),
    );
    const { default: sharp } = await import("sharp");
    const image = sharp(source)
      .rotate()
      .resize(420, 140, { fit: "inside", withoutEnlargement: true })
      .png();
    const { data, info } = await image.toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

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
