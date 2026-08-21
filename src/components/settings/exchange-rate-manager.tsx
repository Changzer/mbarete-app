"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { upsertExchangeRate, deleteExchangeRate, refreshRatesNow } from "@/lib/actions/settings";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

type Rate = { currencyCode: string; rateToUsd: number; source: string; updatedAt: string };

export function ExchangeRateManager({ rates }: { rates: Rate[] }) {
  const t = useTranslations("settings");
  const common = useTranslations("common");
  const [errorMessage, formAction, isPending] = useActionState(
    upsertExchangeRate,
    undefined,
  );
  const [refreshing, startRefresh] = useTransition();
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  // The freshest auto row tells the story: where rates come from and when.
  const newestAuto = rates
    .filter((r) => r.source === "auto")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  function refresh() {
    setRefreshMessage(null);
    startRefresh(async () => {
      const result = await refreshRatesNow();
      setRefreshMessage(
        result.ok ? t("refreshOk", { source: result.source }) : t("refreshFailed"),
      );
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-sub">
        {t("ratesHelp")} {t("autoHelp")}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={refresh}
          data-testid="refresh-rates"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {t("refreshNow")}
        </Button>
        <span className="text-xs text-sub" data-testid="rates-freshness">
          {newestAuto
            ? t("lastAutoUpdate", {
                when: new Date(newestAuto.updatedAt).toLocaleString(),
              })
            : t("neverAutoUpdated")}
        </span>
        {refreshMessage ? (
          <span className="text-xs text-sub" data-testid="refresh-result">
            {refreshMessage}
          </span>
        ) : null}
      </div>

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
            <p className="mt-2 text-sm text-danger">
              {common("required")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2 text-left text-sub">
            <tr>
              <th className="px-4 py-2 font-medium">{t("currencyCode")}</th>
              <th className="px-4 py-2 font-medium">{t("rateToUsd")}</th>
              <th className="px-4 py-2 font-medium">{t("example")}</th>
              <th className="px-4 py-2 font-medium">{common("actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rates.map((r) => (
              <tr key={r.currencyCode}>
                <td className="px-4 py-2 font-medium text-ink">
                  {r.currencyCode}
                  <Badge
                    variant={r.source === "auto" ? "success" : "secondary"}
                    className="ml-2"
                  >
                    {r.source === "auto" ? t("sourceAuto") : t("sourceManual")}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-ink">
                  {r.rateToUsd}
                </td>
                <td className="px-4 py-2 text-sub">
                  100 {r.currencyCode} = {(100 * r.rateToUsd).toFixed(2)} USD
                </td>
                <td className="px-4 py-2">
                  {r.currencyCode === "USD" ? (
                    <span className="text-xs text-faint">
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
