import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg"],
  // The PDF export reads the CJK font files (and pdfkit its bundled data)
  // from disk at runtime; the standalone tracer can't see fs reads, so they
  // must be traced in by hand or the docker image 500s on export.
  outputFileTracingIncludes: {
    "/api/orders/[id]/export": [
      "./src/assets/fonts/**",
      "./node_modules/pdfkit/js/data/**",
    ],
  },
  experimental: {
    serverActions: {
      // Product photos and supplier documents are submitted through server
      // actions; the 1MB default rejects a single phone photo with a bare
      // 500 page before any of our code runs. Sized for a batch of photos
      // plus multipart overhead — per-file limits are enforced in uploads.ts.
      bodySizeLimit: "40mb",
    },
  },
  // Baseline hardening for the day this leaves the NAS for a public server.
  // No Content-Security-Policy yet: Next's inline hydration scripts need a
  // per-request nonce, which is a project of its own.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // The app has no reason to ever be framed — kills clickjacking.
          { key: "X-Frame-Options", value: "DENY" },
          // Browsers must trust our Content-Type, not sniff their own.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Internal URLs (order ids, filenames) stay out of third-party logs.
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
