"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { authenticate } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations("login");
  const [errorMessage, formAction, isPending] = useActionState(
    authenticate,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" required autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t("password")}</Label>
        <Input id="password" name="password" type="password" required />
      </div>
      {errorMessage ? (
        <p className="text-sm text-danger">{t("error")}</p>
      ) : null}
      <Button type="submit" disabled={isPending} className="mt-2">
        {t("submit")}
      </Button>
    </form>
  );
}
