import { getTranslations } from "next-intl/server";
import { verifyEmailToken } from "@/lib/actions/account";
import { Brand } from "@/components/brand";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("account");
  const ok = await verifyEmailToken(token);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface-2 px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-64 bg-gradient-to-b from-brand-600/10 to-transparent"
      />
      <Brand size="hero" />
      <Card className="w-full max-w-sm border-t-4 border-t-brand-600">
        <CardHeader>
          <CardTitle className="text-xl">
            {ok ? t("verifyDoneTitle") : t("verifyInvalidTitle")}
          </CardTitle>
          <CardDescription>{ok ? t("verifyDoneBody") : t("verifyInvalidBody")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-center text-sm text-sub">
            <Link href="/catalog" className="font-medium text-brand-600 hover:underline">
              {t("continueToApp")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
