"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { addShippingRate } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DESTINATIONS, SHIPPING_MODES, ratePerCbm, type Destination, type ShippingMode } from "@/lib/landed-cost";
import { formatMoney } from "@/lib/money";

type Basis = "per_cbm" | "per_40hq";

export type ShippingRateRow = {
  id: number;
  destination: Destination;
  mode: ShippingMode;
  basis: Basis;
  amount: number;
  currency: string;
  usableCbm: number;
  note: string;
  effectiveFrom: string;
  createdAt: string;
  createdByName: string | null;
};

/** How a quote is usually written for each mode; the form pre-selects it and lets the user override. */
const DEFAULT_BASIS: Record<ShippingMode, Basis> = { lcl: "per_cbm", fcl: "per_40hq" };

/**
 * Freight estimates as a log: a form that only ever appends, the estimate
 * in force per destination and mode on top, and every past row below it so
 * the change over time reads at a glance.
 */
export function ShippingRatesManager({
  rows,
  latestIds,
  currencies,
  asOf,
}: {
  rows: ShippingRateRow[];
  latestIds: number[];
  currencies: string[];
  asOf: string;
}) {
  const t = useTranslations("settings");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    submitting.current = true;
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await addShippingRate(undefined, data);
        setError(result);
        if (!result) {
          form.reset();
          setSaved(true);
        }
      } catch {
        setError("save-failed");
      } finally {
        submitting.current = false;
      }
    });
  }
  const [destination, setDestination] = useState<Destination>("BR");
  const [mode, setMode] = useState<ShippingMode>("lcl");
  const [basis, setBasis] = useState<Basis>("per_cbm");
  const [currency, setCurrency] = useState(currencies.includes("USD") ? "USD" : (currencies[0] ?? "USD"));
  const today = asOf;
  const current = rows.filter((r) => latestIds.includes(r.id));

  return (
    <div className="flex flex-col gap-6" data-testid="shipping-rates">
      <p className="text-sm text-sub">{t("shippingHelp")}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="shipping-current">
        {DESTINATIONS.map((d) => (
          <div key={d} className="rounded-[12px] border border-line bg-surface p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sub">{t(`destination_${d}`)}</p>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5">
              {SHIPPING_MODES.map((m) => {
                const row = current.find((r) => r.destination === d && r.mode === m);
                return (
                  <div key={m} className="contents" data-testid={`shipping-current-${d}-${m}`}>
                    <dt className="font-mono text-[11px] font-semibold uppercase text-sub">{t(`mode_${m}`)}</dt>
                    {row ? (
                      <dd className="min-w-0">
                        <p className="font-mono text-[18px] font-extrabold leading-tight tabular-nums text-ink">
                          {formatMoney(ratePerCbm(row), row.currency)}
                          <span className="ml-1 text-[12px] font-medium text-sub">/ m³</span>
                        </p>
                        <p className="font-mono text-[11px] text-sub">
                          {formatMoney(row.amount, row.currency)} {t(`basis_${row.basis}`)}
                          {row.basis === "per_40hq" ? ` · ${row.usableCbm} m³` : ""} · {t("since")} {row.effectiveFrom}
                        </p>
                      </dd>
                    ) : (
                      <dd className="text-[12px] text-warn">{t("noRateYet")}</dd>
                    )}
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="shipping-form">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ship-destination">{t("destination")}</Label>
              <input type="hidden" name="destination" value={destination} />
              <Select value={destination} onValueChange={(v) => setDestination(v as Destination)}>
                <SelectTrigger id="ship-destination" data-testid="ship-destination">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DESTINATIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {t(`destination_${d}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ship-mode">{t("mode")}</Label>
              <input type="hidden" name="mode" value={mode} />
              <Select
                value={mode}
                onValueChange={(v) => {
                  const next = v as ShippingMode;
                  setMode(next);
                  setBasis(DEFAULT_BASIS[next]);
                }}
              >
                <SelectTrigger id="ship-mode" data-testid="ship-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIPPING_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`mode_${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ship-basis">{t("basis")}</Label>
              <input type="hidden" name="basis" value={basis} />
              <Select value={basis} onValueChange={(v) => setBasis(v as Basis)}>
                <SelectTrigger id="ship-basis" data-testid="ship-basis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="per_cbm">{t("basis_per_cbm")}</SelectItem>
                  <SelectItem value="per_40hq">{t("basis_per_40hq")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ship-amount">{t("amount")}</Label>
              <Input id="ship-amount" name="amount" type="text" numeric inputMode="decimal" required placeholder={basis === "per_40hq" ? "6800" : "120"} data-testid="ship-amount" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ship-currency">{t("currencyCode")}</Label>
              <input type="hidden" name="currency" value={currency} />
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="ship-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(currencies.length ? currencies : ["USD"]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {basis === "per_40hq" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ship-usable">{t("usableCbm")}</Label>
                <Input id="ship-usable" name="usableCbm" type="text" numeric inputMode="decimal" defaultValue={68} required />
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ship-from">{t("effectiveFrom")}</Label>
              <Input id="ship-from" name="effectiveFrom" type="date" defaultValue={today} required data-testid="ship-from" />
            </div>
            <p className="col-span-2 -mt-1 text-[11px] leading-snug text-sub md:col-span-4">{t("modeHelp")}</p>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="ship-note">{t("note")}</Label>
              <Input id="ship-note" name="note" placeholder={t("notePlaceholder")} maxLength={200} />
            </div>
            <div className="col-span-2 flex items-end md:col-span-4">
              <Button type="submit" disabled={pending} data-testid="ship-save">
                {t("addRate")}
              </Button>
              {error ? <span role="alert" className="ml-3 text-sm text-danger">{t(error === "invalid" ? "shippingInvalid" : "shippingSaveFailed")}</span> : null}
              {saved ? <span role="status" className="ml-3 text-sm text-ok">{t("shippingSaved")}</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm" data-testid="shipping-history">
          <thead className="border-b border-line bg-surface-2 text-left text-sub">
            <tr>
              <th className="px-4 py-2 font-medium">{t("effectiveFrom")}</th>
              <th className="px-4 py-2 font-medium">{t("destination")}</th>
              <th className="px-4 py-2 font-medium">{t("mode")}</th>
              <th className="px-4 py-2 font-medium">{t("amount")}</th>
              <th className="px-4 py-2 font-medium">/ m³</th>
              <th className="px-4 py-2 font-medium">{t("note")}</th>
              <th className="px-4 py-2 font-medium">{t("recordedBy")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-3 text-sub">
                  {t("noRates")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} data-testid={`shipping-row-${r.id}`}>
                  <td className="px-4 py-2 font-mono text-ink">{r.effectiveFrom}</td>
                  <td className="px-4 py-2 text-ink">{t(`destination_${r.destination}`)}</td>
                  <td className="px-4 py-2 text-ink">
                    <span className="font-mono text-[12px] font-semibold uppercase">{t(`mode_${r.mode}`)}</span>
                    {latestIds.includes(r.id) ? (
                      <Badge variant="success" className="ml-2">
                        {t("inForce")}
                      </Badge>
                    ) : r.effectiveFrom > asOf ? (
                      <Badge variant="secondary" className="ml-2">{t("scheduled")}</Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 font-mono tabular-nums text-ink">
                    {formatMoney(r.amount, r.currency)} <span className="text-sub">{t(`basis_${r.basis}`)}</span>
                    {r.basis === "per_40hq" ? <span className="text-sub"> · {r.usableCbm} m³</span> : null}
                  </td>
                  <td className="px-4 py-2 font-mono tabular-nums text-ink">{formatMoney(ratePerCbm(r), r.currency)}</td>
                  <td className="px-4 py-2 text-sub">{r.note}</td>
                  <td className="px-4 py-2 text-sub">
                    {r.createdByName ?? "—"} · {r.createdAt.slice(0, 10)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
