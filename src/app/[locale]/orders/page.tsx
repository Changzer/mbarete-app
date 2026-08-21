import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getOrders } from "@/lib/queries/orders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT = {
  draft: "secondary",
  confirmed: "default",
  shipped: "success",
  cancelled: "destructive",
} as const;

export default async function OrdersPage() {
  const t = await getTranslations("orders");
  const orders = await getOrders();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
        <Button asChild size="sm">
          <Link href="/orders/new">{t("newOrder")}</Link>
        </Button>
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-sub">{t("noOrders")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-left text-sub">
              <tr>
                <th className="px-4 py-2 font-medium">{t("orderNumber")}</th>
                <th className="px-4 py-2 font-medium">{t("client")}</th>
                <th className="px-4 py-2 font-medium">{t("status")}</th>
                <th className="px-4 py-2 font-medium">{t("filedBy")}</th>
                <th className="px-4 py-2 font-medium">{t("createdAt")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-surface-2">
                  <td className="px-4 py-2">
                    <Link href={`/orders/${o.id}`} className="font-medium text-ink hover:underline">
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-ink">{o.clientName}</td>
                  <td className="px-4 py-2">
                    <Badge variant={STATUS_VARIANT[o.status]}>
                      {t(`status${o.status.charAt(0).toUpperCase()}${o.status.slice(1)}` as "statusDraft")}
                    </Badge>
                  </td>
                  <td
                    className="px-4 py-2 text-ink"
                    data-testid={`order-filed-by-${o.id}`}
                  >
                    {o.createdByName ?? t("unknownUser")}
                  </td>
                  <td className="px-4 py-2 text-sub">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
