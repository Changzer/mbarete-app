import type { ReactNode } from "react";
import "../globals.css";

/**
 * Root layout for the platform operator's corner of the app, outside the
 * locale tree on purpose: the panel is internal, English-only, and shares
 * nothing with the tenant shell — no nav, no outbox, no locale switcher.
 */
export const metadata = {
  title: "Mbarete Platform",
  robots: { index: false, follow: false },
};

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full bg-bg text-ink">{children}</body>
    </html>
  );
}
