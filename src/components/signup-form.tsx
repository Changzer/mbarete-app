"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signUp, type SignupResult } from "@/lib/actions/signup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function useErrorText() {
  const t = useTranslations("signup");
  return (result: SignupResult | undefined) => {
    if (!result?.error) return null;
    switch (result.error) {
      case "bad-code":
        return t("errorBadCode");
      case "closed":
        return t("errorClosed");
      case "password-mismatch":
        return t("errorPasswordMismatch");
      case "email-taken":
        return t("errorEmailTaken");
      case "rate-limited":
        return t("errorRateLimited");
      default:
        return t("errorInvalid");
    }
  };
}

export function SignupForm({ referralCode }: { referralCode?: string }) {
  const t = useTranslations("signup");
  const [result, formAction, isPending] = useActionState(signUp, undefined);
  const message = useErrorText()(result);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="companyName">{t("companyName")}</Label>
        <Input id="companyName" name="companyName" required autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ownerName">{t("yourName")}</Label>
        <Input id="ownerName" name="ownerName" required />
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
      <div className="flex flex-col gap-1.5">
        {referralCode ? (
          <input type="hidden" name="ref" value={referralCode} />
        ) : (
          <>
            <Label htmlFor="code">{t("code")}</Label>
            <Input id="code" name="code" required />
            <p className="text-xs text-sub">{t("codeHelp")}</p>
          </>
        )}
      </div>
      {message ? <p className="text-sm text-danger">{message}</p> : null}
      <Button type="submit" disabled={isPending} className="mt-2">
        {isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
