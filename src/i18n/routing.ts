import { defineRouting } from "next-intl/routing";

/**
 * Two audiences share one locale list, and they do not want the same languages.
 *
 * The public site sells sourcing and export services to importers in Latin
 * America, so it needs Brazilian Portuguese and Spanish. The app behind the
 * login is an internal tool used from Yiwu, so it needs English and Chinese.
 * Rather than run two sites, every locale is routable and the message loader
 * falls back to English per key — a marketing locale carries only the ~60
 * keys the public page uses instead of all 800-odd the internal tool has.
 * See src/i18n/request.ts.
 */
export const routing = defineRouting({
  locales: ["en", "pt-BR", "es", "zh"],
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];

/**
 * What each locale calls itself, for the switcher. Endonyms, not translations:
 * a Brazilian buyer looks for "Português", not "Portuguese".
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português",
  es: "Español",
  zh: "中文",
};

/**
 * The BCP-47 tag to advertise to crawlers, which is not always the path
 * segment. The Spanish copy is written for Latin America (es-419) but the
 * path stays /es: nobody types a UN region code, and hreflang is where the
 * distinction actually earns anything.
 */
export const HREFLANG: Record<Locale, string> = {
  en: "en",
  "pt-BR": "pt-BR",
  es: "es-419",
  zh: "zh-Hans",
};
