"use client";

import { useTranslations } from "next-intl";
import { OrderSection } from "@/components/orders/order-section";
import type { SupplierBalance } from "@/lib/supplier-balances";

const money = (value: number) => value.toFixed(2);

export function SupplierPaymentBalances({ balances }: { balances: SupplierBalance[] }) {
  const t = useTranslations("finance");
  if (balances.length === 0) return null;
  return (
    <OrderSection
      title={t("supplierBalances")}
      description={t("supplierBalancesHelp")}
      data-testid="supplier-balances"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {balances.map((supplier) => (
          <div
            key={supplier.supplierId ?? "unassigned"}
            className="rounded-md border border-line bg-surface-2 p-3"
            data-testid={`supplier-balance-${supplier.supplierId ?? "unassigned"}`}
          >
            <h3 className="text-[13px] font-semibold text-ink">
              {supplier.name ?? t("unassignedPayments")}
            </h3>
            {supplier.supplierId === null ? (
              <p className="mt-1 text-[11px] text-warn">{t("unassignedHelp")}</p>
            ) : null}
            <div className="mt-2 flex flex-col gap-2">
              {supplier.currencies.map((row) => (
                <div key={row.currency} data-testid={`supplier-balance-currency-${row.currency}`}>
                  <div className="grid grid-cols-3 gap-2 text-[11px] text-sub">
                    <span>{t("supplierCost")}</span>
                    <span>{t("supplierPaid")}</span>
                    <span>{row.balance < 0 ? t("supplierOverpaid") : t("supplierOwed")}</span>
                  </div>
                  <div className={`mt-0.5 grid grid-cols-3 gap-2 font-mono text-[12px] tabular-nums ${row.balance > 0 ? "text-warn" : "text-ink"}`}>
                    <span>{money(row.cost)} {row.currency}</span>
                    <span>{money(row.paid)} {row.currency}</span>
                    <span className="font-semibold">{money(Math.abs(row.balance))} {row.currency}</span>
                  </div>
                  {row.unconvertible.length > 0 ? (
                    <p className="mt-1 text-[11px] text-danger">
                      {t("supplierMissingRates", {
                        values: row.unconvertible.map((payment) => `${money(payment.amount)} ${payment.currency}`).join(", "),
                      })}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </OrderSection>
  );
}
