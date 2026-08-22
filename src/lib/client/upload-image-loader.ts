import type { ImageLoaderProps } from "next/image";

/**
 * Keeps authenticated uploads out of Next's cookie-less server optimizer.
 * The browser requests this URL directly, while the upload route performs the
 * resize after checking the session and tenant.
 */
export function authenticatedUploadLoader({ src, width }: ImageLoaderProps) {
  return `${src}${src.includes("?") ? "&" : "?"}w=${width}`;
}
