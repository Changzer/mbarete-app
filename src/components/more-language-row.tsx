"use client";

import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Language as a two-up segmented control rather than the header's single
 * toggle button: on the settings surface both choices should be visible, and
 * each label should be readable by whoever is looking for it.
 */
export function MoreLanguageRow() {
  const locale = useLocale();
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();

  const options = [
    { value: "en", label: "English" },
    { value: "zh", label: "中文" },
  ] as const;

  return (
    <div
      className="flex gap-1 rounded-full border border-line bg-surface-2 p-1"
      role="group"
      data-testid="language-choice"
    >
      {options.map(({ value, label }) => {
        const active = locale === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() =>
              router.replace(
                // @ts-expect-error next-intl typed routes can't infer dynamic params here
                { pathname, params },
                { locale: value },
              )
            }
            className={`press focus-ring h-11 flex-1 rounded-full px-3 text-[12.5px] font-semibold ${
              active ? "bg-action text-white" : "text-sub hover:text-ink"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
