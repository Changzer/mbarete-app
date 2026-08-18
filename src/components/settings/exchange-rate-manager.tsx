"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { upsertExchangeRate, deleteExchangeRate } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

type Rate = { currencyCode: string; rateToUsd: number; updatedAt: string };

export function ExchangeRateManager({ rates }: { rates: Rate[] }) {
  const t = useTranslations("settings");
  const common = useTranslations("common");
  const [errorMessage, formAction, isPending] = useActionState(
    upsertExchangeRate,
    undefined,
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        {t("ratesHelp")}
      </p>

      <Card>
        <CardContent className="p-4">
          <form action={formAction} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="currencyCode">{t("currencyCode")}</Label>
              <Input
                id="currencyCode"
                name="currencyCode"
                placeholder="CNY"
                className="w-32"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rateToUsd">{t("rateToUsd")}</Label>
              <Input
                id="rateToUsd"
                name="rateToUsd"
                type="number"
                inputMode="decimal"
                step="0.000001"
                min="0"
                placeholder="0.14"
                className="w-40"
                required
              />
            </div>
            <Button type="submit" disabled={isPending}>
              {t("saveRate")}
            </Button>
          </form>
          {errorMessage ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {common("required")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
            <tr>
              <th className="px-4 py-2 font-medium">{t("currencyCode")}</th>
              <th className="px-4 py-2 font-medium">{t("rateToUsd")}</th>
              <th className="px-4 py-2 font-medium">{t("example")}</th>
              <th className="px-4 py-2 font-medium">{common("actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {rates.map((r) => (
              <tr key={r.currencyCode}>
                <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">
                  {r.currencyCode}
                </td>
                <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">
                  {r.rateToUsd}
                </td>
                <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400">
                  100 {r.currencyCode} = {(100 * r.rateToUsd).toFixed(2)} USD
                </td>
                <td className="px-4 py-2">
                  {r.currencyCode === "USD" ? (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      {t("baseCurrency")}
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(t("deleteRateConfirm"))) {
                          deleteExchangeRate(r.currencyCode);
                        }
                      }}
                    >
                      {common("delete")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
