"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";

/**
 * On a phone, an order's actions live in a sheet behind one button.
 *
 * Confirm, ship, cancel, delete, edit and the proforma is six controls that
 * would otherwise wrap into three rows above the figures a person opened this
 * page to read — and half of them are one-way doors that deserve a deliberate
 * second tap rather than a thumb brushing past on the way down the page.
 *
 * From `lg` the same children lay out as a row: a desk has the width, and a
 * mouse does not fat-finger anything.
 */
export function OrderActionsSheet({
  status,
  children,
}: {
  status: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("orders");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="lg:hidden"
        data-testid="order-actions"
        onClick={() => setOpen(true)}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
        {t("actions")}
      </Button>

      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={t("actions")}
        description={status}
      >
        {/* The same controls, stacked full-width so each is its own target. */}
        <div
          className="flex flex-col gap-2 [&_a]:w-full [&_button]:w-full [&>div]:flex [&>div]:flex-col [&>div]:gap-2 [&_div]:w-full"
          data-testid="order-actions-sheet"
        >
          {children}
        </div>
      </BottomSheet>

      <div className="hidden flex-col items-end gap-2 lg:flex">{children}</div>
    </>
  );
}
