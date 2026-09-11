import { getRequestConfig } from "next-intl/server";
import { routing, type Locale } from "./routing";
import en from "../../messages/en.json";

type Messages = typeof en;

/**
 * English under everything, the requested locale on top, key by key.
 *
 * The marketing locales exist for the public page only: pt-BR and es carry its
 * ~60 keys and nothing else, because translating the internal tool's other 800
 * into languages its operators do not read would be work nobody ever reads
 * back. Without a fallback next-intl throws on the first missing key, so a
 * Portuguese visitor who followed a link into the app would meet an error
 * instead of an English screen.
 *
 * Merging rather than picking also means a half-translated namespace degrades
 * key by key: a new English string is live everywhere the moment it lands, in
 * English, until someone translates it.
 */
function deepMerge<T>(base: T, override: unknown): T {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return (override === undefined ? base : (override as T));
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    const current = out[key];
    out[key] =
      current && typeof current === "object" && !Array.isArray(current)
        ? deepMerge(current, value)
        : value;
  }
  return out as T;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = routing.locales.includes(requested as Locale)
    ? (requested as Locale)
    : routing.defaultLocale;

  if (locale === "en") return { locale, messages: en };

  const overrides = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages: deepMerge<Messages>(en, overrides) };
});
