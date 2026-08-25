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
 * From `lg` the same children lay out as one toolbar row under the header:
 * a desk has the width, and a mouse does not fat-finger anything. A row
 * instead of the old right-aligned column — eight controls stacked beside
 * the title read as clutter, not as actions.
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

      {/* Two deliberate rows, not one that wraps wherever it runs out:
          the page hands rows in, this frame just stacks them. */}
      <div className="hidden w-full flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-3 py-2.5 lg:flex">
        {children}
      </div>
    </>
  );
}
