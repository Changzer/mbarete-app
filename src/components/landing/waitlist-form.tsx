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
  return result.error === "rate-limited" ? t("errorRateLimited") : t("errorInvalid");
}

export function WaitlistForm() {
  const t = useTranslations("landing.form");
  const [result, formAction, isPending] = useActionState(joinWaitlist, undefined);
  const message = errorText(t, result);

  if (result?.ok) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-8 text-center"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="h-10 w-10 text-ok" aria-hidden />
        <p className="text-lg font-semibold text-ink">{t("thanksTitle")}</p>
        <p className="max-w-sm text-sm text-sub">{t("thanksBody")}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <h3 className="sr-only">{t("formTitle")}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wl-name">{t("name")}</Label>
          <Input id="wl-name" name="name" autoComplete="name" required maxLength={120} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wl-company">{t("companyName")}</Label>
          <Input
            id="wl-company"
            name="companyName"
            autoComplete="organization"
            required
            maxLength={120}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wl-email">{t("email")}</Label>
          <Input id="wl-email" name="email" type="email" autoComplete="email" required maxLength={200} />
        </div>
        {/* Optional, and free text: a WeChat ID is not a phone number, and the
            import teams this page is written for are not all in China. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wl-contact">
            {t("preferredContact")}{" "}
            <span className="font-normal text-faint">— {t("preferredContactOptional")}</span>
          </Label>
          <Input
            id="wl-contact"
            name="preferredContact"
            autoComplete="tel"
            placeholder={t("preferredContactPlaceholder")}
            maxLength={200}
          />
        </div>
      </div>
      {message ? (
        <p className="text-sm text-danger" role="alert">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={isPending} size="lg" className="mt-1">
        {isPending ? t("submitting") : t("submit")}
      </Button>
      <p className="text-center text-xs text-sub">{t("privacy")}</p>
    </form>
  );
}
