"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useIsAdmin } from "@/components/role-provider";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { setOrderStatus, deleteOrder } from "@/lib/actions/orders";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export function OrderStatusActions({
  orderId,
  status,
  version,
}: {
  orderId: number;
  status: "draft" | "confirmed" | "shipped" | "cancelled";
  /** the order version this page rendered from — transitions carry it */
  version: number;
}) {
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const isAdmin = useIsAdmin();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ action: "ship" | "reopen"; version: number } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  function transition(next: "draft" | "confirmed" | "shipped" | "cancelled", acknowledged?: "ship" | "reopen") {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await setOrderStatus(orderId, next, confirmation?.version ?? version, acknowledged);
        if (result?.error) setError(result.error);
        else setConfirmation(null);
      } catch {
        setError("failed");
      }
    });
  }

  function ask(action: "ship" | "reopen") {
    setError(null);
    setConfirmation({ action, version });
  }
  function close() {
    if (isPending) return;
    setConfirmation(null);
    setError(null);
  }
  const feedback = error ? (
    <p className="text-sm text-danger" role="alert" data-testid={error === "conflict" ? "status-conflict" : "status-error"}>
      {error === "moq" ? t("moqBlocksConfirm") : error === "conflict" ? t("orderConflict")
        : error === "frozen" ? t("orderFrozen") : error === "confirmation" ? t("statusConfirmationRequired") : t("statusFailed")}
    </p>
  ) : null;

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
            <Button size="sm" disabled={isPending} onClick={() => ask("ship")} data-testid="mark-shipped">
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
        {status === "shipped" ? (
          <Button variant="outline" size="sm" disabled={isPending} onClick={() => ask("reopen")} data-testid="reopen-shipped-order">
            {t("reopenShipped")}
          </Button>
        ) : null}
      </div>
      {status === "shipped" ? <p className="text-xs text-sub">{t("orderFrozen")}</p> : null}
      {!confirmation ? feedback : null}
      <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent
          data-testid="order-status-dialog"
          hideClose={isPending}
          onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}
        >
          <DialogHeader>
            <DialogTitle>{t(confirmation?.action === "ship" ? "shipConfirmTitle" : "reopenShippedTitle")}</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {t(confirmation?.action === "ship" ? "shipConfirmHelp" : "reopenShippedHelp")}
            </DialogDescription>
          </DialogHeader>
          {feedback}
          <DialogFooter>
            <Button ref={cancelRef} variant="outline" disabled={isPending} onClick={close} className="min-h-11">
              {common("cancel")}
            </Button>
            <Button disabled={isPending} data-testid="confirm-order-status" className="min-h-11" onClick={() => {
              if (confirmation) transition(confirmation.action === "ship" ? "shipped" : "confirmed", confirmation.action);
            }}>
              {isPending ? common("saving") : t(confirmation?.action === "ship" ? "shipConfirmAction" : "reopenShippedAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
