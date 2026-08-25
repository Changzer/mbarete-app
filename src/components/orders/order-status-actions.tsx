"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useIsAdmin } from "@/components/role-provider";
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
  const isAdmin = useIsAdmin();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function transition(next: "draft" | "confirmed" | "shipped" | "cancelled") {
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
            {isAdmin ? (
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
            ) : null}
          </>
        ) : null}
        {status === "cancelled" ? (
          <>
            {/* A client who changes their mind reopens the same order — no
                duplicate record, the changelog keeps the whole story. */}
            <Button size="sm" disabled={isPending} onClick={() => transition("draft")} data-testid="reopen-order">
              {t("reopenOrder")}
            </Button>
            {isAdmin ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger"
                disabled={isPending}
                onClick={() => {
                  if (confirm(t("deleteConfirm"))) deleteOrder(orderId);
                }}
              >
                {common("delete")}
              </Button>
            ) : null}
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
            {/* Quiet on purpose: cancelling is rare, and a loud button for it
                competes with the one action that moves the order forward. */}
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              className="text-danger hover:text-danger"
              onClick={() => transition("cancelled")}
            >
              {t("cancelOrder")}
            </Button>
          </>
        ) : null}
      </div>
      {error === "moq" ? <p className="text-xs text-danger">{t("moqBlocksConfirm")}</p> : null}
    </div>
  );
}
