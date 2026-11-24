"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileUp, Sparkles } from "lucide-react";
import type { FinanceIntakeOrder } from "@/lib/queries/finance";
import { saveFinanceIntake } from "@/lib/actions/finance-intake";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const INTENTS = ["auto", "attach", "payment_in", "payment_out", "expense"] as const;
type Intent = (typeof INTENTS)[number];
type Extraction = {
  documentType: string;
  amount: number | null;
  currency: string;
  date: string;
  counterparty: string;
  reference: string;
  category: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};
type Analysis = { extraction: Extraction; suggestedIntent: Intent; fileSha256: string };
type Draft = {
  amount: string;
  currency: string;
  date: string;
  counterparty: string;
  reference: string;
  category: string;
  account: string;
  supplierId: string;
  note: string;
};

export function FinanceIntake({
  orders,
  aiConfigured,
}: {
  orders: FinanceIntakeOrder[];
  aiConfigured: boolean;
}) {
  const t = useTranslations("financeIntake");
  const financeT = useTranslations("finance");
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [orderId, setOrderId] = useState(orders[0]?.id ?? 0);
  const [intent, setIntent] = useState<Intent>("auto");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const order = orders.find((candidate) => candidate.id === orderId);
  const resolvedIntent = intent === "auto" ? analysis?.suggestedIntent ?? "attach" : intent;
  const needsMoney = resolvedIntent !== "attach";
  const set = (field: keyof Draft, value: string) => {
    setDraft((current) => current ? { ...current, [field]: value } : current);
    setSaved(false);
  };

  function resetAnalysis() {
    setAnalysis(null);
    setDraft(null);
    setError(null);
    setSaved(false);
  }

  async function analyze() {
    const file = fileRef.current?.files?.[0];
    setError(null);
    setSaved(false);
    if (!orderId || !file) {
      setError("required");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("size");
      return;
    }
    setPending(true);
    resetAnalysis();
    try {
      const body = new FormData();
      body.set("orderId", String(orderId));
      body.set("intent", intent);
      body.set("file", file, file.name);
      const response = await fetch("/api/finance/intake", { method: "POST", body });
      const data = await response.json() as Analysis & { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "read");
        return;
      }
      setAnalysis(data);
      const extraction = data.extraction;
      setDraft({
        amount: extraction.amount === null ? "" : String(extraction.amount),
        currency: extraction.currency || order?.currency || "CNY",
        date: extraction.date || new Date().toISOString().slice(0, 10),
        counterparty: extraction.counterparty,
        reference: extraction.reference,
        category: extraction.category || "other",
        account: extraction.currency === "USD" ? "USD" : "CNY",
        supplierId: order?.suppliers.length === 1 ? String(order.suppliers[0].id) : "",
        note: [extraction.counterparty, extraction.reference].filter(Boolean).join(" · "),
      });
    } catch {
      setError("network");
    } finally {
      setPending(false);
    }
  }

  function save() {
    const file = fileRef.current?.files?.[0];
    if (!file || !analysis || !draft || !order) return;
    const body = new FormData();
    body.set("orderId", String(order.id));
    body.set("intent", resolvedIntent);
    body.set("fileSha256", analysis.fileSha256);
    body.set("file", file, file.name);
    if (needsMoney) {
      body.set("amount", draft.amount);
      body.set("currency", draft.currency);
      body.set("date", draft.date);
      body.set("note", draft.note);
    }
    if (resolvedIntent === "expense") body.set("category", draft.category);
    if (resolvedIntent === "payment_out") body.set("supplierId", draft.supplierId);
    if (resolvedIntent === "payment_in" || resolvedIntent === "payment_out") body.set("account", draft.account);
    setError(null);
    startSave(async () => {
      const result = await saveFinanceIntake(undefined, body);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setAnalysis(null);
      setDraft(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  const validMoney = !needsMoney || (
    Number(draft?.amount) > 0 && draft?.currency && /^\d{4}-\d{2}-\d{2}$/.test(draft.date)
  );

  return (
    <section className="rounded-[12px] border border-line bg-surface p-4" data-testid="finance-intake">
      <div className="mb-3 flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-action" strokeWidth={1.5} />
        <div>
          <h2 className="text-sm font-semibold text-ink">{t("title")}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-sub">{t("help")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="intake-order">{t("order")}</Label>
          <select
            id="intake-order"
            value={orderId}
            disabled={pending || saving}
            onChange={(event) => {
              setOrderId(Number(event.target.value));
              resetAnalysis();
            }}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            data-testid="intake-order"
          >
            {orders.map((item) => (
              <option key={item.id} value={item.id}>{item.orderNumber} — {item.clientName}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="intake-intent">{t("intent")}</Label>
          <select
            id="intake-intent"
            value={intent}
            disabled={pending || saving}
            onChange={(event) => setIntent(event.target.value as Intent)}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            data-testid="intake-intent"
          >
            {INTENTS.map((value) => <option key={value} value={value}>{t(`intent_${value}`)}</option>)}
          </select>
        </div>
      </div>

      {order ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-sub" data-testid="intake-order-context">
          <Link href={`/orders/${order.id}`} className="font-medium text-action-chrome hover:underline">{order.orderNumber}</Link>
          <span>{order.clientName}</span>
          {order.suppliers.length > 0 ? <span>{t("suppliers", { names: order.suppliers.map((supplier) => supplier.name).join(", ") })}</span> : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.xlsx,.xls,.docx,image/png,image/jpeg,image/webp"
          disabled={pending || saving || !aiConfigured}
          onChange={resetAnalysis}
          className="max-w-full text-xs text-sub file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-2 file:py-1.5 file:text-xs file:text-ink"
          data-testid="intake-file"
        />
        <Button type="button" size="sm" disabled={pending || saving || !aiConfigured || !orderId} onClick={analyze} data-testid="intake-analyze">
          <FileUp className="h-4 w-4" strokeWidth={1.5} />
          {pending ? t("reading") : t("analyze")}
        </Button>
      </div>
      {!aiConfigured ? <p className="mt-2 text-xs text-warn">{t("notConfigured")}</p> : null}
      {error ? <p role="alert" className="mt-2 text-xs text-danger" data-testid="intake-error">{t(`error_${error}` as "error_invalid", { mb: 25 })}</p> : null}

      {analysis && draft ? (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3" data-testid="intake-review">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-ink">
              {t("review")} · {t(`type_${analysis.extraction.documentType}`)}
            </div>
            <span className="text-[11px] text-sub">{t(`confidence_${analysis.extraction.confidence}`)}</span>
          </div>
          {analysis.extraction.reason ? <p className="mb-3 text-[11px] leading-relaxed text-sub">{analysis.extraction.reason}</p> : null}
          <p className="mb-3 text-xs font-medium text-action-chrome">{t(`action_${resolvedIntent}`)}</p>

          {needsMoney ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="intake-amount">{financeT("amount")}</Label>
                <Input id="intake-amount" type="number" min="0.01" step="0.01" value={draft.amount} onChange={(event) => set("amount", event.target.value)} data-testid="intake-amount" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="intake-currency">{financeT("currency")}</Label>
                <Input id="intake-currency" value={draft.currency} maxLength={8} onChange={(event) => set("currency", event.target.value)} data-testid="intake-currency" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="intake-date">{financeT("date")}</Label>
                <Input id="intake-date" type="date" value={draft.date} onChange={(event) => set("date", event.target.value)} data-testid="intake-date" />
              </div>
              {resolvedIntent === "payment_out" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="intake-supplier">{financeT("supplier")}</Label>
                  <select id="intake-supplier" value={draft.supplierId} onChange={(event) => set("supplierId", event.target.value)} className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" data-testid="intake-supplier">
                    <option value="">{t("supplierUnassigned")}</option>
                    {order?.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </div>
              ) : null}
              {resolvedIntent === "expense" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="intake-category">{financeT("category")}</Label>
                  <select id="intake-category" value={draft.category} onChange={(event) => set("category", event.target.value)} className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" data-testid="intake-category">
                    {["freight", "customs", "inspection", "local_transport", "bank_fees", "other"].map((category) => (
                      <option key={category} value={category}>{financeT(`category_${category}` as "category_other")}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              {resolvedIntent === "payment_in" || resolvedIntent === "payment_out" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="intake-account">{financeT("account")}</Label>
                  <select id="intake-account" value={draft.account} onChange={(event) => set("account", event.target.value)} className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" data-testid="intake-account">
                    <option value="CNY">{financeT("accountRmb")}</option>
                    <option value="USD">{financeT("accountUsd")}</option>
                    <option value="">{financeT("accountOther")}</option>
                  </select>
                </div>
              ) : null}
              <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
                <Label htmlFor="intake-note">{financeT("note")}</Label>
                <Input id="intake-note" value={draft.note} maxLength={1000} onChange={(event) => set("note", event.target.value)} data-testid="intake-note" />
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-3">
            <Button type="button" size="sm" disabled={saving || !validMoney} onClick={save} data-testid="intake-save">
              {saving ? t("saving") : t(`confirm_${resolvedIntent}`)}
            </Button>
            {saved ? <span role="status" className="text-xs text-ok" data-testid="intake-saved">{t("saved")}</span> : null}
          </div>
        </div>
      ) : null}
      {saved && !analysis ? <p role="status" className="mt-3 text-xs text-ok" data-testid="intake-saved">{t("saved")}</p> : null}
    </section>
  );
}
