"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { acceptInvite, type AcceptInviteResult } from "@/lib/actions/invites";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function useErrorText() {
  const t = useTranslations("invite");
  return (result: AcceptInviteResult | undefined) => {
    if (!result?.error) return null;
    switch (result.error) {
      case "invalid-link":
        return t("errorInvalidLink");
      case "password-mismatch":
        return t("errorPasswordMismatch");
      case "email-taken":
        return t("errorEmailTaken");
      case "rate-limited":
        return t("errorRateLimited");
      case "limit":
        return t("errorSeatLimit");
      default:
        return t("errorInvalid");
    }
  };
}

export function InviteAcceptForm({ token }: { token: string }) {
  const t = useTranslations("invite");
  const [result, formAction, isPending] = useActionState(acceptInvite, undefined);
  const message = useErrorText()(result);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{t("yourName")}</Label>
        <Input id="name" name="name" required autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t("password")}</Label>
          <Input id="password" name="password" type="password" minLength={8} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm">{t("confirm")}</Label>
          <Input id="confirm" name="confirm" type="password" minLength={8} required />
        </div>
      </div>
      {message ? <p className="text-sm text-danger">{message}</p> : null}
      <Button type="submit" disabled={isPending} className="mt-2">
        {isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
