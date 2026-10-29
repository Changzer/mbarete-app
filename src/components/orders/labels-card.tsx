"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Tag } from "lucide-react";
import { updateLabelDetails } from "@/lib/actions/dossier";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type LabelDetails = {
  version: number;
  shippingMarks: string;
  labelWarehouse: string;
  /** "" = the client's own details. */
  labelConsignee: string;
  labelCustomsStamp: boolean;
};

/**
 * What the carton labels carry besides the product, in one place: the title
 * lines (the shipping marks the forwarder asks for, also on the customs
 * pack), where the goods are delivered in China — the forwarder's warehouse
 * — and the final destination, which starts as the client's own details.
 * The labels download from here too.
 */
export function LabelsCard({
  orderId,
  details,
  clientConsignee,
  lastWarehouse,
  canDownload,
}: {
  orderId: number;
  details: LabelDetails;
  /** The client's name, address and country, as the destination prints when none is typed. */
  clientConsignee: string;
  /** The warehouse the company's most recent other order was delivered to. */
  lastWarehouse: string;
  /** Labels exist for confirmed and shipped orders. */
  canDownload: boolean;
}) {
  const t = useTranslations("orders");
  const router = useRouter();
  const start = {
    shippingMarks: details.shippingMarks,
    labelWarehouse: details.labelWarehouse,
    labelConsignee: details.labelConsignee || clientConsignee,
    labelCustomsStamp: details.labelCustomsStamp,
  };
  const [form, setForm] = useState(start);
  // Saved label details that changed underneath (this save, a colleague's, a
  // new destination country that changes the client's default) replace what
  // the form holds; a save elsewhere on the order leaves typing alone.
  const savedKey = JSON.stringify(start);
  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setForm(start);
  }
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = (Object.keys(start) as (keyof typeof start)[]).some((k) => form[k] !== start[k]);
  const set = <K extends keyof typeof start>(key: K) => (value: (typeof start)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setMessage(null);
  };

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateLabelDetails(orderId, {
        version: details.version,
        ...form,
        // Left as the client's own details, it keeps following the client.
        labelConsignee: form.labelConsignee.trim() === clientConsignee.trim() ? "" : form.labelConsignee,
      });
      if (result.error) {
        setMessage({ kind: "error", text: t(result.error === "conflict" ? "labelsConflict" : "labelsFailed") });
        return;
      }
      setMessage({ kind: "ok", text: t("labelsSaved") });
      router.refresh();
    });
  }

  return (
    <section className="mt-4 rounded-[12px] border border-line bg-surface p-4" data-testid="labels-card">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-ink">{t("labelsTitle")}</h2>
          <p className="text-[11.5px] text-sub">{t("labelsHelp")}</p>
        </div>
        {canDownload ? (
          <Button asChild variant="outline" size="sm">
            <a href={`/api/orders/${orderId}/export?format=pdf&doc=labels`} data-testid="labels-download">
              <Tag className="h-4 w-4" strokeWidth={1.5} />
              {t("labelsDownload")}
            </a>
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shippingMarks">{t("labelsMarks")}</Label>
          <Textarea
            id="shippingMarks"
            rows={5}
            value={form.shippingMarks}
            placeholder={"BLG-123\nORD-20260907-755343\nPARAGUAY"}
            onChange={(e) => set("shippingMarks")(e.target.value)}
            className="font-mono text-[12.5px]"
            data-testid="shippingMarks"
          />
          <span className="text-[11px] text-sub">{t("labelsMarksHelp")}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="labelWarehouse">{t("labelsWarehouse")}</Label>
          <Textarea
            id="labelWarehouse"
            rows={5}
            value={form.labelWarehouse}
            placeholder={t("labelsWarehousePlaceholder")}
            onChange={(e) => set("labelWarehouse")(e.target.value)}
            className="text-[12.5px]"
            data-testid="labelWarehouse"
          />
          <span className="text-[11px] text-sub">{t("labelsWarehouseHelp")}</span>
          {lastWarehouse && !form.labelWarehouse.trim() ? (
            <button
              type="button"
              className="focus-ring w-fit rounded text-left text-[12px] font-semibold text-action-chrome hover:underline"
              onClick={() => set("labelWarehouse")(lastWarehouse)}
              data-testid="labelWarehouse-last"
            >
              {t("labelsUseLast", { first: lastWarehouse.split("\n")[0] })}
            </button>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="labelConsignee">{t("labelsConsignee")}</Label>
          <Textarea
            id="labelConsignee"
            rows={5}
            value={form.labelConsignee}
            placeholder={t("labelsConsigneePlaceholder")}
            onChange={(e) => set("labelConsignee")(e.target.value)}
            className="text-[12.5px]"
            data-testid="labelConsignee"
          />
          <span className="text-[11px] text-sub">{t("labelsConsigneeHelp")}</span>
        </div>
      </div>

      <label className="mt-3 flex min-h-11 items-center gap-2.5 text-[13px] text-ink">
        <input
          type="checkbox"
          checked={form.labelCustomsStamp}
          onChange={(e) => set("labelCustomsStamp")(e.target.checked)}
          className="h-5 w-5 accent-[var(--mb-action)]"
          data-testid="labelCustomsStamp"
        />
        <span>
          {t("labelsStamp")} <span className="text-[11.5px] text-sub">{t("labelsStampHelp")}</span>
        </span>
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={pending || !dirty} data-testid="labels-save">
          {t("labelsSave")}
        </Button>
        {message ? (
          <span role={message.kind === "ok" ? "status" : "alert"} className={`text-[12px] ${message.kind === "ok" ? "text-ok" : "text-danger"}`} data-testid="labels-message">
            {message.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}
