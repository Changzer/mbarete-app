import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOrderView } from "@/lib/queries/order-view";
import { getOrderFinanceRows } from "@/lib/queries/orders";
import { getUserNames } from "@/lib/queries/users";
import type { Locale } from "@/i18n/routing";
import { computeOrderFinance, formatCbm } from "@/lib/calculations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { OrderStatusActions } from "@/components/orders/order-status-actions";
import { OrderFinance } from "@/components/orders/order-finance";
import { OrderResult } from "@/components/orders/order-result";

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

  const [view, userNames, finance] = await Promise.all([
    getOrderView(Number(id), locale as Locale),
    getUserNames(),
    getOrderFinanceRows(Number(id)),
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
      paymentsIn: finance.payments.filter((p) => p.direction === "in"),
      paymentsOut: finance.payments.filter((p) => p.direction === "out"),
      expenses: finance.expenses,
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
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{order.orderNumber}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{client?.companyName}</p>
          <p
            className="mt-1 text-xs text-neutral-500 dark:text-neutral-400"
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
          <Button asChild variant="outline" size="sm">
            <Link href={`/orders/${order.id}/proforma`}>{proformaT("open")}</Link>
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
            <tr>
              <th className="px-4 py-2 font-medium">{catalogT("title")}</th>
              <th className="px-4 py-2 font-medium">{t("quantity")}</th>
              <th className="px-4 py-2 font-medium">{t("totalCartons")}</th>
              <th className="px-4 py-2 font-medium">{t("unitCost")}</th>
              <th className="px-4 py-2 font-medium">{t("unitPrice")}</th>
              <th className="px-4 py-2 font-medium">{t("lineTotal")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 text-neutral-900 dark:text-neutral-100">{r.name}</td>
                <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">
                  {r.quantity}
                  {r.below ? (
                    <Badge variant="warning" className="ml-2">
                      {t("moqWarning", { moq: r.moqSnapshot })}
                    </Badge>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">
                  {r.cartons !== null ? `${r.cartons} × ${r.perCarton}` : "—"}
                </td>
                <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400">
                  {r.unitPriceSnapshot.toFixed(2)} {r.currencySnapshot}
                </td>
                <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">
                  {r.sellPrice.toFixed(2)} {r.currencySnapshot}
                </td>
                <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">
                  {r.sellTotal.toFixed(2)} {r.currencySnapshot}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 text-sm sm:w-80 sm:self-end">
        {totals.missingRates.length > 0 ? (
          <p className="rounded-md bg-amber-100 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            {t("missingRate", { codes: totals.missingRates.join(", ") })}
          </p>
        ) : null}

        <div className="flex flex-col gap-1">
          <span className="text-neutral-500 dark:text-neutral-400">{t("goodsSubtotal")}</span>
          {targets.map((code) => (
            <div key={code} className="flex justify-between">
              <span className="text-neutral-400 dark:text-neutral-500">{code}</span>
              <span className="text-neutral-700 dark:text-neutral-300">
                {totals.goods[code].toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        {order.commissionPct > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-neutral-500 dark:text-neutral-400">
              {t("commissionAmount")} ({order.commissionPct}%)
            </span>
            {targets.map((code) => (
              <div key={code} className="flex justify-between">
                <span className="text-neutral-400 dark:text-neutral-500">{code}</span>
                <span className="text-neutral-700 dark:text-neutral-300">
                  {totals.commission[code].toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-1 border-t border-neutral-200 dark:border-neutral-800 pt-2">
          <span className="text-neutral-500 dark:text-neutral-400">{t("grandTotal")}</span>
          {targets.map((code) => (
            <div key={code} className="flex justify-between">
              <span className="text-neutral-400 dark:text-neutral-500">{code}</span>
              <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                {totals.grandTotal[code].toFixed(2)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500 dark:text-neutral-400">{t("totalCartons")}</span>
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
            {Number.isInteger(totals.totalCartons)
              ? totals.totalCartons
              : totals.totalCartons.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500 dark:text-neutral-400">{t("totalCbm")}</span>
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">{formatCbm(totals.totalCbm)} m³</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500 dark:text-neutral-400">{t("totalWeight")}</span>
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">{totals.totalWeightKg.toFixed(2)} kg</span>
        </div>
        {hasUnmeasured ? (
          <p
            className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
            data-testid="order-unmeasured-note"
          >
            {t("unmeasuredIncluded")}
          </p>
        ) : null}
      </div>

      {order.notes ? (
        <div className="mt-4">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("notes")}</p>
          <p className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">{order.notes}</p>
        </div>
      ) : null}

      {totals.hasMoqViolation && order.status === "draft" ? (
        <p className="mt-4 text-xs text-amber-700">{t("moqBlocksConfirm")}</p>
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
    </div>
  );
}
