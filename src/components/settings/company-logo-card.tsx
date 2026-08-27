"use client";

import { useRef } from "react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { uploadCompanyLogo, removeCompanyLogo } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The tenant's own mark, printed on their proforma letterhead. Lives beside
 * the company details because that is what it is: the visual half of the
 * vendor block. No logo = a clean text-only letterhead, never the
 * platform's.
 */
export function CompanyLogoCard({ logoPath }: { logoPath: string }) {
  const t = useTranslations("company");
  const common = useTranslations("common");
  const fileRef = useRef<HTMLInputElement>(null);
  const [errorMessage, formAction, isPending] = useActionState(uploadCompanyLogo, undefined);

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-1 text-sm font-bold text-ink">{t("logo")}</h3>
        <p className="mb-3 text-xs text-sub">{t("logoHelp")}</p>
        <div className="flex flex-wrap items-center gap-4">
          {logoPath ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={logoPath}
              alt=""
              data-testid="company-logo-preview"
              className="h-16 w-auto max-w-40 rounded border border-line bg-white object-contain p-1"
            />
          ) : (
            <div className="flex h-16 w-24 items-center justify-center rounded border border-dashed border-line text-[11px] text-faint">
              {t("noLogo")}
            </div>
          )}
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp"
              className="max-w-56 text-xs text-sub file:mr-2 file:rounded-[8px] file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink"
              data-testid="logo-file"
            />
            <Button type="submit" size="sm" disabled={isPending} data-testid="logo-upload">
              {t("uploadLogo")}
            </Button>
            {logoPath ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => removeCompanyLogo()}
              >
                {common("delete")}
              </Button>
            ) : null}
          </form>
        </div>
        {errorMessage ? (
          <p className="mt-2 text-xs text-danger">{t("logoError")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
