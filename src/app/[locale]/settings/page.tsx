import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { asc } from "drizzle-orm";
import { getCompanyProfile, getBankAccounts } from "@/lib/queries/settings";
import { ExchangeRateManager } from "@/components/settings/exchange-rate-manager";
import { CompanyProfileForm } from "@/components/settings/company-profile-form";
import { BankAccountsManager } from "@/components/settings/bank-accounts-manager";

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const companyT = await getTranslations("company");

  const [rates, profile, banks] = await Promise.all([
    db.select().from(exchangeRates).orderBy(asc(exchangeRates.currencyCode)).all(),
    getCompanyProfile(),
    getBankAccounts(),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-6">
      <section>
        <h1 className="mb-6 text-2xl font-semibold text-ink">
          {companyT("title")}
        </h1>
        <CompanyProfileForm profile={profile} />
      </section>

      <section>
        <h2 className="mb-6 text-2xl font-semibold text-ink">
          {companyT("banksTitle")}
        </h2>
        <BankAccountsManager accounts={banks} />
      </section>

      <section>
        <h2 className="mb-6 text-2xl font-semibold text-ink">
          {t("exchangeRates")}
        </h2>
        <ExchangeRateManager rates={rates} />
      </section>
    </div>
  );
}
