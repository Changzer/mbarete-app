"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The Mbarete brand mark.
 *
 * Prefers the real logo at /logo.png — commit the file to `public/` and it is
 * baked into the image at build time. Until it exists (or if it fails to
 * load), a typographic wordmark in the brand red stands in, with the Chinese
 * trading name underneath, so the app is never unbranded.
 */
export function Brand({
  size = "nav",
}: {
  /** nav: compact for the header · hero: large for the login page ·
   *  doc: a letterhead — present but not shouting over the document */
  size?: "nav" | "hero" | "doc";
}) {
  const [logoMissing, setLogoMissing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // On a full page load the 404 fires before React attaches onError, so the
  // event is lost; a mounted check catches an image that has already failed.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setLogoMissing(true);
  }, []);

  // The lockup is wide (seal + wordmark + trading name), so the height is
  // the constraint and the width follows; the caps stop a huge intrinsic
  // size from shoving the nav links off a phone screen.
  const imgClass =
    size === "hero"
      ? "h-24 w-auto max-w-[320px]"
      : size === "doc"
        ? "h-20 w-auto max-w-[300px]"
        : "h-9 w-auto max-w-[190px]";
  if (!logoMissing) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        ref={imgRef}
        src="/logo.png"
        alt="Mbarete"
        className={`${imgClass} object-contain`}
        onError={() => setLogoMissing(true)}
      />
    );
  }

  // The fallback is the PRODUCT's name alone. The Chinese trading-company
  // name that used to sit beneath it belongs to one tenant, not to the app
  // every tenant sees.
  if (size === "hero") {
    return (
      <div className="flex flex-col items-center border-4 border-action px-6 py-4">
        <span className="text-3xl font-extrabold tracking-[0.2em] text-action-chrome">
          MBARETE
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col border-2 border-action px-2 py-1 leading-none">
      <span className="text-sm font-extrabold tracking-[0.15em] text-action-chrome">
        MBARETE
      </span>
    </div>
  );
}
