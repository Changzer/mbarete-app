import { getTranslations } from "next-intl/server";
import { lookupResetToken } from "@/lib/actions/account";
import { ResetForm } from "@/components/reset-form";
import { Brand } from "@/components/brand";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("account");
  const valid = await lookupResetToken(token);

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
            {valid ? t("resetTitle") : t("resetInvalidTitle")}
          </CardTitle>
          <CardDescription>
            {valid ? t("resetSubtitle") : t("resetInvalidBody")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {valid ? <ResetForm token={token} /> : null}
          <p className="text-center text-sm text-sub">
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              {t("backToLogin")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
