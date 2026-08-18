import { getTranslations } from "next-intl/server";
import type { OrderFinance } from "@/lib/calculations";

/**
 * The money position of one order: quoted against received on the client
 * side, cost against paid on the supplier side, expenses, and the two nets.
 * Server-rendered — it re-computes on every payment or expense change via
 * revalidatePath, so it can never show a stale figure next to fresh rows.
 */
export async function OrderResult({ fin, quote }: { fin: OrderFinance; quote: string }) {
  const t = await getTranslations("finance");
  const orderT = await getTranslations("orders");
  const money = (n: number) => `${n.toFixed(2)} ${quote}`;

  const label = "text-neutral-500 dark:text-neutral-400";
  const value = "text-neutral-900 dark:text-neutral-100";
  const warn = "font-medium text-amber-700 dark:text-amber-400";

  return (
    <div
      className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      data-testid="section-net"
    >
      <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {t("netTitle")}
      </h2>

      {fin.missingRates.length > 0 ? (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {orderT("missingRate", { codes: fin.missingRates.join(", ") })}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <div className="flex justify-between">
            <span className={label}>{t("expectedRevenue")}</span>
            <span className={value}>{money(fin.received + fin.clientOutstanding)}</span>
          </div>
          <div className="flex justify-between">
            <span className={label}>{t("received")}</span>
            <span className={value} data-testid="fin-received">{money(fin.received)}</span>
          </div>
          <div className="flex justify-between">
            <span className={label}>{t("clientOutstanding")}</span>
            <span
              className={fin.clientOutstanding > 0.005 ? warn : value}
              data-testid="fin-client-outstanding"
            >
              {money(fin.clientOutstanding)}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex justify-between">
            <span className={label}>{t("expectedCost")}</span>
            <span className={value}>{money(fin.paidOut + fin.supplierOutstanding)}</span>
          </div>
          <div className="flex justify-between">
            <span className={label}>{t("paidOut")}</span>
            <span className={value} data-testid="fin-paid-out">{money(fin.paidOut)}</span>
          </div>
          <div className="flex justify-between">
            <span className={label}>{t("supplierOutstanding")}</span>
            <span
              className={fin.supplierOutstanding > 0.005 ? warn : value}
              data-testid="fin-supplier-outstanding"
            >
              {money(fin.supplierOutstanding)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1 border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
        <div className="flex justify-between">
          <span className={label}>{t("expensesTotal")}</span>
          <span className={value} data-testid="fin-expenses">{money(fin.expensesTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className={label}>{t("netActual")}</span>
          <span
            className={`font-semibold ${fin.netActual < 0 ? "text-red-600 dark:text-red-400" : value}`}
            data-testid="fin-net-actual"
          >
            {money(fin.netActual)}
          </span>
        </div>
        <div className="flex justify-between text-base">
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {t("netExpected")}
          </span>
          <span className="font-bold text-neutral-900 dark:text-neutral-100" data-testid="fin-net-expected">
            {money(fin.netExpected)}
            {fin.marginPct !== null ? (
              <span className="ml-2 text-sm font-normal text-neutral-500 dark:text-neutral-400">
                ({fin.marginPct.toFixed(1)}%)
              </span>
            ) : null}
          </span>
        </div>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("netHelp")}</p>
      </div>
    </div>
  );
}
