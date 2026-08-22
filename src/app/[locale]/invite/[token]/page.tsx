import { getTranslations } from "next-intl/server";
import { lookupInvite } from "@/lib/actions/invites";
import { InviteAcceptForm } from "@/components/invite-accept-form";
import { Brand } from "@/components/brand";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("invite");
  const invite = await lookupInvite(token);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface-2 px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-64 bg-gradient-to-b from-brand-600/10 to-transparent"
      />
      <Brand size="hero" />
      <Card className="w-full max-w-sm border-t-4 border-t-brand-600">
        {invite.ok ? (
          <>
            <CardHeader>
              <CardTitle className="text-xl">{t("title")}</CardTitle>
              <CardDescription>
                {t("subtitle", { company: invite.companyName })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InviteAcceptForm token={token} />
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="text-xl">{t("invalidTitle")}</CardTitle>
              <CardDescription>{t("invalidBody")}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-center text-sm text-sub">
                <Link href="/login" className="font-medium text-brand-600 hover:underline">
                  {t("goToLogin")}
                </Link>
              </p>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
