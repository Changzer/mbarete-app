import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { asc } from "drizzle-orm";
import { getCompanyProfile } from "@/lib/queries/settings";
import { ExchangeRateManager } from "@/components/settings/exchange-rate-manager";
import { CompanyProfileForm } from "@/components/settings/company-profile-form";

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const companyT = await getTranslations("company");

  const [rates, profile] = await Promise.all([
    db.select().from(exchangeRates).orderBy(asc(exchangeRates.currencyCode)).all(),
    getCompanyProfile(),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-6">
      <section>
        <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {companyT("title")}
        </h1>
        <CompanyProfileForm profile={profile} />
      </section>

      <section>
        <h2 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {t("exchangeRates")}
        </h2>
        <ExchangeRateManager rates={rates} />
      </section>
    </div>
  );
}
