"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useIsAdmin } from "@/components/role-provider";
import {
  addPayment,
  assignPaymentSupplier,
  deletePayment,
  addExpense,
  deleteExpense,
  uploadOrderDocument,
  deleteOrderDocument,
  type FinanceActionResult,
} from "@/lib/actions/finance";
import { SupplierPaymentBalances } from "@/components/orders/supplier-payment-balances";
import { OrderSection } from "@/components/orders/order-section";
import type { SupplierBalance } from "@/lib/supplier-balances";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { Paperclip } from "lucide-react";
import { calculateConversion } from "@/lib/conversion";

export type SupplierOption = { id: number; name: string };
export type CashAccountOption = { id: number; label: string; currency: string };

export type PaymentRow = {
  id: number;
  direction: "in" | "out";
  supplierId: number | null;
  amount: number;
  currency: string;
  paidOn: string;
  account: string;
  channel: "bank" | "xtransfer";
  settlementAmount: number | null;
  settlementCurrency: string;
  settlementAccountId: number | null;
  effectiveRate: number | null;
  conversionCost: number | null;
  inboundReceiptPath: string;
  inboundReceiptName: string;
  outboundReceiptPath: string;
  outboundReceiptName: string;
  receiptPath: string;
  receiptName: string;
  note: string;
};

export type ExpenseRow = {
  id: number;
  category: string;
  amount: number;
  currency: string;
  spentOn: string;
  receiptPath: string;
  receiptName: string;
  note: string;
};

export type DocumentRow = {
  id: number;
  kind: string;
  path: string;
  originalName: string;
  sizeBytes: number;
};

const EXPENSE_CATEGORIES = [
  "freight",
  "customs",
  "inspection",
  "local_transport",
  "bank_fees",
  "other",
] as const;

const DOCUMENT_KINDS = [
  "supplier_invoice",
  "packing_list",
  "bill_of_lading",
  "inspection",
  "other",
] as const;

const today = () => new Date().toISOString().slice(0, 10);

function prettyBytes(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function money(n: number) {
  return n.toFixed(2);
}

/** Maps an action's error code to the sentence shown under the form. */
function useErrorText() {
  const t = useTranslations("finance");
  return (code: string | undefined) => {
    switch (code) {
      case "receiptType":
        return t("badReceipt");
      case "receiptSize":
      case "size":
        return t("fileTooLarge");
      case "file":
        return t("badFile");
      case "storageFull":
        return t("storageFull");
      case "invalidSupplier":
        return t("invalidSupplier");
      case "settlementRequired":
        return t("settlementRequired");
      case "invalidSettlementAccount":
        return t("invalidSettlementAccount");
      case "accountCurrency":
        return t("accountCurrency");
      case "missingDocuments":
        return t("missingDocuments");
      default:
        return t("invalid");
    }
  };
}

/**
 * A file field drawn as a real button.
 *
 * The native control's label comes from the browser's own language
 * ("Escolher ficheiro…" on a Portuguese browser) and does not look
 * clickable in this design. The input stays in the form — visually hidden,
 * not display:none, so `required` validation can still focus it — and the
 * button next to it opens the picker. The chosen filename echoes beside the
 * button and clears when the form resets after a successful submit.
 */
function FileButton({
  name,
  accept,
  required,
  testid,
}: {
  name: string;
  accept: string;
  required?: boolean;
  testid?: string;
}) {
  const common = useTranslations("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => setFileName("");
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        name={name}
        type="file"
        accept={accept}
        required={required}
        className="sr-only"
        data-testid={testid}
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="h-4 w-4" />
        {common("selectFile")}
      </Button>
      <span
        className="max-w-44 truncate text-xs text-sub"
        title={fileName || undefined}
      >
        {fileName || common("noFileSelected")}
      </span>
    </div>
  );
}

/**
 * The slip field on payments and expenses. `image/*` keeps the phone's
 * "take photo" option available — the whole point is snapping the bank
 * receipt right when the money moves.
 */
function ReceiptField({ testid }: { testid: string }) {
  const t = useTranslations("finance");
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <Label className="text-xs">{t("receipt")}</Label>
      <FileButton name="receipt" accept="image/*,.pdf" testid={testid} />
    </div>
  );
}

/** The link a recorded slip renders as, opening in its own tab. */
function ReceiptLink({ path, name, label }: { path: string; name: string; label?: string }) {
  const t = useTranslations("finance");
  return (
    <a
      href={path}
      target="_blank"
      rel="noreferrer"
      title={name}
      className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
    >
      <Paperclip className="h-3.5 w-3.5" />
      {label ?? t("viewReceipt")}
    </a>
  );
}

// --- payments ---------------------------------------------------------------

function PaymentForm({
  orderId,
  direction,
  defaultCurrency,
  suppliers,
  cashAccounts,
  rates,
}: {
  orderId: number;
  direction: "in" | "out";
  defaultCurrency: string;
  suppliers: SupplierOption[];
  cashAccounts: CashAccountOption[];
  rates: Record<string, number>;
}) {
  const t = useTranslations("finance");
  const errorText = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);

  async function action(prev: FinanceActionResult | undefined, formData: FormData) {
    const result = await addPayment(orderId, prev, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }
  const [result, formAction, isPending] = useActionState(action, undefined);
  const [channel, setChannel] = useState<"bank" | "xtransfer">("bank");
  const [amount, setAmount] = useState("");
  const [sourceCurrency, setSourceCurrency] = useState(defaultCurrency);
  const [settlementAmount, setSettlementAmount] = useState("");
  const [settlementCurrency, setSettlementCurrency] = useState("CNY");
  const [settlementAccountId, setSettlementAccountId] = useState(String(cashAccounts[0]?.id ?? ""));
  const [cashAccountId, setCashAccountId] = useState(String(cashAccounts.find((account) => account.currency === defaultCurrency)?.id ?? ""));
  let conversion: ReturnType<typeof calculateConversion> | null = null;
  if (channel === "xtransfer" && Number(amount) > 0 && Number(settlementAmount) > 0) {
    try {
      conversion = calculateConversion({
        sourceAmount: Number(amount),
        sourceCurrency,
        settlementAmount: Number(settlementAmount),
        settlementCurrency,
        rates,
      });
    } catch {
      conversion = null;
    }
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-wrap items-end gap-2"
      data-testid={`payment-form-${direction}`}
    >
      <input type="hidden" name="direction" value={direction} />
      {direction === "in" ? (
        <div className="flex min-w-40 flex-col gap-1">
          <Label className="text-xs">{t("channel")}</Label>
          <select
            name="channel"
            value={channel}
            onChange={(event) => setChannel(event.target.value as "bank" | "xtransfer")}
            className="flex h-9 rounded-md border border-line bg-surface px-2 text-sm"
            data-testid="payment-channel"
          >
            <option value="bank">{t("channelBank")}</option>
            <option value="xtransfer">{t("channelXtransfer")}</option>
          </select>
        </div>
      ) : <input type="hidden" name="channel" value="bank" />}
      {direction === "out" && suppliers.length > 0 ? (
        <div className="flex min-w-48 flex-col gap-1">
          <Label className="text-xs">{t("supplier")}</Label>
          <select
            name="supplierId"
            required
            defaultValue={suppliers.length === 1 ? String(suppliers[0].id) : ""}
            className="flex h-9 rounded-md border border-line bg-surface px-2 text-sm"
            data-testid="payment-supplier"
          >
            <option value="" disabled>{t("selectSupplier")}</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{t("amount")}</Label>
        <Input
          name="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          required
          className="w-32"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          data-testid="payment-amount"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{t("currency")}</Label>
        <Input
          name="currency"
          value={sourceCurrency}
          onChange={(event) => {
            setSourceCurrency(event.target.value);
            setCashAccountId(String(cashAccounts.find((account) => account.currency === event.target.value)?.id ?? ""));
          }}
          required
          className="w-20"
          data-testid="payment-currency"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{t("date")}</Label>
        <Input name="paidOn" type="date" defaultValue={today()} required className="w-36" />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{t("account")}</Label>
        <select
          name="account"
          defaultValue={defaultCurrency === "USD" ? "USD" : "CNY"}
          className="flex h-9 rounded-md border border-line bg-surface px-2 text-sm"
          data-testid={`account-${direction}`}
        >
          <option value="CNY">{t("accountRmb")}</option>
          <option value="USD">{t("accountUsd")}</option>
          <option value="">{t("accountOther")}</option>
        </select>
      </div>
      {channel === "bank" ? (
        <div className="flex min-w-48 flex-col gap-1">
          <Label className="text-xs">{t("cashAccount")}</Label>
          <select
            name="cashAccountId"
            value={cashAccountId}
            onChange={(event) => setCashAccountId(event.target.value)}
            className="flex h-9 rounded-md border border-line bg-surface px-2 text-sm"
            data-testid={`cash-account-${direction}`}
          >
            <option value="">{t("cashAccountUnassigned")}</option>
            {cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.currency}</option>)}
          </select>
        </div>
      ) : null}
      <div className="flex min-w-32 flex-1 flex-col gap-1">
        <Label className="text-xs">{t("note")}</Label>
        <Input name="note" placeholder={t("notePlaceholder")} />
      </div>
      {channel === "xtransfer" ? (
        <>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("settlementAmount")}</Label>
            <Input
              name="settlementAmount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              required
              className="w-32"
              value={settlementAmount}
              onChange={(event) => setSettlementAmount(event.target.value)}
              data-testid="settlement-amount"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t("settlementCurrency")}</Label>
            <Input name="settlementCurrency" value={settlementCurrency} onChange={(event) => setSettlementCurrency(event.target.value)} maxLength={8} required className="w-20" data-testid="settlement-currency" />
          </div>
          <div className="flex min-w-48 flex-col gap-1">
            <Label className="text-xs">{t("settlementAccount")}</Label>
            <select
              name="settlementAccountId"
              required
              value={settlementAccountId}
              onChange={(event) => {
                setSettlementAccountId(event.target.value);
                const account = cashAccounts.find((candidate) => candidate.id === Number(event.target.value));
                if (account) setSettlementCurrency(account.currency);
              }}
              className="flex h-9 rounded-md border border-line bg-surface px-2 text-sm"
              data-testid="settlement-account"
            >
              {cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.currency}</option>)}
            </select>
          </div>
          <FileButton name="inboundReceipt" accept="image/*,.pdf" required testid="inbound-receipt" />
          <FileButton name="outboundReceipt" accept="image/*,.pdf" required testid="outbound-receipt" />
          {conversion ? (
            <div className="w-full rounded-md bg-surface-2 px-3 py-2 text-[11px] text-sub" data-testid="conversion-preview">
              {t("effectiveRate", { rate: conversion.effectiveRate.toFixed(4), currency: settlementCurrency })}
              <span className="ml-2">{t("impliedCost", { amount: conversion.conversionCost.toFixed(2), currency: settlementCurrency })}</span>
            </div>
          ) : null}
        </>
      ) : <ReceiptField testid={`receipt-${direction}`} />}
      <Button type="submit" size="sm" disabled={isPending}>
        {t("add")}
      </Button>
      {result?.error ? (
        <p className="w-full text-xs text-danger">{errorText(result.error)}</p>
      ) : null}
    </form>
  );
}

function PaymentList({
  orderId,
  rows,
  suppliers,
}: {
  orderId: number;
  rows: PaymentRow[];
  suppliers: SupplierOption[];
}) {
  const isAdmin = useIsAdmin();
  const t = useTranslations("finance");
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) {
    return <p className="text-xs text-sub">{t("none")}</p>;
  }
  return (
    <>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((p) => {
          const supplier = p.supplierId === null ? undefined : suppliers.find((s) => s.id === p.supplierId);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
              <span className="w-24 shrink-0 text-sub">{p.paidOn}</span>
              <span className="font-medium text-ink">
                {money(p.amount)} {p.currency}
              </span>
              {p.direction === "out" && supplier ? (
                <span className="max-w-40 truncate rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-sub">
                  {supplier.name}
                </span>
              ) : null}
              {p.direction === "out" && p.supplierId === null && suppliers.length > 0 ? (
                <select
                  value=""
                  disabled={pending === p.id}
                  aria-label={t("assignSupplier")}
                  data-testid={`payment-assign-${p.id}`}
                  onChange={async (event) => {
                    setError(null);
                    setPending(p.id);
                    const result = await assignPaymentSupplier(orderId, p.id, Number(event.target.value));
                    if (result.error) setError(result.error);
                    else router.refresh();
                    setPending(null);
                  }}
                  className="max-w-40 rounded-md border border-warn bg-surface px-1 py-1 text-[11px] text-warn"
                >
                  <option value="" disabled>{t("assignSupplier")}</option>
                  {suppliers.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              ) : null}
              {p.account ? (
                <span className="max-w-40 shrink-0 truncate rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-sub">
                  {p.account}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-sub">{p.note}</span>
              {p.settlementAmount !== null ? (
                <span className="text-[11px] text-sub" data-testid={`settlement-${p.id}`}>
                  → {money(p.settlementAmount)} {p.settlementCurrency}
                  {p.effectiveRate !== null ? ` · ${p.effectiveRate.toFixed(4)} ${p.settlementCurrency}/${p.currency}` : ""}
                  {p.conversionCost !== null && Math.abs(p.conversionCost) > 0.005 ? ` · ${t("impliedCostShort", { amount: p.conversionCost.toFixed(2), currency: p.settlementCurrency })}` : ""}
                </span>
              ) : null}
              {p.inboundReceiptPath ? <ReceiptLink path={p.inboundReceiptPath} name={p.inboundReceiptName} label={t("inboundSlip")} /> : null}
              {p.outboundReceiptPath ? <ReceiptLink path={p.outboundReceiptPath} name={p.outboundReceiptName} label={t("outboundSlip")} /> : null}
              {p.receiptPath ? <ReceiptLink path={p.receiptPath} name={p.receiptName} /> : null}
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => deletePayment(orderId, p.id)}
                  className="text-xs text-faint hover:text-danger"
                >
                  {t("remove")}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-2 text-xs text-danger">{errorText(error)}</p> : null}
    </>
  );
}

// --- expenses ---------------------------------------------------------------

function ExpenseSection({
  orderId,
  rows,
  defaultCurrency,
  cashAccounts,
}: {
  orderId: number;
  rows: ExpenseRow[];
  defaultCurrency: string;
  cashAccounts: CashAccountOption[];
}) {
  const isAdmin = useIsAdmin();
  const t = useTranslations("finance");
  const errorText = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const [category, setCategory] = useState<string>("freight");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [accountId, setAccountId] = useState(String(cashAccounts.find((account) => account.currency === defaultCurrency)?.id ?? ""));

  async function action(prev: FinanceActionResult | undefined, formData: FormData) {
    const result = await addExpense(orderId, prev, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }
  const [result, formAction, isPending] = useActionState(action, undefined);

  return (
    <div className="flex flex-col gap-3">
      <form
        ref={formRef}
        action={formAction}
        className="flex flex-wrap items-end gap-2"
        data-testid="expense-form"
      >
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("category")}</Label>
          <input type="hidden" name="category" value={category} />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`category_${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("amount")}</Label>
          <Input
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            required
            className="w-32"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("currency")}</Label>
          <Input
            name="currency"
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value);
              setAccountId(String(cashAccounts.find((account) => account.currency === event.target.value)?.id ?? ""));
            }}
            required
            className="w-20"
          />
        </div>
        <div className="flex min-w-48 flex-col gap-1">
          <Label className="text-xs">{t("cashAccount")}</Label>
          <select name="accountId" value={accountId} onChange={(event) => setAccountId(event.target.value)} className="flex h-9 rounded-md border border-line bg-surface px-2 text-sm" data-testid="expense-cash-account">
            <option value="">{t("cashAccountUnassigned")}</option>
            {cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.currency}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("date")}</Label>
          <Input name="spentOn" type="date" defaultValue={today()} required className="w-36" />
        </div>
        <div className="flex min-w-32 flex-1 flex-col gap-1">
          <Label className="text-xs">{t("note")}</Label>
          <Input name="note" />
        </div>
        <ReceiptField testid="receipt-expense" />
        <Button type="submit" size="sm" disabled={isPending}>
          {t("add")}
        </Button>
        {result?.error ? (
          <p className="w-full text-xs text-danger">
            {errorText(result.error)}
          </p>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="text-xs text-sub">{t("none")}</p>
      ) : (
        <ul
          className="flex flex-col divide-y divide-line"
          data-testid="expense-list"
        >
          {rows.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
              <span className="w-24 shrink-0 text-sub">
                {e.spentOn}
              </span>
              <span className="w-32 shrink-0 text-ink">
                {t(`category_${e.category}` as "category_other")}
              </span>
              <span className="font-medium text-ink">
                {money(e.amount)} {e.currency}
              </span>
              <span className="min-w-0 flex-1 truncate text-sub">
                {e.note}
              </span>
              {e.receiptPath ? <ReceiptLink path={e.receiptPath} name={e.receiptName} /> : null}
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => deleteExpense(orderId, e.id)}
                  className="text-xs text-faint hover:text-danger"
                >
                  {t("remove")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- documents --------------------------------------------------------------

function DocumentSection({
  orderId,
  rows,
}: {
  orderId: number;
  rows: DocumentRow[];
}) {
  const isAdmin = useIsAdmin();
  const t = useTranslations("finance");
  const errorText = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<string>("supplier_invoice");

  async function action(prev: FinanceActionResult | undefined, formData: FormData) {
    const result = await uploadOrderDocument(orderId, prev, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }
  const [result, formAction, isPending] = useActionState(action, undefined);

  return (
    <div className="flex flex-col gap-3">
      <form
        ref={formRef}
        action={formAction}
        className="flex flex-wrap items-end gap-2"
        data-testid="document-form"
      >
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("documentKind")}</Label>
          <input type="hidden" name="kind" value={kind} />
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`kind_${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Label className="text-xs">{t("file")}</Label>
          <FileButton
            name="file"
            required
            accept=".pdf,.xlsx,.xls,.docx,image/png,image/jpeg,image/webp"
          />
        </div>
        <Button type="submit" size="sm" disabled={isPending}>
          {t("upload")}
        </Button>
        {result?.error ? (
          <p className="w-full text-xs text-danger">
            {errorText(result.error)}
          </p>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="text-xs text-sub">{t("noDocuments")}</p>
      ) : (
        <ul
          className="flex flex-col divide-y divide-line"
          data-testid="document-list"
        >
          {rows.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="w-36 shrink-0 text-sub">
                {t(`kind_${d.kind}` as "kind_other")}
              </span>
              {/* download keeps the name the file arrived with */}
              <a
                href={d.path}
                download={d.originalName}
                className="min-w-0 flex-1 truncate font-medium text-ink hover:underline"
              >
                {d.originalName}
              </a>
              <span className="shrink-0 text-xs text-faint">
                {prettyBytes(d.sizeBytes)}
              </span>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t("deleteDocumentConfirm"))) deleteOrderDocument(orderId, d.id);
                  }}
                  className="text-xs text-faint hover:text-danger"
                >
                  {t("remove")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- the assembled workspace sections ---------------------------------------

/**
 * The documents card alone: the page pairs it with the money summary in one
 * row, so neither sits as a lonely island with dead space beside it.
 */
export function OrderDocumentsCard({
  orderId,
  documents,
}: {
  orderId: number;
  documents: DocumentRow[];
}) {
  const t = useTranslations("finance");
  return (
    <OrderSection title={t("documents")} data-testid="section-documents">
      <DocumentSection orderId={orderId} rows={documents} />
    </OrderSection>
  );
}

export function OrderFinance({
  orderId,
  quoteCurrency,
  supplierCurrency,
  payments,
  expenses,
  suppliers,
  balances,
  cashAccounts,
  rates,
}: {
  orderId: number;
  quoteCurrency: string;
  supplierCurrency: string;
  payments: PaymentRow[];
  expenses: ExpenseRow[];
  suppliers: SupplierOption[];
  balances: SupplierBalance[];
  cashAccounts: CashAccountOption[];
  rates: Record<string, number>;
}) {
  const t = useTranslations("finance");
  const paymentsIn = payments.filter((p) => p.direction === "in");
  const paymentsOut = payments.filter((p) => p.direction === "out");

  return (
    <div className="flex flex-col gap-4">
      <SupplierPaymentBalances balances={balances} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <OrderSection title={t("paymentsIn")} data-testid="section-payments-in">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-sub">{t("gatewayHint")}</p>
            <PaymentForm orderId={orderId} direction="in" defaultCurrency={quoteCurrency} suppliers={[]} cashAccounts={cashAccounts} rates={rates} />
            <PaymentList orderId={orderId} rows={paymentsIn} suppliers={[]} />
          </div>
        </OrderSection>
        <OrderSection title={t("paymentsOut")} data-testid="section-payments-out">
          <div className="flex flex-col gap-3">
            <PaymentForm orderId={orderId} direction="out" defaultCurrency={supplierCurrency} suppliers={suppliers} cashAccounts={cashAccounts} rates={rates} />
            <PaymentList orderId={orderId} rows={paymentsOut} suppliers={suppliers} />
          </div>
        </OrderSection>
      </div>

      <OrderSection title={t("expenses")} data-testid="section-expenses">
        <ExpenseSection orderId={orderId} rows={expenses} defaultCurrency={quoteCurrency} cashAccounts={cashAccounts} />
      </OrderSection>
    </div>
  );
}
