"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { resetPassword, type ResetResult } from "@/lib/actions/account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function errorText(t: ReturnType<typeof useTranslations<"account">>, result?: ResetResult) {
  if (!result?.error) return null;
  switch (result.error) {
    case "invalid-link":
      return t("resetInvalidBody");
    case "password-mismatch":
      return t("errorPasswordMismatch");
    default:
      return t("errorInvalid");
  }
}

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("account");
  const [result, formAction, isPending] = useActionState(resetPassword, undefined);

  if (result?.done) {
    return <p className="text-sm text-ink">{t("resetDone")}</p>;
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t("newPassword")}</Label>
        <Input id="password" name="password" type="password" minLength={8} required autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">{t("confirm")}</Label>
        <Input id="confirm" name="confirm" type="password" minLength={8} required />
      </div>
      {errorText(t, result) ? <p className="text-sm text-danger">{errorText(t, result)}</p> : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? t("saving") : t("resetSubmit")}
      </Button>
    </form>
  );
}
