import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/login-form";
import { Brand } from "@/components/brand";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { isSaas } from "@/lib/deploy";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("login");
  const { callbackUrl } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface-2 px-4">
      {/* A soft brand glow behind the card, so the door feels like the logo. */}
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
          <LoginForm callbackUrl={callbackUrl ?? `/${locale}/catalog`} />
          {isSaas() ? (
            <p className="text-center text-sm text-sub">
              {t("noAccount")}{" "}
              <Link href="/signup" className="font-medium text-brand-600 hover:underline">
                {t("createCompany")}
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
