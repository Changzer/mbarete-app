import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { sessionUser, companyStatus } from "@/lib/authz";
import { signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

/**
 * The waiting room. A company that arrived through a referral link lands
 * here after signup and on every visit until the operator approves it from
 * the platform panel. Sits on sessionUser directly — requireUser would
 * bounce a pending company right back to this page.
 */
export default async function PendingPage() {
  const user = await sessionUser();
  if (!user) redirect("/login");
  const status = await companyStatus(user.companyId);
  if (status !== "pending") redirect("/catalog");

  const t = await getTranslations("accountStatus");
  const locale = await getLocale();
  const boundSignOut = signOutAction.bind(null, locale);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-[23px] font-extrabold tracking-tight text-ink">{t("pendingTitle")}</h1>
      <p className="mt-3 text-sm leading-relaxed text-sub">
        {t("pendingBody", { email: user.email })}
      </p>
      <form action={boundSignOut} className="mt-8">
        <Button type="submit" variant="outline" size="sm">
          {t("signOut")}
        </Button>
      </form>
    </div>
  );
}
