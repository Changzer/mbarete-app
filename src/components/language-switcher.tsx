"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { routing, LOCALE_LABELS, type Locale } from "@/i18n/routing";
import { useTranslations } from "next-intl";

/**
 * A select, not the old English/中文 toggle: a toggle can only ever express two
 * languages, and there are four. Native <select> on purpose — it is one tag,
 * it is keyboard- and screen-reader-correct for free, and on a phone it opens
 * the platform's own wheel, which is a better picker than anything built here.
 */
export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const t = useTranslations("common");

  return (
    <label className="relative inline-flex">
      <span className="sr-only">{t("language")}</span>
      <select
        value={locale}
        onChange={(e) =>
          router.replace(
            // @ts-expect-error next-intl typed routes can't infer dynamic params here
            { pathname, params },
            { locale: e.target.value as Locale },
          )
        }
        className="h-9 min-h-[36px] cursor-pointer appearance-none rounded-field border border-line bg-surface py-0 pl-3 pr-8 text-[13px] font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sub"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </label>
  );
}
