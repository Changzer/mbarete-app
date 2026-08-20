import jsQR from "jsqr";

/**
 * Finds a QR code in a card photo and crops it out, entirely in the browser.
 *
 * WeChat contact QRs cannot be turned into a WeChat ID (the payload is an
 * opaque URL only WeChat resolves), but the QR image itself is scannable
 * straight off a screen — so the crop is uploaded with the contact and shown
 * next to the WeChat field, ready to scan.
 */
export async function extractQrFromImage(file: File): Promise<File | null> {
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);

      // Detection resolution: enough for a card-sized QR, cheap to scan.
      const maxEdge = 1500;
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, width, height);

      const pixels = ctx.getImageData(0, 0, width, height);
      const code = jsQR(pixels.data, width, height);
      if (!code) return null;

      const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } =
        code.location;
      const xs = [topLeftCorner.x, topRightCorner.x, bottomLeftCorner.x, bottomRightCorner.x];
      const ys = [topLeftCorner.y, topRightCorner.y, bottomLeftCorner.y, bottomRightCorner.y];
      // Quiet zone around the code, so scanners lock on easily.
      const pad = 0.16 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const x = Math.max(0, Math.min(...xs) - pad);
      const y = Math.max(0, Math.min(...ys) - pad);
      const w = Math.min(width - x, Math.max(...xs) - Math.min(...xs) + pad * 2);
      const h = Math.min(height - y, Math.max(...ys) - Math.min(...ys) + pad * 2);
      if (w < 40 || h < 40) return null;

      // Re-crop from the ORIGINAL image at full resolution for a crisp code.
      const crop = document.createElement("canvas");
      const cropW = Math.round(w / scale);
      const cropH = Math.round(h / scale);
      crop.width = cropW;
      crop.height = cropH;
      const cropCtx = crop.getContext("2d");
      if (!cropCtx) return null;
      cropCtx.fillStyle = "#ffffff";
      cropCtx.fillRect(0, 0, cropW, cropH);
      cropCtx.drawImage(img, x / scale, y / scale, cropW, cropH, 0, 0, cropW, cropH);

      const blob = await new Promise<Blob | null>((resolve) =>
        crop.toBlob(resolve, "image/png"),
      );
      if (!blob) return null;
      return new File([blob], "wechat-qr.png", { type: "image/png" });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    // No QR, an undecodable image, or an old browser: the card photo itself
    // remains the fallback, as before.
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
