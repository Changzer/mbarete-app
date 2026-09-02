import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { OrderFinanceView } from "@/lib/calculations";

/**
 * The money position of one order, each side in the currency it is settled
 * in: quoted against received on the client side (in the quote currency),
 * cost against paid on the supplier side (in the supplier's currency).
 * Those are facts — the numbers on the invoices and the transfers — and
 * never convert. Only the bottom block, which subtracts one side from the
 * other, has to land in one currency, and that is the reader's pick: the
 * links switch it through the query string, so the choice is a URL, not
 * state. Server-rendered — it re-computes on every payment or expense
 * change via revalidatePath, so it can never show a stale figure next to
 * fresh rows.
 */
export async function OrderResult({
  fin,
  orderId,
  currencies,
}: {
  fin: OrderFinanceView;
  orderId: number;
  currencies: string[];
}) {
  const t = await getTranslations("finance");
  const orderT = await getTranslations("orders");
  const money = (n: number, currency: string) => `${n.toFixed(2)} ${currency}`;

  const label = "text-sub";
  const value = "text-ink";
  const warn = "font-medium text-warn";
  const sideHead = "mb-1 flex items-baseline justify-between text-xs font-semibold";

  const { client, supplier, result } = fin;
  // The result currency is always offered, even when the rate table has
  // moved on since the order was saved — the link that opened this page
  // must render as active.
  const choices = [...new Set([...currencies, result.currency])].sort();

  return (
    <div
      className="mt-4 rounded-lg border border-line bg-surface p-4"
      data-testid="section-net"
    >
      <h2 className="mb-3 text-sm font-semibold text-ink">
        {t("netTitle")}
      </h2>

      {fin.missingRates.length > 0 ? (
        <p className="mb-3 rounded-md border bg-warn-soft px-2 py-1.5 text-xs text-warn">
          {orderT("missingRate", { codes: fin.missingRates.join(", ") })}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1" data-testid="fin-client-side">
          <div className={sideHead}>
            <span className="text-ink">{t("clientSide")}</span>
            <span className="tabular-nums text-sub" data-testid="fin-client-currency">
              {client.currency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className={label}>{t("expectedRevenue")}</span>
            <span className={value}>{money(client.expected, client.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className={label}>{t("received")}</span>
            <span className={value} data-testid="fin-received">
              {money(client.received, client.currency)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className={label}>{t("clientOutstanding")}</span>
            <span
              className={client.outstanding > 0.005 ? warn : value}
              data-testid="fin-client-outstanding"
            >
              {money(client.outstanding, client.currency)}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1" data-testid="fin-supplier-side">
          <div className={sideHead}>
            <span className="text-ink">{t("supplierSide")}</span>
            <span className="tabular-nums text-sub" data-testid="fin-supplier-currency">
              {supplier.currency}
            </span>
          </div>
          <div className="flex justify-between">
            <span className={label}>{t("expectedCost")}</span>
            <span className={value}>{money(supplier.expected, supplier.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className={label}>{t("paidOut")}</span>
            <span className={value} data-testid="fin-paid-out">
              {money(supplier.paid, supplier.currency)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className={label}>{t("supplierOutstanding")}</span>
            <span
              className={supplier.outstanding > 0.005 ? warn : value}
              data-testid="fin-supplier-outstanding"
            >
              {money(supplier.outstanding, supplier.currency)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1 border-t border-line pt-3 text-sm">
        <div
          className="mb-1 flex flex-wrap items-center justify-between gap-2"
          data-testid="result-currency-picker"
        >
          <span className="text-xs font-semibold text-ink">{t("resultIn")}</span>
          <div className="flex items-center gap-1 text-xs">
            {choices.map((code) => (
              <Link
                key={code}
                href={`/orders/${orderId}?result=${code}`}
                scroll={false}
                aria-current={code === result.currency ? "true" : undefined}
                className={`rounded-md px-2 py-1 tabular-nums ${
                  code === result.currency
                    ? "bg-action font-semibold text-white"
                    : "text-sub hover:bg-surface-2"
                }`}
              >
                {code}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex justify-between">
          <span className={label}>{t("expensesTotal")}</span>
          <span className={value} data-testid="fin-expenses">
            {money(result.expensesTotal, result.currency)}
          </span>
        </div>
        {Math.abs(result.fxGainLoss) > 0.005 ? (
          <div className="flex justify-between">
            <span className={label}>{t("fxGainLoss")}</span>
            <span
              className={result.fxGainLoss < 0 ? "text-danger" : "text-ok"}
              data-testid="fin-fx"
            >
              {result.fxGainLoss > 0 ? "+" : ""}
              {money(result.fxGainLoss, result.currency)}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between">
          <span className={label}>{t("netActual")}</span>
          <span
            className={`font-semibold ${result.netActual < 0 ? "text-danger" : value}`}
            data-testid="fin-net-actual"
          >
            {money(result.netActual, result.currency)}
          </span>
        </div>
        <div className="flex justify-between text-base">
          <span className="font-medium text-ink">{t("netExpected")}</span>
          <span className="font-bold text-ink" data-testid="fin-net-expected">
            {money(result.netExpected, result.currency)}
            {result.marginPct !== null ? (
              <span className="ml-2 text-sm font-normal text-sub">
                ({result.marginPct.toFixed(1)}%)
              </span>
            ) : null}
          </span>
        </div>
        <p className="mt-1 text-xs text-sub">{t("resultHelp")}</p>
        <p className="text-xs text-sub">{t("netHelp")}</p>
      </div>
    </div>
  );
}
