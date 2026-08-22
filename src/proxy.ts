import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { routing } from "@/i18n/routing";

const intlMiddleware = createMiddleware(routing);

function isPublicPath(pathname: string) {
  const withoutLocale = pathname.replace(/^\/(en|zh)/, "") || "/";
  return (
    withoutLocale.startsWith("/login") ||
    withoutLocale.startsWith("/signup") ||
    withoutLocale.startsWith("/invite/")
  );
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (!req.auth && !isPublicPath(pathname)) {
    const locale = pathname.startsWith("/zh") ? "zh" : routing.defaultLocale;
    const loginUrl = new URL(`/${locale}/login`, req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return intlMiddleware(req);
});

export const config = {
  // logo.png must stay out of the middleware: the i18n router would rewrite
  // the request to /en/logo.png and 404 it, real file or not. Same for the
  // PWA files — the manifest, its icons, and the service worker script,
  // which must additionally be served from the origin root to control it.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|logo.png|uploads|manifest.webmanifest|sw.js|icon-192.png|icon-512.png).*)",
  ],
};
