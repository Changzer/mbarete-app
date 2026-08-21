import type { MetadataRoute } from "next";

/**
 * Makes the app installable to a phone's home screen — at the market it is
 * opened like an app, not hunted for in browser history.
 *
 * `start_url` is the catalog rather than `/`: the root is a bare redirect
 * with no HTML of its own, useless as an offline entry point. The service
 * worker (public/sw.js) can only take over on an HTTPS deployment; over
 * plain HTTP this manifest still gives the home-screen icon and standalone
 * window, just not offline starts.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mbarete",
    short_name: "Mbarete",
    description: "Mbarete internal sourcing & procurement tool",
    start_url: "/en/catalog",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#c13a2b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
