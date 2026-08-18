import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOrderById, getExchangeRates, getOrderFinanceRows } from "@/lib/queries/orders";
import { getProducts } from "@/lib/queries/catalog";
import { getUserNames } from "@/lib/queries/users";
import { localizeField } from "@/lib/localize";
import type { Locale } from "@/i18n/routing";
import {
  computeSnapshotTotals,
  computeOrderFinance,
  formatCbm,
} from "@/lib/calculations";
import { Badge } from "@/components/ui/badge";
import { OrderStatusActions } from "@/components/orders/order-status-actions";
import { OrderFinance } from "@/components/orders/order-finance";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

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

  const financeT = await getTranslations("finance");
  const [data, rates, products, userNames, finance] = await Promise.all([
    getOrderById(Number(id)),
    getExchangeRates(),
    getProducts(),
    getUserNames(),
    getOrderFinanceRows(Number(id)),
  ]);

  if (!data) notFound();
  const { order, items, client } = data;
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Prefer the rates frozen when the order was saved, so a historical quote
  // stays as quoted. Live rates fill the gaps rather than replacing anything:
  // an order saved before a currency had a rate would otherwise be stuck
  // reporting a 0.00 total forever, even once the rate is added in Settings.
  let snapshot: Record<string, number> = {};
  try {
    snapshot = JSON.parse(order.ratesSnapshot || "{}");
  } catch {
    snapshot = {};
  }
  const effectiveRates = { ...rates, ...snapshot };

  const rows = items.map((item) => {
    const product = productMap.get(item.productId);
    const name = product
      ? localizeField(locale as Locale, product.nameEn, product.nameZh)
      : `#${item.productId}`;
    const below = item.quantity < item.moqSnapshot;
    // lineCbm was stored as the line's total volume; recover the carton count
    // from the product's current pack size where it is still available.
    const perCarton = product?.qtyPerBox ?? 0;
    // Orders saved before cartons were snapshotted carry 0; recover the count
    // from the product's current pack size for those.
    const cartons =
      item.cartonsSnapshot > 0
        ? item.cartonsSnapshot
        : perCarton > 0
          ? Math.ceil(item.quantity / perCarton)
          : null;
    return { ...item, name, below, cartons, perCarton };
  });

  const targets = [...new Set([order.displayCurrency, order.secondaryCurrency])];
  const totals = computeSnapshotTotals(
    rows.map((r) => ({
      // the values frozen at save time, not today's catalog
      quantity: r.quantity,
      unitPrice: r.unitPriceSnapshot,
      currency: r.currencySnapshot,
      moq: r.moqSnapshot,
      lineCbm: r.lineCbm,
      lineWeightKg: r.lineWeightKg,
      cartons: r.cartons ?? 0,
    })),
    targets,
    effectiveRates,
    order.commissionPct,
  );
  // The money position: what the client is billed against what the supplier
  // charges, then every recorded movement on top.
  const quote = order.displayCurrency;
  const fin = computeOrderFinance(
    {
      expectedRevenue: totals.grandTotal[quote] ?? 0,
      expectedCost: totals.goods[quote] ?? 0,
      paymentsIn: finance.payments.filter((p) => p.direction === "in"),
      paymentsOut: finance.payments.filter((p) => p.direction === "out"),
      expenses: finance.expenses,
    },
    quote,
    effectiveRates,
  );
  const supplierCurrency = items[0]?.currencySnapshot ?? order.secondaryCurrency;
  const money = (n: number) => `${n.toFixed(2)} ${quote}`;

  // Lines whose product had no measurements when the order was saved.
  const hasUnmeasured = rows.some((r) => r.lineCbm <= 0 || r.lineWeightKg <= 0);
  const totalCbm = totals.totalCbm;
  const totalWeight = totals.totalWeightKg;
  const hasMoqViolation = totals.hasMoqViolation;

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
                <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">
                  {r.unitPriceSnapshot.toFixed(2)} {r.currencySnapshot}
                </td>
                <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">
                  {r.lineTotal.toFixed(2)} {r.currencySnapshot}
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
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">{formatCbm(totalCbm)} m³</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500 dark:text-neutral-400">{t("totalWeight")}</span>
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">{totalWeight.toFixed(2)} kg</span>
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

      {hasMoqViolation && order.status === "draft" ? (
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

      {/* --- where the order lands --- */}
      <div
        className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        data-testid="section-net"
      >
        <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {financeT("netTitle")}
        </h2>

        {fin.missingRates.length > 0 ? (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {t("missingRate", { codes: fin.missingRates.join(", ") })}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-6 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">{financeT("expectedRevenue")}</span>
              <span className="text-neutral-900 dark:text-neutral-100">{money(fin.received + fin.clientOutstanding)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">{financeT("received")}</span>
              <span className="text-neutral-900 dark:text-neutral-100" data-testid="fin-received">{money(fin.received)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">{financeT("clientOutstanding")}</span>
              <span
                className={fin.clientOutstanding > 0.005 ? "font-medium text-amber-700 dark:text-amber-400" : "text-neutral-900 dark:text-neutral-100"}
                data-testid="fin-client-outstanding"
              >
                {money(fin.clientOutstanding)}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">{financeT("expectedCost")}</span>
              <span className="text-neutral-900 dark:text-neutral-100">{money(fin.paidOut + fin.supplierOutstanding)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">{financeT("paidOut")}</span>
              <span className="text-neutral-900 dark:text-neutral-100" data-testid="fin-paid-out">{money(fin.paidOut)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">{financeT("supplierOutstanding")}</span>
              <span
                className={fin.supplierOutstanding > 0.005 ? "font-medium text-amber-700 dark:text-amber-400" : "text-neutral-900 dark:text-neutral-100"}
                data-testid="fin-supplier-outstanding"
              >
                {money(fin.supplierOutstanding)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-1 border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
          <div className="flex justify-between">
            <span className="text-neutral-500 dark:text-neutral-400">{financeT("expensesTotal")}</span>
            <span className="text-neutral-900 dark:text-neutral-100" data-testid="fin-expenses">{money(fin.expensesTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500 dark:text-neutral-400">{financeT("netActual")}</span>
            <span
              className={`font-semibold ${fin.netActual < 0 ? "text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-neutral-100"}`}
              data-testid="fin-net-actual"
            >
              {money(fin.netActual)}
            </span>
          </div>
          <div className="flex justify-between text-base">
            <span className="font-medium text-neutral-900 dark:text-neutral-100">{financeT("netExpected")}</span>
            <span className="font-bold text-neutral-900 dark:text-neutral-100" data-testid="fin-net-expected">
              {money(fin.netExpected)}
              {fin.marginPct !== null ? (
                <span className="ml-2 text-sm font-normal text-neutral-500 dark:text-neutral-400">
                  ({fin.marginPct.toFixed(1)}%)
                </span>
              ) : null}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{financeT("netHelp")}</p>
        </div>
      </div>
    </div>
  );
}
