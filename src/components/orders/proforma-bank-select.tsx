"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { setOrderBankAccount } from "@/lib/actions/orders";
import { defaultBankAccount } from "@/lib/proforma-bank";
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

  const stored = accounts.find((a) => a.id === selectedId);
  const fallback = defaultBankAccount(accounts);

  const name = (a: Option) => `${a.label}${a.currency ? ` (${a.currency})` : ""}`;

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="proforma-bank" className="text-xs text-sub">
        {t("proformaBank")}
      </Label>
      <select
        id="proforma-bank"
        data-testid="proforma-bank"
        className="h-8 rounded-md border border-line bg-white px-2 text-xs text-ink dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        value={stored ? String(stored.id) : ""}
        disabled={isPending}
        onChange={(e) => {
          const id = Number(e.target.value);
          if (!id) return;
          startTransition(() => setOrderBankAccount(orderId, id));
        }}
      >
        {/*
          Orders from before this feature stored no account and follow the
          default. The placeholder says so — and because it is a distinct
          value, explicitly choosing the default pins it on the order.
        */}
        {!stored && fallback ? (
          <option value="">{t("proformaBankDefault", { label: name(fallback) })}</option>
        ) : null}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {name(a)}
          </option>
        ))}
      </select>
    </div>
  );
}
