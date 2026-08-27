import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { sessionUser } from "@/lib/authz";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { getCompanyProfile, getBankAccounts } from "@/lib/queries/settings";
import { ExchangeRateManager } from "@/components/settings/exchange-rate-manager";
import { CompanyProfileForm } from "@/components/settings/company-profile-form";
import { CompanyLogoCard } from "@/components/settings/company-logo-card";
import { BankAccountsManager } from "@/components/settings/bank-accounts-manager";
import { ReferralCard } from "@/components/settings/referral-card";
import { isSaas } from "@/lib/deploy";
import { ensureReferralCode, referralCount } from "@/lib/referrals";

export default async function SettingsPage() {
  const user = await sessionUser();
  if (user?.role !== "admin") {
    redirect({ href: "/catalog", locale: await getLocale() });
  }

  const t = await getTranslations("settings");
  const companyT = await getTranslations("company");

  // The referral loop only exists where signup does. The code is minted the
  // first time an admin opens this page — nothing to configure.
  const referral = isSaas()
    ? {
        code: await ensureReferralCode(user!.companyId),
        joined: await referralCount(user!.companyId),
      }
    : null;

  const [rates, profile, banks] = await Promise.all([
    db
      .select()
      .from(exchangeRates)
      .where(eq(exchangeRates.companyId, user!.companyId))
      .orderBy(asc(exchangeRates.currencyCode)),
    getCompanyProfile(user!.companyId),
    getBankAccounts(user!.companyId),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-6">
      <section>
        <h1 className="mb-6 text-[23px] font-extrabold tracking-tight text-ink">
          {companyT("title")}
        </h1>
        <div className="flex flex-col gap-4">
          <CompanyLogoCard logoPath={profile.logoPath} />
          <CompanyProfileForm profile={profile} />
        </div>
      </section>

      <section>
        <h2 className="mb-6 text-[23px] font-extrabold tracking-tight text-ink">
          {companyT("banksTitle")}
        </h2>
        <BankAccountsManager accounts={banks} />
      </section>

      <section>
        <h2 className="mb-6 text-[23px] font-extrabold tracking-tight text-ink">
          {t("exchangeRates")}
        </h2>
        <ExchangeRateManager rates={rates} />
      </section>

      {referral ? (
        <section>
          <h2 className="mb-6 text-[23px] font-extrabold tracking-tight text-ink">
            {companyT("referralTitle")}
          </h2>
          <ReferralCard code={referral.code} joined={referral.joined} />
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-[23px] font-extrabold tracking-tight text-ink">
          {t("dataExport")}
        </h2>
        <p className="mb-4 text-sm text-sub">{t("dataExportHelp")}</p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a
            file download from a route handler, not a page navigation */}
        <a
          href="/api/export/backup"
          className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2"
          data-testid="backup-export"
        >
          {t("dataExportButton")}
        </a>
      </section>
    </div>
  );
}
