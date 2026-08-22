"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { requestPasswordReset } from "@/lib/actions/account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotForm() {
  const t = useTranslations("account");
  const [result, formAction, isPending] = useActionState(requestPasswordReset, undefined);

  if (result?.done) {
    return <p className="text-sm text-ink">{t("forgotSent")}</p>;
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" required autoFocus />
      </div>
      {result?.error === "rate-limited" ? (
        <p className="text-sm text-danger">{t("errorRateLimited")}</p>
      ) : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? t("sending") : t("forgotSubmit")}
      </Button>
    </form>
  );
}
