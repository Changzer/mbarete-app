"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();

  const nextLocale = locale === "en" ? "zh" : "en";

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        router.replace(
          // @ts-expect-error next-intl typed routes can't infer dynamic params here
          { pathname, params },
          { locale: nextLocale },
        )
      }
    >
      {locale === "en" ? "中文" : "English"}
    </Button>
  );
}
