import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { sessionUser } from "@/lib/authz";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { getCompanyProfile, getBankAccounts, getShippingRates } from "@/lib/queries/settings";
import { getUserNames } from "@/lib/queries/users";
import { latestPerDestination, type Destination } from "@/lib/landed-cost";
import { ShippingRatesManager } from "@/components/settings/shipping-rates-manager";
import { ExchangeRateManager } from "@/components/settings/exchange-rate-manager";
import { CompanyProfileForm } from "@/components/settings/company-profile-form";
import { CompanyLogoCard } from "@/components/settings/company-logo-card";
import { BankAccountsManager } from "@/components/settings/bank-accounts-manager";

export default async function SettingsPage() {
  const user = await sessionUser();
  if (user?.role !== "admin") {
    redirect({ href: "/catalog", locale: await getLocale() });
  }

  const t = await getTranslations("settings");
  const companyT = await getTranslations("company");

  const [rates, profile, banks, shipping, userNames] = await Promise.all([
    db
      .select()
      .from(exchangeRates)
      .where(eq(exchangeRates.companyId, user!.companyId))
      .orderBy(asc(exchangeRates.currencyCode)),
    getCompanyProfile(user!.companyId),
    getBankAccounts(user!.companyId),
    getShippingRates(user!.companyId),
    getUserNames(user!.companyId),
  ]);
  const latestShipping = [...latestPerDestination(shipping).values()].map((r) => r.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-6">
      <section>
        <h1 className="mb-6 text-[23px] font-extrabold tracking-tight text-ink">
          {companyT("title")}
        </h1>
        <div className="flex flex-col gap-4">
          <CompanyLogoCard logoPath={profile.logoPath} />
          <CompanyProfileForm profile={profile} currencies={rates.map((r) => r.currencyCode)} />
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

      <section>
        <h2 className="mb-6 text-[23px] font-extrabold tracking-tight text-ink">
          {t("shippingRates")}
        </h2>
        <ShippingRatesManager
          rows={shipping.map((r) => ({
            id: r.id,
            destination: r.destination as Destination,
            basis: r.basis,
            amount: r.amount,
            currency: r.currency,
            usableCbm: r.usableCbm,
            note: r.note,
            effectiveFrom: r.effectiveFrom,
            createdAt: r.createdAt,
            createdByName: r.createdBy ? (userNames.get(r.createdBy) ?? null) : null,
          }))}
          latestIds={latestShipping}
          currencies={rates.map((r) => r.currencyCode)}
        />
      </section>


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
