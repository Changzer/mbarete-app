import "server-only";
import { saveThumbnail } from "@/lib/uploads";
import type { TranscribeImage, ThumbBox } from "@/lib/transcribe-product";

/**
 * Cuts the model's proposed bounding box out of the photo it named and saves
 * it as a company thumbnail file, answering the stored path.
 *
 * Shared by the two places a product reading happens — the live "fill from
 * photos" action and the offline draft read — so a capture made at the booth
 * gets the same thumbnail a live scan would. Best-effort on purpose: a
 * failed crop must never turn a good field reading into a failed
 * transcription, so every failure answers undefined and logs.
 */
export async function cropAndSaveThumb(
  companyId: number,
  images: TranscribeImage[],
  thumb: { imageIndex: number; box: ThumbBox },
): Promise<string | undefined> {
  try {
    const source = Buffer.from(images[thumb.imageIndex - 1].data, "base64");
    const { box } = thumb;
    const { default: sharp } = await import("sharp");
    const meta = await sharp(source).rotate().metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width <= 0 || height <= 0) return undefined;

    const left = Math.floor((box.left / 1000) * width);
    const top = Math.floor((box.top / 1000) * height);
    const cropWidth = Math.min(width - left, Math.ceil(((box.right - box.left) / 1000) * width));
    const cropHeight = Math.min(height - top, Math.ceil(((box.bottom - box.top) / 1000) * height));
    if (cropWidth <= 16 || cropHeight <= 16) return undefined;

    const jpeg = await sharp(source)
      .rotate()
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return await saveThumbnail(companyId, jpeg);
  } catch (error) {
    console.error("[transcribe] thumbnail crop failed:", error);
    return undefined;
  }
}
