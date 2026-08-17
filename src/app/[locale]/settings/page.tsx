import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { asc } from "drizzle-orm";
import { ExchangeRateManager } from "@/components/settings/exchange-rate-manager";

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const rates = await db
    .select()
    .from(exchangeRates)
    .orderBy(asc(exchangeRates.currencyCode))
    .all();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t("exchangeRates")}
      </h1>
      <ExchangeRateManager rates={rates} />
    </div>
  );
}
