import type { Locale } from "@/i18n/routing";

export function localizeField(
  locale: Locale,
  en: string,
  zh: string,
) {
  return locale === "zh" ? zh || en : en || zh;
}
