"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { updateOrderPacking } from "@/lib/actions/order-packing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { normalizeDecimalInput } from "@/lib/decimal-input";

export type PackingLine = {
  productId: number;
  name: string;
  sku: string;
  quantity: number;
  perCarton: number;
  cartonCbm: number;
  cartonKg: number;
  cartons: number | null;
  /** The figures are the factory's, entered here — not the quote. */
  confirmed: boolean;
};

type Draft = { perCarton: string; cartonCbm: string; cartonKg: string };

const asText = (n: number) => (n > 0 ? String(n) : "");
const toNumber = (v: string) => {
  const n = Number(normalizeDecimalInput(v.trim()));
  return v.trim() === "" ? 0 : n;
};

/**
 * The order's cartons as the factory packed them. Each line starts on the
 * figures it was quoted with; whatever changes at the factory is corrected
 * here, line by line, and the packing list, customs pack and carton labels
 * all count the boxes from it. Quantities and money never change here.
 */
export function PackingCard({
  orderId,
  version,
  lines,
}: {
  orderId: number;
  version: number;
  lines: PackingLine[];
}) {
  const t = useTranslations("orders");
  const router = useRouter();
  const start = (l: PackingLine): Draft => ({
    perCarton: asText(l.perCarton),
    cartonCbm: asText(l.cartonCbm),
    cartonKg: asText(l.cartonKg),
  });
  const fromLines = () => Object.fromEntries(lines.map((l) => [l.productId, start(l)])) as Record<number, Draft>;
  const [drafts, setDrafts] = useState<Record<number, Draft>>(fromLines);
  // Saved figures that changed underneath (this save, a reset, a colleague)
  // replace what the form holds; the "saved" message stays on screen.
  const savedKey = JSON.stringify(lines.map((l) => [l.productId, l.perCarton, l.cartonCbm, l.cartonKg]));
  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setDrafts(fromLines());
  }
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const changed = lines.filter((l) => {
    const d = drafts[l.productId];
    return d.perCarton !== asText(l.perCarton) || d.cartonCbm !== asText(l.cartonCbm) || d.cartonKg !== asText(l.cartonKg);
  });
  const invalid = changed.some((l) => {
    const d = drafts[l.productId];
    const per = toNumber(d.perCarton);
    const cbm = toNumber(d.cartonCbm);
    const kg = toNumber(d.cartonKg);
    return !Number.isInteger(per) || per < 1 || !Number.isFinite(cbm) || cbm < 0 || !Number.isFinite(kg) || kg < 0;
  });

  function run(payload: Parameters<typeof updateOrderPacking>[1]) {
    setMessage(null);
    startTransition(async () => {
      const result = await updateOrderPacking(orderId, payload);
      if (result.error) {
        setMessage({ kind: "error", text: t(result.error === "conflict" ? "packingConflict" : "packingFailed") });
        return;
      }
      setMessage({ kind: "ok", text: t("packingSaved") });
      router.refresh();
    });
  }

  function save() {
    run({
      version,
      lines: changed.map((l) => {
        const d = drafts[l.productId];
        return {
          productId: l.productId,
          perCarton: toNumber(d.perCarton),
          cartonCbm: toNumber(d.cartonCbm),
          cartonKg: toNumber(d.cartonKg),
        };
      }),
    });
  }

  const set = (productId: number, field: keyof Draft) => (value: string) =>
    setDrafts((prev) => ({ ...prev, [productId]: { ...prev[productId], [field]: value } }));

  return (
    <section className="mt-4 rounded-[12px] border border-line bg-surface p-4" data-testid="packing-card">
      <div className="mb-3 flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-ink">{t("packingTitle")}</h2>
        <p className="text-[11.5px] text-sub">{t("packingHelp")}</p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {lines.map((l) => {
          const d = drafts[l.productId];
          const per = toNumber(d.perCarton);
          const cartons = Number.isInteger(per) && per > 0 ? Math.ceil(l.quantity / per) : null;
          return (
            <li key={l.productId} className="flex flex-col gap-2 py-3 md:flex-row md:items-end md:gap-3" data-testid={`packing-line-${l.productId}`}>
              <div className="min-w-0 md:w-56">
                <p className="truncate text-[13px] font-semibold text-ink">{l.name}</p>
                {/* A div, not a p: the badge is a block, and a block inside a p
                    is split apart by the browser, which breaks hydration. */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-sub">
                  <span className="tabular-nums">{t("packingQty", { qty: l.quantity.toLocaleString("en-US") })}</span>
                  <Badge variant={l.confirmed ? "success" : "outline"} data-testid={`packing-state-${l.productId}`}>
                    {l.confirmed ? t("packingFactory") : t("packingQuoted")}
                  </Badge>
                </div>
              </div>
              <div className="grid flex-1 grid-cols-3 gap-2">
                <Field id={`per-${l.productId}`} label={t("packingPerCarton")} suffix={t("packingPcs")} value={d.perCarton} onChange={set(l.productId, "perCarton")} numeric="numeric" />
                <Field id={`cbm-${l.productId}`} label={t("packingCbm")} suffix="m³" value={d.cartonCbm} onChange={set(l.productId, "cartonCbm")} />
                <Field id={`kg-${l.productId}`} label={t("packingKg")} suffix="kg" value={d.cartonKg} onChange={set(l.productId, "cartonKg")} />
              </div>
              <div className="flex items-center justify-between gap-3 md:w-40 md:flex-col md:items-end md:justify-end">
                <span className="text-[12.5px] tabular-nums text-ink" data-testid={`packing-cartons-${l.productId}`}>
                  {cartons === null ? "—" : t("packingCartons", { count: cartons })}
                </span>
                {l.confirmed ? (
                  <button
                    type="button"
                    className="focus-ring rounded text-[11.5px] font-semibold text-sub hover:text-ink"
                    disabled={pending}
                    onClick={() => run({ version, lines: [{ productId: l.productId, reset: true }] })}
                    data-testid={`packing-reset-${l.productId}`}
                  >
                    {t("packingReset")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={pending || changed.length === 0 || invalid} data-testid="packing-save">
          {t("packingSave")}
        </Button>
        {invalid ? <span className="text-[12px] text-danger">{t("packingInvalid")}</span> : null}
        {message ? (
          <span role={message.kind === "ok" ? "status" : "alert"} className={`text-[12px] ${message.kind === "ok" ? "text-ok" : "text-danger"}`} data-testid="packing-message">
            {message.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function Field({
  id,
  label,
  suffix,
  value,
  onChange,
  numeric = "decimal",
}: {
  id: string;
  label: string;
  suffix: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: "numeric" | "decimal";
}) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-1 text-[11px] text-sub">
      {label}
      <Input id={id} type="text" numeric inputMode={numeric} suffix={suffix} value={value} onChange={(e) => onChange(e.target.value)} data-testid={id} />
    </label>
  );
}
