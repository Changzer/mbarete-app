import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getFinanceData } from "@/lib/queries/finance";
import { computeFinanceReport } from "@/lib/finance-report";

/**
 * The whole business on one page: expected results, open balances in both
 * directions, cash flow by month, expenses by category, and clients ranked
 * by what they bring in. Server-rendered from the orders' own records — the
 * report can never disagree with the order pages it is built from.
 */
export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string }>;
}) {
  const { currency } = await searchParams;
  const t = await getTranslations("financeReport");
  const financeT = await getTranslations("finance");

  const { orders, rates } = await getFinanceData();
  const codes = Object.keys(rates).sort();
  // RMB is the functional currency: costs are RMB, so profit is real in RMB.
  const fallback = rates["RMB"] !== undefined ? "RMB" : "USD";
  const reportCurrency =
    currency && rates[currency.toUpperCase()] !== undefined
      ? currency.toUpperCase()
      : fallback;
  const report = computeFinanceReport(orders, reportCurrency, rates);

  const money = (n: number) =>
    `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${reportCurrency}`;

  const box =
    "rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";
  const heading = "mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100";
  const th = "px-3 py-2 font-medium";
  const td = "px-3 py-2";
  const tdNum = "px-3 py-2 text-right tabular-nums";

  const tiles: { label: string; value: string; tone?: "good" | "bad" | "warn" }[] = [
    { label: t("tileExpectedNet"), value: money(report.totals.expectedNet), tone: report.totals.expectedNet >= 0 ? "good" : "bad" },
    {
      label: t("tileMargin"),
      value: report.totals.marginPct !== null ? `${report.totals.marginPct.toFixed(1)}%` : "—",
    },
    { label: t("tileReceivables"), value: money(report.totals.receivables), tone: report.totals.receivables > 0.005 ? "warn" : undefined },
    { label: t("tilePayables"), value: money(report.totals.payables), tone: report.totals.payables > 0.005 ? "warn" : undefined },
    { label: t("tileNetCash"), value: money(report.totals.netCash), tone: report.totals.netCash >= 0 ? "good" : "bad" },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {t("title")}
        </h1>
        <div className="flex items-center gap-1 text-sm" data-testid="currency-picker">
          <span className="mr-1 text-neutral-500 dark:text-neutral-400">{t("reportCurrency")}</span>
          {codes.map((code) => (
            <Link
              key={code}
              href={`/finance?currency=${code}`}
              className={`rounded-md px-2 py-1 ${
                code === reportCurrency
                  ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {code}
            </Link>
          ))}
        </div>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("help")}</p>

      {report.missingRates.length > 0 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t("missingRates", { codes: report.missingRates.join(", ") })}
        </p>
      ) : null}

      {/* --- headline tiles --- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className={box}>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{tile.label}</div>
            <div
              className={`mt-1 text-lg font-bold tabular-nums ${
                tile.tone === "bad"
                  ? "text-red-600 dark:text-red-400"
                  : tile.tone === "warn"
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-neutral-900 dark:text-neutral-100"
              }`}
            >
              {tile.value}
            </div>
          </div>
        ))}
      </div>

      {/* --- open balances, the actionable part --- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={box} data-testid="receivables">
          <h2 className={heading}>{t("receivables")}</h2>
          {report.receivablesList.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("allSettled")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
              {report.receivablesList.map((r) => (
                <li key={r.orderId} className="flex items-center justify-between gap-3 py-1.5">
                  <Link
                    href={`/orders/${r.orderId}`}
                    className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                  >
                    {r.orderNumber}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-neutral-500 dark:text-neutral-400">
                    {r.clientName}
                  </span>
                  <span className="font-medium tabular-nums text-amber-700 dark:text-amber-400">
                    {money(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={box} data-testid="payables">
          <h2 className={heading}>{t("payables")}</h2>
          {report.payablesList.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("allSettled")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
              {report.payablesList.map((r) => (
                <li key={r.orderId} className="flex items-center justify-between gap-3 py-1.5">
                  <Link
                    href={`/orders/${r.orderId}`}
                    className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                  >
                    {r.orderNumber}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-neutral-500 dark:text-neutral-400">
                    {r.clientName}
                  </span>
                  <span className="font-medium tabular-nums text-amber-700 dark:text-amber-400">
                    {money(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* --- month by month --- */}
      <div className={box} data-testid="monthly">
        <h2 className={heading}>{t("byMonth")}</h2>
        {report.months.length === 0 ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("noData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                <tr>
                  <th className={th}>{t("month")}</th>
                  <th className={`${th} text-right`}>{t("ordersCount")}</th>
                  <th className={`${th} text-right`}>{t("expectedRevenue")}</th>
                  <th className={`${th} text-right`}>{t("expectedNet")}</th>
                  <th className={`${th} text-right`}>{t("cashIn")}</th>
                  <th className={`${th} text-right`}>{t("cashOut")}</th>
                  <th className={`${th} text-right`}>{t("netCash")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {report.months.map((m) => (
                  <tr key={m.month}>
                    <td className={`${td} font-medium text-neutral-900 dark:text-neutral-100`}>{m.month}</td>
                    <td className={`${tdNum} text-neutral-700 dark:text-neutral-300`}>{m.orders}</td>
                    <td className={`${tdNum} text-neutral-700 dark:text-neutral-300`}>{money(m.expectedRevenue)}</td>
                    <td className={`${tdNum} text-neutral-700 dark:text-neutral-300`}>{money(m.expectedNet)}</td>
                    <td className={`${tdNum} text-neutral-700 dark:text-neutral-300`}>{money(m.cashIn)}</td>
                    <td className={`${tdNum} text-neutral-700 dark:text-neutral-300`}>{money(m.cashOut)}</td>
                    <td
                      className={`${tdNum} font-medium ${
                        m.netCash < 0 ? "text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-neutral-100"
                      }`}
                    >
                      {money(m.netCash)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --- expenses and clients --- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={box} data-testid="expense-breakdown">
          <h2 className={heading}>{t("expensesByCategory")}</h2>
          {report.expensesByCategory.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("noData")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {report.expensesByCategory.map((e) => (
                <li key={e.category} className="flex flex-col gap-1">
                  <div className="flex justify-between">
                    <span className="text-neutral-700 dark:text-neutral-300">
                      {financeT(`category_${e.category}` as "category_other")}
                    </span>
                    <span className="tabular-nums text-neutral-900 dark:text-neutral-100">
                      {money(e.amount)}
                      <span className="ml-1 text-xs text-neutral-500 dark:text-neutral-400">
                        {e.pct.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  {/* proportion bar, no library needed */}
                  <div className="h-1.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-1.5 rounded-full bg-neutral-500 dark:bg-neutral-400"
                      style={{ width: `${Math.max(2, e.pct)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={box} data-testid="clients">
          <h2 className={heading}>{t("byClient")}</h2>
          {report.clients.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("noData")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  <tr>
                    <th className={th}>{t("client")}</th>
                    <th className={`${th} text-right`}>{t("ordersCount")}</th>
                    <th className={`${th} text-right`}>{t("expectedRevenue")}</th>
                    <th className={`${th} text-right`}>{t("expectedNet")}</th>
                    <th className={`${th} text-right`}>{t("margin")}</th>
                    <th className={`${th} text-right`}>{t("outstanding")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {report.clients.map((c) => (
                    <tr key={c.clientName}>
                      <td className={`${td} font-medium text-neutral-900 dark:text-neutral-100`}>{c.clientName}</td>
                      <td className={`${tdNum} text-neutral-700 dark:text-neutral-300`}>{c.orders}</td>
                      <td className={`${tdNum} text-neutral-700 dark:text-neutral-300`}>{money(c.expectedRevenue)}</td>
                      <td className={`${tdNum} text-neutral-700 dark:text-neutral-300`}>{money(c.expectedNet)}</td>
                      <td className={`${tdNum} text-neutral-700 dark:text-neutral-300`}>
                        {c.marginPct !== null ? `${c.marginPct.toFixed(1)}%` : "—"}
                      </td>
                      <td
                        className={`${tdNum} ${
                          c.outstanding > 0.005
                            ? "font-medium text-amber-700 dark:text-amber-400"
                            : "text-neutral-700 dark:text-neutral-300"
                        }`}
                      >
                        {money(c.outstanding)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
