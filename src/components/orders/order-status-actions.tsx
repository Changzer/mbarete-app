"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { setOrderStatus, deleteOrder } from "@/lib/actions/orders";

export function OrderStatusActions({
  orderId,
  status,
}: {
  orderId: number;
  status: "draft" | "confirmed" | "shipped" | "cancelled";
}) {
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function transition(next: "confirmed" | "shipped" | "cancelled") {
    setError(null);
    startTransition(async () => {
      const result = await setOrderStatus(orderId, next);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "draft" ? (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/orders/${orderId}/edit`}>{common("edit")}</Link>
            </Button>
            <Button size="sm" disabled={isPending} onClick={() => transition("confirmed")}>
              {t("confirmOrder")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isPending}
              onClick={() => {
                if (confirm(t("deleteConfirm"))) deleteOrder(orderId);
              }}
            >
              {common("delete")}
            </Button>
          </>
        ) : null}
        {status === "confirmed" ? (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/orders/${orderId}/edit`}>{common("edit")}</Link>
            </Button>
            <Button size="sm" disabled={isPending} onClick={() => transition("shipped")}>
              {t("markShipped")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => transition("cancelled")}
            >
              {t("cancelOrder")}
            </Button>
          </>
        ) : null}
      </div>
      {error === "moq" ? <p className="text-xs text-red-600">{t("moqBlocksConfirm")}</p> : null}
    </div>
  );
}
