"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { setOrderBankAccount } from "@/lib/actions/orders";
import { Label } from "@/components/ui/label";

type Option = { id: number; label: string; currency: string; isDefault: boolean };

/**
 * Which bank details the proforma will print, chosen on the order before the
 * invoice is opened. Until a choice is made the order follows the default
 * account, and picking one stores it on the order so the invoice a client
 * received keeps saying the same thing.
 */
export function ProformaBankSelect({
  orderId,
  accounts,
  selectedId,
}: {
  orderId: number;
  accounts: Option[];
  selectedId: number | null;
}) {
  const t = useTranslations("orders");
  const [isPending, startTransition] = useTransition();

  if (accounts.length === 0) return null;

  const effective =
    accounts.find((a) => a.id === selectedId) ??
    accounts.find((a) => a.isDefault) ??
    accounts[0];

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="proforma-bank" className="text-xs text-neutral-500 dark:text-neutral-400">
        {t("proformaBank")}
      </Label>
      <select
        id="proforma-bank"
        data-testid="proforma-bank"
        className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        value={effective.id}
        disabled={isPending}
        onChange={(e) => {
          const id = Number(e.target.value);
          startTransition(() => setOrderBankAccount(orderId, id));
        }}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
            {a.currency ? ` (${a.currency})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
