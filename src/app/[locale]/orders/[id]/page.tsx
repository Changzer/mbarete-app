import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOrderView } from "@/lib/queries/order-view";
import { getOrderFinanceRows, parseRatesSnapshot } from "@/lib/queries/orders";
import { getUserNames } from "@/lib/queries/users";
import { getBankAccounts } from "@/lib/queries/settings";
import type { Locale } from "@/i18n/routing";
import { computeOrderFinance, formatCbm } from "@/lib/calculations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { OrderStatusActions } from "@/components/orders/order-status-actions";
import { OrderFinance } from "@/components/orders/order-finance";
import { OrderResult } from "@/components/orders/order-result";
import { OrderChangelog } from "@/components/orders/order-changelog";
import { ProformaBankSelect } from "@/components/orders/proforma-bank-select";

const STATUS_VARIANT = {
  draft: "secondary",
  confirmed: "default",
  shipped: "success",
  cancelled: "destructive",
} as const;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const t = await getTranslations("orders");
  const catalogT = await getTranslations("catalog");
  const proformaT = await getTranslations("proforma");

  const [view, userNames, finance, bankAccounts] = await Promise.all([
    getOrderView(Number(id), locale as Locale),
    getUserNames(),
    getOrderFinanceRows(Number(id)),
    getBankAccounts(),
  ]);
  if (!view) notFound();
  const { order, client, rows, targets, totals, effectiveRates } = view;

  // The money position: what the client is billed against what the supplier
  // charges, then every recorded movement on top.
  const quote = order.displayCurrency;
  const fin = computeOrderFinance(
    {
      expectedRevenue: totals.grandTotal[quote] ?? 0,
      expectedCost: totals.cost[quote] ?? 0,
      paymentsIn: finance.payments
        .filter((p) => p.direction === "in")
        .map((p) => ({ ...p, rates: parseRatesSnapshot(p.ratesSnapshot) })),
      paymentsOut: finance.payments
        .filter((p) => p.direction === "out")
        .map((p) => ({ ...p, rates: parseRatesSnapshot(p.ratesSnapshot) })),
      expenses: finance.expenses.map((e) => ({
        ...e,
        rates: parseRatesSnapshot(e.ratesSnapshot),
      })),
    },
    quote,
    effectiveRates,
  );
  const supplierCurrency = rows[0]?.currencySnapshot ?? order.secondaryCurrency;

  // Lines whose product had no measurements when the order was saved.
  const hasUnmeasured = rows.some((r) => r.lineCbm <= 0 || r.lineWeightKg <= 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{order.orderNumber}</h1>
          <p className="text-sm text-sub">{client?.companyName}</p>
          <p
            className="mt-1 text-xs text-sub"
            data-testid="order-attribution"
          >
            {t("filedBy")}: {userNames.get(order.createdBy) ?? t("unknownUser")}
            {order.updatedBy && order.updatedBy !== order.createdBy
              ? ` · ${t("updatedBy")}: ${userNames.get(order.updatedBy) ?? t("unknownUser")}`
              : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant={STATUS_VARIANT[order.status]}>
            {t(`status${order.status.charAt(0).toUpperCase()}${order.status.slice(1)}` as "statusDraft")}
          </Badge>
          <OrderStatusActions orderId={order.id} status={order.status} />
          <ProformaBankSelect
            orderId={order.id}
            accounts={bankAccounts.map((a) => ({
              id: a.id,
              label: a.label,
              currency: a.currency,
              isDefault: a.isDefault,
            }))}
            selectedId={order.bankAccountId}
          />
          <Button asChild variant="outline" size="sm">
            <Link href={`/orders/${order.id}/proforma`}>{proformaT("open")}</Link>
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2 text-left text-sub">
            <tr>
              <th className="px-4 py-2 font-medium">{catalogT("title")}</th>
              <th className="px-4 py-2 font-medium">{t("quantity")}</th>
              <th className="px-4 py-2 font-medium">{t("totalCartons")}</th>
              <th className="px-4 py-2 font-medium">{t("unitCost")}</th>
              <th className="px-4 py-2 font-medium">{t("unitPrice")}</th>
              <th className="px-4 py-2 font-medium">{t("lineTotal")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 text-ink">{r.name}</td>
                <td className="px-4 py-2 text-ink">
                  {r.quantity}
                  {r.below ? (
                    <Badge variant="warning" className="ml-2">
                      {t("moqWarning", { moq: r.moqSnapshot })}
                    </Badge>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-ink">
                  {r.cartons !== null ? `${r.cartons} × ${r.perCarton}` : "—"}
                </td>
                <td className="px-4 py-2 text-sub">
                  {r.unitPriceSnapshot.toFixed(2)} {r.currencySnapshot}
                </td>
                <td className="px-4 py-2 text-ink">
                  {r.sellPrice.toFixed(2)} {r.currencySnapshot}
                </td>
                <td className="px-4 py-2 text-ink">
                  {r.sellTotal.toFixed(2)} {r.currencySnapshot}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 text-sm sm:w-80 sm:self-end">
        {totals.missingRates.length > 0 ? (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
            {t("missingRate", { codes: totals.missingRates.join(", ") })}
          </p>
        ) : null}

        <div className="flex flex-col gap-1">
          <span className="text-sub">{t("goodsSubtotal")}</span>
          {targets.map((code) => (
            <div key={code} className="flex justify-between">
              <span className="text-faint">{code}</span>
              <span className="text-ink">
                {totals.goods[code].toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        {order.commissionPct > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-sub">
              {t("commissionAmount")} ({order.commissionPct}%)
            </span>
            {targets.map((code) => (
              <div key={code} className="flex justify-between">
                <span className="text-faint">{code}</span>
                <span className="text-ink">
                  {totals.commission[code].toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <span className="text-sub">{t("grandTotal")}</span>
          {targets.map((code) => (
            <div key={code} className="flex justify-between">
              <span className="text-faint">{code}</span>
              <span className="font-semibold text-ink">
                {totals.grandTotal[code].toFixed(2)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex justify-between">
          <span className="text-sub">{t("totalCartons")}</span>
          <span className="font-semibold text-ink">
            {Number.isInteger(totals.totalCartons)
              ? totals.totalCartons
              : totals.totalCartons.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-sub">{t("totalCbm")}</span>
          <span className="font-semibold text-ink">{formatCbm(totals.totalCbm)} m³</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sub">{t("totalWeight")}</span>
          <span className="font-semibold text-ink">{totals.totalWeightKg.toFixed(2)} kg</span>
        </div>
        {hasUnmeasured ? (
          <p
            className="mt-2 rounded-md border bg-warn-soft px-2 py-1.5 text-xs text-warn"
            data-testid="order-unmeasured-note"
          >
            {t("unmeasuredIncluded")}
          </p>
        ) : null}
      </div>

      {order.notes ? (
        <div className="mt-4">
          <p className="text-sm text-sub">{t("notes")}</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{order.notes}</p>
        </div>
      ) : null}

      {totals.hasMoqViolation && order.status === "draft" ? (
        <p className="mt-4 text-xs text-warn">{t("moqBlocksConfirm")}</p>
      ) : null}

      {/* --- the trade file: documents, money in and out, expenses --- */}
      <div className="mt-8">
        <OrderFinance
          orderId={order.id}
          quoteCurrency={quote}
          supplierCurrency={supplierCurrency}
          payments={finance.payments}
          expenses={finance.expenses}
          documents={finance.documents}
        />
      </div>

      <OrderResult fin={fin} quote={quote} />

      <OrderChangelog orderId={order.id} locale={locale} />
    </div>
  );
}
