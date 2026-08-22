import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { SignupForm } from "@/components/signup-form";
import { Brand } from "@/components/brand";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { isSaas } from "@/lib/deploy";

export default async function SignupPage() {
  // Public signup exists only on a SaaS deployment. A self-hosted install has
  // its one company already, so send anyone here straight to the login door.
  if (!isSaas()) {
    redirect({ href: "/login", locale: await getLocale() });
  }

  const t = await getTranslations("signup");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface-2 px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-64 bg-gradient-to-b from-brand-600/10 to-transparent"
      />
      <Brand size="hero" />
      <Card className="w-full max-w-sm border-t-4 border-t-brand-600">
        <CardHeader>
          <CardTitle className="text-xl">{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SignupForm />
          <p className="text-center text-sm text-sub">
            {t("haveAccount")}{" "}
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              {t("signIn")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
