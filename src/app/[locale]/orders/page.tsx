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
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h1>
        <Button asChild size="sm">
          <Link href="/orders/new">{t("newOrder")}</Link>
        </Button>
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("noOrders")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2 font-medium">{t("orderNumber")}</th>
                <th className="px-4 py-2 font-medium">{t("client")}</th>
                <th className="px-4 py-2 font-medium">{t("status")}</th>
                <th className="px-4 py-2 font-medium">{t("filedBy")}</th>
                <th className="px-4 py-2 font-medium">{t("createdAt")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800">
                  <td className="px-4 py-2">
                    <Link href={`/orders/${o.id}`} className="font-medium text-neutral-900 dark:text-neutral-100 hover:underline">
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">{o.clientName}</td>
                  <td className="px-4 py-2">
                    <Badge variant={STATUS_VARIANT[o.status]}>
                      {t(`status${o.status.charAt(0).toUpperCase()}${o.status.slice(1)}` as "statusDraft")}
                    </Badge>
                  </td>
                  <td
                    className="px-4 py-2 text-neutral-700 dark:text-neutral-300"
                    data-testid={`order-filed-by-${o.id}`}
                  >
                    {o.createdByName ?? t("unknownUser")}
                  </td>
                  <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400">
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
