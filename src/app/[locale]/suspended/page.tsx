import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { sessionUser, companyStatus } from "@/lib/authz";
import { signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

/**
 * The frozen screen. A suspended company keeps its logins and exactly one
 * capability: taking its own data with it — the export promise is what
 * keeps a suspension a pause rather than a hostage situation. Sits on
 * sessionUser directly, like /pending and the export route itself.
 */
export default async function SuspendedPage() {
  const user = await sessionUser();
  if (!user) redirect("/login");
  const status = await companyStatus(user.companyId);
  if (status !== "suspended") redirect("/catalog");

  const t = await getTranslations("accountStatus");
  const settingsT = await getTranslations("settings");
  const locale = await getLocale();
  const boundSignOut = signOutAction.bind(null, locale);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-[23px] font-extrabold tracking-tight text-ink">{t("suspendedTitle")}</h1>
      <p className="mt-3 text-sm leading-relaxed text-sub">{t("suspendedBody")}</p>
      {/* The export runs admin-only server-side; showing the button to a
          collaborator would only hand them a 403. */}
      {user.role === "admin" ? (
        <div className="mt-8">
          <Button asChild variant="outline" size="sm">
            <a href="/api/export/backup" download>
              {settingsT("dataExportButton")}
            </a>
          </Button>
        </div>
      ) : null}
      <form action={boundSignOut} className="mt-4">
        <Button type="submit" variant="ghost" size="sm">
          {t("signOut")}
        </Button>
      </form>
    </div>
  );
}
