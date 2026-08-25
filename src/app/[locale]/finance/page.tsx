import { getTranslations, getLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { sessionUser, requireModulePage } from "@/lib/authz";
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
  // The finance report is the business's bottom line — admin eyes only.
  const user = await sessionUser();
  if (user?.role !== "admin") {
    redirect({ href: "/catalog", locale: await getLocale() });
  }
  await requireModulePage(user!, "finance");

  const { currency } = await searchParams;
  const t = await getTranslations("financeReport");
  const financeT = await getTranslations("finance");

  const { orders, rates } = await getFinanceData(user!.companyId);
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
    "rounded-lg border border-line bg-surface p-4";
  const heading = "mb-3 text-sm font-semibold text-ink";
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
    {
      label: t("tileQuoted", { count: report.totals.quotedOrders }),
      value: money(report.totals.quotedRevenue),
    },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[23px] font-extrabold tracking-tight text-ink">
          {t("title")}
        </h1>
        <div className="flex items-center gap-1 text-sm" data-testid="currency-picker">
          <span className="mr-1 text-sub">{t("reportCurrency")}</span>
          {codes.map((code) => (
            <Link
              key={code}
              href={`/finance?currency=${code}`}
              className={`rounded-md px-2 py-1 ${
                code === reportCurrency
                  ? "bg-action font-semibold text-white"
                  : "text-sub hover:bg-surface-2"
              }`}
            >
              {code}
            </Link>
          ))}
        </div>
      </div>

      <p className="text-xs text-sub">{t("help")}</p>

      {report.missingRates.length > 0 ? (
        <p className="rounded-md border bg-warn-soft px-3 py-2 text-sm text-warn">
          {t("missingRates", { codes: report.missingRates.join(", ") })}
        </p>
      ) : null}

      {/* --- headline tiles --- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6" data-testid="tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className={box}>
            <div className="text-xs text-sub">{tile.label}</div>
            <div
              className={`mt-1 font-mono text-[20px] font-semibold tabular-nums ${
                tile.tone === "bad"
                  ? "text-danger"
                  : tile.tone === "warn"
                    ? "text-warn"
                    : "text-ink"
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
            <p className="text-xs text-sub">{t("allSettled")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-sm">
              {report.receivablesList.map((r) => (
                <li key={r.orderId} className="flex items-center justify-between gap-3 py-1.5">
                  <Link
                    href={`/orders/${r.orderId}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {r.orderNumber}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-sub">
                    {r.clientName}
                  </span>
                  <span className="font-medium tabular-nums text-warn">
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
            <p className="text-xs text-sub">{t("allSettled")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-sm">
              {report.payablesList.map((r) => (
                <li key={r.orderId} className="flex items-center justify-between gap-3 py-1.5">
                  <Link
                    href={`/orders/${r.orderId}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {r.orderNumber}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-sub">
                    {r.clientName}
                  </span>
                  <span className="font-medium tabular-nums text-warn">
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
          <p className="text-xs text-sub">{t("noData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-sub">
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
              <tbody className="divide-y divide-line">
                {report.months.map((m) => (
                  <tr key={m.month}>
                    <td className={`${td} font-medium text-ink`}>{m.month}</td>
                    <td className={`${tdNum} text-ink`}>{m.orders}</td>
                    <td className={`${tdNum} text-ink`}>{money(m.expectedRevenue)}</td>
                    <td className={`${tdNum} text-ink`}>{money(m.expectedNet)}</td>
                    <td className={`${tdNum} text-ink`}>{money(m.cashIn)}</td>
                    <td className={`${tdNum} text-ink`}>{money(m.cashOut)}</td>
                    <td
                      className={`${tdNum} font-medium ${
                        m.netCash < 0 ? "text-danger" : "text-ink"
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

      {/* --- where client money landed: XTransfer converts some on arrival --- */}
      <div className={box} data-testid="landing-breakdown">
        <h2 className={heading}>{t("byAccount")}</h2>
        {report.receivedByAccount.length === 0 ? (
          <p className="text-xs text-sub">{t("noData")}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {report.receivedByAccount.map((row) => (
              <li key={row.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-ink">
                    {row.key === "RMB"
                      ? financeT("accountRmb")
                      : row.key === "USD"
                        ? financeT("accountUsd")
                        : row.key}
                  </span>
                  <span className="tabular-nums text-ink">
                    {Object.entries(row.native)
                      .map(([code, amount]) =>
                        `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`)
                      .join(" + ")}
                    <span className="ml-2 text-xs text-sub">
                      ≈ {money(row.value)} · {row.pct.toFixed(0)}%
                    </span>
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-surface-2">
                  <div
                    className="h-1.5 rounded-full bg-action"
                    style={{ width: `${Math.max(2, row.pct)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-sub">{t("byAccountHelp")}</p>
      </div>

      {/* --- expenses and clients --- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={box} data-testid="expense-breakdown">
          <h2 className={heading}>{t("expensesByCategory")}</h2>
          {report.expensesByCategory.length === 0 ? (
            <p className="text-xs text-sub">{t("noData")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {report.expensesByCategory.map((e) => (
                <li key={e.category} className="flex flex-col gap-1">
                  <div className="flex justify-between">
                    <span className="text-ink">
                      {financeT(`category_${e.category}` as "category_other")}
                    </span>
                    <span className="tabular-nums text-ink">
                      {money(e.amount)}
                      <span className="ml-1 text-xs text-sub">
                        {e.pct.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  {/* proportion bar, no library needed */}
                  <div className="h-1.5 w-full rounded-full bg-surface-2">
                    <div
                      className="h-1.5 rounded-full bg-sub"
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
            <p className="text-xs text-sub">{t("noData")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-sub">
                  <tr>
                    <th className={th}>{t("client")}</th>
                    <th className={`${th} text-right`}>{t("ordersCount")}</th>
                    <th className={`${th} text-right`}>{t("expectedRevenue")}</th>
                    <th className={`${th} text-right`}>{t("expectedNet")}</th>
                    <th className={`${th} text-right`}>{t("margin")}</th>
                    <th className={`${th} text-right`}>{t("outstanding")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.clients.map((c) => (
                    <tr key={c.clientName}>
                      <td className={`${td} font-medium text-ink`}>{c.clientName}</td>
                      <td className={`${tdNum} text-ink`}>{c.orders}</td>
                      <td className={`${tdNum} text-ink`}>{money(c.expectedRevenue)}</td>
                      <td className={`${tdNum} text-ink`}>{money(c.expectedNet)}</td>
                      <td className={`${tdNum} text-ink`}>
                        {c.marginPct !== null ? `${c.marginPct.toFixed(1)}%` : "—"}
                      </td>
                      <td
                        className={`${tdNum} ${
                          c.outstanding > 0.005
                            ? "font-medium text-warn"
                            : "text-ink"
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
