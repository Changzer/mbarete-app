import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOrderById, getExchangeRates } from "@/lib/queries/orders";
import { getProducts } from "@/lib/queries/catalog";
import { localizeField } from "@/lib/localize";
import type { Locale } from "@/i18n/routing";
import { convert } from "@/lib/calculations";
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

  const rows = items.map((item) => {
    const product = productMap.get(item.productId);
    const name = product
      ? localizeField(locale as Locale, product.nameEn, product.nameZh)
      : `#${item.productId}`;
    const converted = convert(item.lineTotal, item.currencySnapshot, order.displayCurrency, rates);
    const below = item.quantity < item.moqSnapshot;
    return { ...item, name, below, converted };
  });

  const totalPrice = rows.reduce((sum, r) => sum + r.converted, 0);
  const totalCbm = rows.reduce((sum, r) => sum + r.lineCbm, 0);
  const totalWeight = rows.reduce((sum, r) => sum + r.lineWeightKg, 0);
  const hasMoqViolation = rows.some((r) => r.below);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{order.orderNumber}</h1>
          <p className="text-sm text-neutral-500">{client?.companyName}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant={STATUS_VARIANT[order.status]}>
            {t(`status${order.status.charAt(0).toUpperCase()}${order.status.slice(1)}` as "statusDraft")}
          </Badge>
          <OrderStatusActions orderId={order.id} status={order.status} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">{catalogT("title")}</th>
              <th className="px-4 py-2 font-medium">{t("quantity")}</th>
              <th className="px-4 py-2 font-medium">{t("unitPrice")}</th>
              <th className="px-4 py-2 font-medium">{t("lineTotal")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 text-neutral-900">{r.name}</td>
                <td className="px-4 py-2 text-neutral-700">
                  {r.quantity}
                  {r.below ? (
                    <Badge variant="warning" className="ml-2">
                      {t("moqWarning", { moq: r.moqSnapshot })}
                    </Badge>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-neutral-700">
                  {r.unitPriceSnapshot.toFixed(2)} {r.currencySnapshot}
                </td>
                <td className="px-4 py-2 text-neutral-700">
                  {r.lineTotal.toFixed(2)} {r.currencySnapshot}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-4 text-sm sm:w-72 sm:self-end">
        <div className="flex justify-between">
          <span className="text-neutral-500">{t("totalPrice")}</span>
          <span className="font-semibold text-neutral-900">
            {totalPrice.toFixed(2)} {order.displayCurrency}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">{t("totalCbm")}</span>
          <span className="font-semibold text-neutral-900">{totalCbm.toFixed(4)} m³</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">{t("totalWeight")}</span>
          <span className="font-semibold text-neutral-900">{totalWeight.toFixed(2)} kg</span>
        </div>
      </div>

      {order.notes ? (
        <div className="mt-4">
          <p className="text-sm text-neutral-500">{t("notes")}</p>
          <p className="whitespace-pre-wrap text-sm text-neutral-800">{order.notes}</p>
        </div>
      ) : null}

      {hasMoqViolation && order.status === "draft" ? (
        <p className="mt-4 text-xs text-amber-700">{t("moqBlocksConfirm")}</p>
      ) : null}
    </div>
  );
}
