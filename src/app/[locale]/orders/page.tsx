import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getOrders } from "@/lib/queries/orders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ClipboardList } from "lucide-react";
import { requireUser, requireModulePage } from "@/lib/authz";

const STATUS_VARIANT = {
  draft: "secondary",
  confirmed: "default",
  shipped: "success",
  cancelled: "destructive",
} as const;

export default async function OrdersPage() {
  const t = await getTranslations("orders");
  const _mbUser = await requireUser();
  const { companyId } = _mbUser;
  await requireModulePage(_mbUser, "orders");
  const orders = await getOrders(companyId);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[23px] font-extrabold tracking-tight text-ink">{t("title")}</h1>
        <Button asChild size="sm">
          <Link href="/orders/new">{t("newOrder")}</Link>
        </Button>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={<ClipboardList strokeWidth={1.5} />}
          title={t("noOrders")}
          action={
            <Button asChild size="sm">
              <Link href="/orders/new">{t("newOrder")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* A phone gets rows: order number and status are what a person is
              scanning for, and five columns of them do not fit at 360px. */}
          <ul className="flex flex-col gap-2 lg:hidden" data-testid="order-rows">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/orders/${o.id}`}
                  className="press focus-ring flex items-center gap-3 rounded-[12px] border border-line bg-surface p-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13.5px] font-semibold text-ink">
                      {o.orderNumber}
                    </span>
                    <span className="block truncate text-[12.5px] text-sub">{o.clientName}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-faint">
                      {new Date(o.createdAt).toLocaleDateString()} ·{" "}
                      {o.createdByName ?? t("unknownUser")}
                    </span>
                  </span>
                  <Badge variant={STATUS_VARIANT[o.status]} className="shrink-0">
                    {t(`status${o.status.charAt(0).toUpperCase()}${o.status.slice(1)}` as "statusDraft")}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-[12px] border border-line bg-surface lg:block">
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
        </>
      )}
    </div>
  );
}
