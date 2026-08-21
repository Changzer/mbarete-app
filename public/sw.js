/**
 * Service worker: full-page loads keep working while the server is out of
 * reach, on deployments where a service worker is allowed to exist at all.
 *
 * Browsers only run service workers on secure origins, and this app's default
 * deployment is plain HTTP on a LAN / Tailscale IP — there this file is never
 * registered (see sw-register.tsx) and everything behaves exactly as before.
 * Put the app behind HTTPS (e.g. `tailscale serve`, or a reverse proxy with a
 * certificate) and reloads of already-visited pages start surviving offline.
 *
 * The strategy is deliberately conservative:
 * - `/_next/static/` is content-hashed and immutable: cache-first.
 * - `/uploads/` photos live under one-time UUID names: cache-first, capped.
 * - Page loads (`mode === "navigate"`): network-first, falling back to the
 *   last good copy of that same URL. Nothing is precached — a page must have
 *   been visited to be available offline, and a working server always wins,
 *   so stale HTML never outlives connectivity.
 * - `/api/` and non-GET requests are never touched. Server-action POSTs and
 *   the outbox keep their own semantics.
 */

const VERSION = "v1";
const STATIC_CACHE = `mbarete-static-${VERSION}`;
const PAGE_CACHE = `mbarete-pages-${VERSION}`;
const IMAGE_CACHE = `mbarete-images-${VERSION}`;
const KNOWN_CACHES = [STATIC_CACHE, PAGE_CACHE, IMAGE_CACHE];

/** More cached photos than this and the oldest start being evicted. */
const IMAGE_CACHE_CAP = 300;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (!KNOWN_CACHES.includes(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(STATIC_CACHE, request));
    return;
  }

  if (url.pathname.startsWith("/uploads/")) {
    event.respondWith(cacheFirst(IMAGE_CACHE, request, IMAGE_CACHE_CAP));
    return;
  }

  // Only full document loads. RSC/soft-navigation fetches are left alone:
  // their URLs carry state-dependent params and caching them risks serving
  // one page's payload to another.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(PAGE_CACHE, request));
  }
});

async function cacheFirst(cacheName, request, cap) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    if (cap) await enforceCap(cache, cap);
  }
  return response;
}

async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    // Only clean 200s are kept: redirects (the bare locale roots) and error
    // pages must not become what offline serves forever after.
    if (response.ok && response.type === "basic" && !response.redirected) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

async function enforceCap(cache, cap) {
  const keys = await cache.keys();
  // Insertion order approximates age; drop from the front.
  for (let i = 0; i < keys.length - cap; i++) {
    await cache.delete(keys[i]);
  }
}
