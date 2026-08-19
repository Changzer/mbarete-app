import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      // Product photos and supplier documents are submitted through server
      // actions; the 1MB default rejects a single phone photo with a bare
      // 500 page before any of our code runs. Sized for a batch of photos
      // plus multipart overhead — per-file limits are enforced in uploads.ts.
      bodySizeLimit: "40mb",
    },
  },
};

export default withNextIntl(nextConfig);
