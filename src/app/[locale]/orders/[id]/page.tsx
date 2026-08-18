import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOrderById, getExchangeRates } from "@/lib/queries/orders";
import { getProducts } from "@/lib/queries/catalog";
import { localizeField } from "@/lib/localize";
import type { Locale } from "@/i18n/routing";
import { computeSnapshotTotals, formatCbm } from "@/lib/calculations";
import { Badge } from "@/components/ui/badge";
import { OrderStatusActions } from "@/components/orders/order-status-actions";

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

  const [data, rates, products] = await Promise.all([
    getOrderById(Number(id)),
    getExchangeRates(),
    getProducts(),
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
  const totalCbm = totals.totalCbm;
  const totalWeight = totals.totalWeightKg;
  const hasMoqViolation = totals.hasMoqViolation;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{order.orderNumber}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{client?.companyName}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant={STATUS_VARIANT[order.status]}>
            {t(`status${order.status.charAt(0).toUpperCase()}${order.status.slice(1)}` as "statusDraft")}
          </Badge>
          <OrderStatusActions orderId={order.id} status={order.status} />
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
    </div>
  );
}
