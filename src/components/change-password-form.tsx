"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { changePassword, type ChangePasswordResult } from "@/lib/actions/account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function errorText(
  t: ReturnType<typeof useTranslations<"account">>,
  result?: ChangePasswordResult,
) {
  if (!result?.error) return null;
  switch (result.error) {
    case "wrong-password":
      return t("errorWrongPassword");
    case "password-mismatch":
      return t("errorPasswordMismatch");
    default:
      return t("errorInvalid");
  }
}

export function ChangePasswordForm() {
  const t = useTranslations("account");
  const [result, formAction, isPending] = useActionState(changePassword, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current">{t("currentPassword")}</Label>
        <Input id="current" name="current" type="password" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password">{t("newPassword")}</Label>
          <Input id="new-password" name="password" type="password" minLength={8} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-confirm">{t("confirm")}</Label>
          <Input id="new-confirm" name="confirm" type="password" minLength={8} required />
        </div>
      </div>
      {result?.done ? <p className="text-sm text-ink">{t("passwordChanged")}</p> : null}
      {errorText(t, result) ? <p className="text-sm text-danger">{errorText(t, result)}</p> : null}
      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? t("saving") : t("changePasswordSubmit")}
        </Button>
      </div>
    </form>
  );
}
