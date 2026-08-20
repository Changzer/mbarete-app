import jsQR from "jsqr";
import { locateQr, type QrBounds } from "@/lib/client/find-qr";

/**
 * Finds a QR code in a card photo and crops it out, entirely in the browser.
 *
 * WeChat contact QRs cannot be turned into a WeChat ID (the payload is an
 * opaque URL only WeChat resolves), but the QR image itself is scannable
 * straight off a screen — so the crop is uploaded with the contact and shown
 * next to the WeChat field, ready to scan.
 *
 * Because the payload is never wanted, the code does not have to be readable
 * to be worth cropping. Two passes, in order of precision:
 *
 *  1. Decode it. jsQR returns the corners it resolved, which is the tightest
 *     crop available — and it is quick when the card was photographed flat.
 *  2. Failing that, just locate it (see find-qr.ts). A card held up in front
 *     of a phone is tilted, and past about 15° no decoder manages the modules,
 *     while the finder patterns stay perfectly visible. WeChat reads the crop
 *     off the screen from any angle, so locating is enough.
 */

/** Detection resolution: enough for a card-sized QR, cheap to scan. */
const MAX_EDGE = 1500;
/** Second look for a code that is small in the frame — a card held at arm's length. */
const MAX_EDGE_FINE = 2600;

export async function extractQrFromImage(file: File): Promise<File | null> {
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const full = { width: img.naturalWidth, height: img.naturalHeight };
      if (!full.width || !full.height) return null;

      for (const maxEdge of [MAX_EDGE, MAX_EDGE_FINE]) {
        const scale = Math.min(1, maxEdge / Math.max(full.width, full.height));
        // A second pass at the same size would only repeat the first.
        if (maxEdge !== MAX_EDGE && scale >= 1) break;

        const width = Math.max(1, Math.round(full.width * scale));
        const height = Math.max(1, Math.round(full.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height);

        const bounds = decodeBounds(pixels, width, height) ?? locateQr(pixels.data, width, height);
        if (!bounds) continue;

        const crop = cropFromOriginal(img, bounds, scale, full);
        if (crop) return crop;
      }
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    // No QR, an undecodable image, or an old browser: the card photo itself
    // remains the fallback, as before.
    return null;
  }
}

/** The corners jsQR resolved, when the code was readable outright. */
function decodeBounds(pixels: ImageData, width: number, height: number): QrBounds | null {
  const code = jsQR(pixels.data, width, height);
  if (!code) return null;
  const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = code.location;
  const xs = [topLeftCorner.x, topRightCorner.x, bottomLeftCorner.x, bottomRightCorner.x];
  const ys = [topLeftCorner.y, topRightCorner.y, bottomLeftCorner.y, bottomRightCorner.y];
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  // Quiet zone around the code, so scanners lock on easily.
  const pad = 0.16 * Math.max(spanX, spanY);
  return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: spanX + pad * 2, height: spanY + pad * 2 };
}

/**
 * Cuts the located area out of the ORIGINAL image, at full resolution — the
 * scan runs on a shrunken copy, but the crop that gets scanned later should
 * carry every pixel the camera captured.
 */
function cropFromOriginal(
  img: HTMLImageElement,
  bounds: QrBounds,
  scale: number,
  full: { width: number; height: number },
): Promise<File | null> {
  const sx = Math.max(0, Math.min(full.width, bounds.x / scale));
  const sy = Math.max(0, Math.min(full.height, bounds.y / scale));
  const sw = Math.min(full.width - sx, bounds.width / scale);
  const sh = Math.min(full.height - sy, bounds.height / scale);
  if (sw < 40 || sh < 40) return Promise.resolve(null);

  const crop = document.createElement("canvas");
  crop.width = Math.round(sw);
  crop.height = Math.round(sh);
  const ctx = crop.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  // Anything the crop overhangs lands on white, matching a card's paper.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, crop.width, crop.height);

  return new Promise<Blob | null>((resolve) => crop.toBlob(resolve, "image/png")).then((blob) =>
    blob ? new File([blob], "wechat-qr.png", { type: "image/png" }) : null,
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
