"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { joinWaitlist, type WaitlistResult } from "@/lib/actions/waitlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function errorText(t: ReturnType<typeof useTranslations>, result: WaitlistResult | undefined) {
  if (!result?.error) return null;
  switch (result.error) {
    case "rate-limited":
      return t("errorRateLimited");
    case "invalid-mobile":
      return t("errorMobile");
    default:
      return t("errorInvalid");
  }
}

export function WaitlistForm() {
  const t = useTranslations("landing.form");
  const [result, formAction, isPending] = useActionState(joinWaitlist, undefined);
  const message = errorText(t, result);

  if (result?.ok) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-ok" aria-hidden />
        <p className="text-lg font-semibold text-ink">{t("thanksTitle")}</p>
        <p className="max-w-sm text-sm text-sub">{t("thanksBody")}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wl-name">{t("name")}</Label>
          <Input id="wl-name" name="name" autoComplete="name" required maxLength={120} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wl-company">{t("companyName")}</Label>
          <Input id="wl-company" name="companyName" autoComplete="organization" required maxLength={120} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wl-email">{t("email")}</Label>
          <Input id="wl-email" name="email" type="email" autoComplete="email" required maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wl-mobile">{t("mobile")}</Label>
          <Input
            id="wl-mobile"
            name="mobile"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={t("mobilePlaceholder")}
            required
          />
          <p className="text-xs text-sub">{t("mobileHelp")}</p>
        </div>
      </div>
      {message ? <p className="text-sm text-danger">{message}</p> : null}
      <Button type="submit" disabled={isPending} className="mt-1 sm:self-start">
        {isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
