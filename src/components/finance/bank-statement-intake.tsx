"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileUp } from "lucide-react";
import type { FinanceIntakeOrder } from "@/lib/queries/finance";
import type { OperatingCashInput } from "@/lib/operating-cash";
import { BANK_STATEMENT_KINDS, ORDER_EXPENSE_CATEGORIES, OPERATING_EXPENSE_CATEGORIES } from "@/lib/bank-statement-shared";
import { confirmBankStatementImport, discardStatementDocuments } from "@/lib/actions/bank-statements";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_FILES = 10;
const MAX_BATCH_BYTES = 35 * 1024 * 1024;
const inputClass = "h-8 w-full rounded-md border border-line bg-surface px-1.5 text-xs text-ink";

type DraftRow = {
  id: string;
  documentId: number;
  statementRow: string;
  date: string;
  description: string;
  counterparty: string;
  reference: string;
  amount: string;
  kind: (typeof BANK_STATEMENT_KINDS)[number];
  orderId: number | null;
  supplierId: number | null;
  expenseCategory: string;
  destinationAccountId: number | null;
  destinationAmount: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  duplicate: boolean;
  selected: boolean;
};

type DocumentDraft = {
  documentId?: number;
  fileName: string;
  path?: string;
  error?: string;
  closingBalance: string;
  closingDate: string;
  includeBalance: boolean;
  linked: boolean;
  rows: DraftRow[];
};

export function BankStatementIntake({ accounts, orders, aiConfigured }: { accounts: OperatingCashInput["accounts"]; orders: FinanceIntakeOrder[]; aiConfigured: boolean }) {
  const t = useTranslations("bankIntake");
  const financeT = useTranslations("finance");
  const router = useRouter();
  const filesRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 0);
  const [documents, setDocuments] = useState<DocumentDraft[]>([]);
  const [pending, setPending] = useState(false);
  const [saving, startSave] = useTransition();
  const [discarding, startDiscard] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const account = accounts.find((candidate) => candidate.id === accountId);

  const validRow = (row: DraftRow) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !(Number(row.amount) > 0) || row.kind === "unknown") return false;
    if (["client_payment", "supplier_payment", "order_expense"].includes(row.kind) && row.orderId === null) return false;
    if (row.kind === "order_expense" || row.kind === "operating_expense") return Boolean(row.expenseCategory);
    if (row.kind === "exchange") return row.destinationAccountId !== null && Number(row.destinationAmount) > 0;
    return true;
  };

  const updateRow = (rowId: string, patch: Partial<DraftRow>) => {
    setSaved(0);
    setDocuments((current) => current.map((document) => ({ ...document, rows: document.rows.map((row) => row.id === rowId ? { ...row, ...patch } : row) })));
  };

  async function analyze() {
    const files = [...(filesRef.current?.files ?? [])];
    setError("");
    setSaved(0);
    if (!account || files.length === 0 || files.length > MAX_FILES || files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) {
      setError("required");
      return;
    }
    setPending(true);
    setDocuments([]);
    try {
      const body = new FormData();
      body.set("accountId", String(accountId));
      for (const file of files) body.append("files", file, file.name);
      const response = await fetch("/api/finance/bank-statements", { method: "POST", body });
      const data = await response.json() as { ok?: boolean; error?: string; results?: {
        documentId?: number;
        fileName: string;
        path?: string;
        error?: string;
        closingBalance?: number | null;
        closingDate?: string;
        transactions?: (Omit<DraftRow, "amount" | "destinationAmount" | "selected"> & { amount: number | null; destinationAmount: number | null })[];
      }[] };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "read");
        return;
      }
      setDocuments((data.results ?? []).map((document) => ({
        documentId: document.documentId,
        fileName: document.fileName,
        path: document.path,
        error: document.error,
        closingBalance: document.closingBalance === null || document.closingBalance === undefined ? "" : String(document.closingBalance),
        closingDate: document.closingDate ?? "",
        includeBalance: false,
        linked: false,
        rows: (document.transactions ?? []).map((row) => ({
          ...row,
          amount: row.amount === null ? "" : String(row.amount),
          destinationAccountId: row.destinationAccountId ?? accounts.find((candidate) => candidate.id !== accountId)?.id ?? null,
          destinationAmount: row.destinationAmount === null ? "" : String(row.destinationAmount),
          selected: false,
        })),
      })));
    } catch {
      setError("network");
    } finally {
      setPending(false);
    }
  }

  function confirm() {
    const selected = documents.flatMap((document) => document.rows.filter((row) => row.selected));
    setError("");
    setSaved(0);
    if (selected.length === 0) {
      setError("select");
      return;
    }
    if (selected.some((row) => row.duplicate || !validRow(row))) {
      setError("invalid");
      return;
    }
    startSave(async () => {
      const result = await confirmBankStatementImport({
        accountId,
        rows: selected.map((row) => ({
          documentId: row.documentId,
          statementRow: row.statementRow,
          kind: row.kind,
          date: row.date,
          description: row.description,
          counterparty: row.counterparty,
          reference: row.reference,
          amount: Number(row.amount),
          orderId: row.orderId,
          supplierId: row.supplierId,
          expenseCategory: row.expenseCategory,
          destinationAccountId: row.kind === "exchange" ? row.destinationAccountId : null,
          destinationAmount: row.kind === "exchange" ? Number(row.destinationAmount) : null,
        })),
        balanceChecks: documents.flatMap((document) => document.documentId && document.includeBalance && document.closingBalance && document.closingDate ? [{ documentId: document.documentId, amount: Number(document.closingBalance), date: document.closingDate, enabled: true }] : []),
      });
      if (result.error) {
        setError(result.error);
        if (result.rowIds) {
          const ids = new Set(result.rowIds);
          setDocuments((current) => current.map((document) => ({ ...document, rows: document.rows.map((row) => ids.has(`${row.documentId}:${row.statementRow}`) ? { ...row, duplicate: true, selected: false } : row) })));
        }
        return;
      }
      const confirmed = new Set(selected.map((row) => row.id));
      const linkedDocuments = new Set(selected.map((row) => row.documentId));
      setSaved(result.saved ?? selected.length);
      setDocuments((current) => current.flatMap((document) => {
        const rows = document.rows.filter((row) => !confirmed.has(row.id));
        if (rows.length === 0) return [];
        return [{ ...document, linked: document.linked || (document.documentId !== undefined && linkedDocuments.has(document.documentId)), includeBalance: false, rows }];
      }));
      router.refresh();
    });
  }

  const discardable = documents.filter((document) => !document.linked && document.documentId).map((document) => document.documentId!);

  return (
    <div data-testid="bank-intake">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="bank-intake-account">{t("account")}</Label>
          <select id="bank-intake-account" value={accountId} disabled={pending || saving} onChange={(event) => { setAccountId(Number(event.target.value)); setDocuments([]); }} className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" data-testid="bank-account">
            {accounts.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.currency}</option>)}
          </select>
        </div>
        <div className="flex items-end text-xs text-sub">{t("accountLocked", { currency: account?.currency ?? "" })}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={filesRef} type="file" multiple accept=".pdf,.xlsx,.xls,.docx,image/png,image/jpeg,image/webp" disabled={pending || saving || !aiConfigured || !account} onChange={() => setDocuments([])} className="max-w-full text-xs text-sub file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-2 file:py-1.5 file:text-xs file:text-ink" data-testid="bank-files" />
        <Button type="button" size="sm" disabled={pending || saving || !aiConfigured || !account} onClick={analyze} data-testid="bank-analyze"><FileUp className="h-4 w-4" />{pending ? t("reading") : t("analyze")}</Button>
      </div>
      <p className="mt-2 text-[11px] text-sub">{t("batchHelp", { count: MAX_FILES, mb: 35 })}</p>
      {!aiConfigured ? <p className="mt-2 text-xs text-warn">{t("notConfigured")}</p> : null}
      {error ? <p role="alert" className="mt-2 text-xs text-danger" data-testid="bank-error">{t(`error_${error}` as "error_invalid")}</p> : null}
      {saved > 0 ? <p role="status" className="mt-2 text-xs text-ok" data-testid="bank-saved">{t("saved", { count: saved })}</p> : null}

      {documents.length > 0 ? (
        <div className="mt-4 flex flex-col gap-4" data-testid="bank-review">
          {documents.map((document) => (
            <section key={`${document.documentId}-${document.fileName}`} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-ink">{document.fileName}</span>
                {document.path ? <a href={document.path} target="_blank" rel="noreferrer" className="text-action-chrome hover:underline">{t("source")}</a> : null}
                {document.error ? <span className="text-danger">{t(`error_${document.error}` as "error_read")}</span> : null}
              </div>
              {document.rows.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  {document.rows.map((row) => {
                    const order = orders.find((candidate) => candidate.id === row.orderId);
                    return (
                      <div key={row.id} className={`rounded-md border p-2 ${row.duplicate ? "border-warn bg-warn-soft" : "border-line bg-surface"}`} data-testid={`bank-row-${row.id}`}>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                          <label className="flex items-center gap-2 text-xs text-sub"><input type="checkbox" checked={row.selected} disabled={row.duplicate} onChange={(event) => updateRow(row.id, { selected: event.target.checked })} data-testid={`bank-select-${row.id}`} />{t("include")}</label>
                          <Input aria-label={financeT("date")} type="date" value={row.date} onChange={(event) => updateRow(row.id, { date: event.target.value })} data-testid={`bank-date-${row.id}`} />
                          <Input aria-label={t("description")} value={row.description} onChange={(event) => updateRow(row.id, { description: event.target.value })} data-testid={`bank-description-${row.id}`} />
                          <Input aria-label={t("counterparty")} value={row.counterparty} onChange={(event) => updateRow(row.id, { counterparty: event.target.value })} />
                          <Input aria-label={financeT("amount")} type="number" min="0.01" step="0.01" value={row.amount} onChange={(event) => updateRow(row.id, { amount: event.target.value })} data-testid={`bank-amount-${row.id}`} />
                          <span className="flex items-center text-xs text-sub">{account?.currency}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-5">
                          <select aria-label={t("kind")} value={row.kind} onChange={(event) => updateRow(row.id, { kind: event.target.value as DraftRow["kind"], expenseCategory: "other" })} className={inputClass} data-testid={`bank-kind-${row.id}`}>
                            {BANK_STATEMENT_KINDS.map((kind) => <option key={kind} value={kind}>{t(`kind_${kind}`)}</option>)}
                          </select>
                          {["client_payment", "supplier_payment", "order_expense"].includes(row.kind) ? (
                            <select aria-label={t("order")} value={row.orderId ?? ""} onChange={(event) => updateRow(row.id, { orderId: event.target.value ? Number(event.target.value) : null, supplierId: null })} className={inputClass} data-testid={`bank-order-${row.id}`}>
                              <option value="">{t("orderUnassigned")}</option>
                              {orders.map((item) => <option key={item.id} value={item.id}>{item.orderNumber} — {item.clientName}</option>)}
                            </select>
                          ) : <Input aria-label={t("reference")} value={row.reference} onChange={(event) => updateRow(row.id, { reference: event.target.value })} />}
                          {row.kind === "supplier_payment" ? (
                            <select aria-label={financeT("supplier")} value={row.supplierId ?? ""} onChange={(event) => updateRow(row.id, { supplierId: event.target.value ? Number(event.target.value) : null })} className={inputClass} data-testid={`bank-supplier-${row.id}`}>
                              <option value="">{t("supplierUnassigned")}</option>
                              {order?.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                            </select>
                          ) : null}
                          {row.kind === "order_expense" || row.kind === "operating_expense" ? (
                            <select aria-label={financeT("category")} value={row.expenseCategory} onChange={(event) => updateRow(row.id, { expenseCategory: event.target.value })} className={inputClass}>
                              {(row.kind === "order_expense" ? ORDER_EXPENSE_CATEGORIES : OPERATING_EXPENSE_CATEGORIES).map((category) => <option key={category} value={category}>{category}</option>)}
                            </select>
                          ) : null}
                          {row.kind === "exchange" ? <Input aria-label={t("destinationAmount")} type="number" min="0.01" step="0.01" value={row.destinationAmount} onChange={(event) => updateRow(row.id, { destinationAmount: event.target.value })} /> : null}
                          <span className={`text-[11px] ${row.duplicate ? "text-warn" : "text-sub"}`}>{row.duplicate ? t("duplicate") : `${t(`confidence_${row.confidence}`)}${row.reason ? ` · ${row.reason}` : ""}`}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {document.documentId && document.closingBalance && document.closingDate ? (
                <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-sub">
                  <input type="checkbox" checked={document.includeBalance} onChange={(event) => setDocuments((current) => current.map((item) => item.documentId === document.documentId ? { ...item, includeBalance: event.target.checked } : item))} data-testid={`bank-balance-${document.documentId}`} />
                  {t("includeBalance")}
                  <Input type="number" step="0.01" value={document.closingBalance} onChange={(event) => setDocuments((current) => current.map((item) => item.documentId === document.documentId ? { ...item, closingBalance: event.target.value } : item))} className="w-32" />
                  <Input type="date" value={document.closingDate} onChange={(event) => setDocuments((current) => current.map((item) => item.documentId === document.documentId ? { ...item, closingDate: event.target.value } : item))} className="w-36" />
                  {account?.currency}
                </label>
              ) : null}
            </section>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={confirm} disabled={saving || discarding} data-testid="bank-confirm">{saving ? t("saving") : t("confirm")}</Button>
            <Button type="button" size="sm" variant="outline" disabled={saving || discarding || documents.every((document) => document.rows.every((row) => row.duplicate || !validRow(row)))} onClick={() => setDocuments((current) => current.map((document) => ({ ...document, rows: document.rows.map((row) => row.duplicate || !validRow(row) ? row : { ...row, selected: true }) })))}>{t("selectAll")}</Button>
            {discardable.length > 0 ? <Button type="button" size="sm" variant="outline" disabled={saving || discarding} onClick={() => startDiscard(async () => { const result = await discardStatementDocuments(discardable); if (result.error) setError(result.error); else setDocuments((current) => current.filter((document) => !discardable.includes(document.documentId!))); })} data-testid="bank-discard">{t("discard")}</Button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
