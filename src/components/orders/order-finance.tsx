"use client";

import { useActionState, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  addPayment,
  deletePayment,
  addExpense,
  deleteExpense,
  uploadOrderDocument,
  deleteOrderDocument,
  type FinanceActionResult,
} from "@/lib/actions/finance";
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

export type PaymentRow = {
  id: number;
  direction: "in" | "out";
  amount: number;
  currency: string;
  paidOn: string;
  account: string;
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
      default:
        return t("invalid");
    }
  };
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
      <input
        name="receipt"
        type="file"
        accept="image/*,.pdf"
        className="text-sm"
        data-testid={testid}
      />
    </div>
  );
}

/** The link a recorded slip renders as, opening in its own tab. */
function ReceiptLink({ path, name }: { path: string; name: string }) {
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
      {t("viewReceipt")}
    </a>
  );
}

// --- payments ---------------------------------------------------------------

function PaymentForm({
  orderId,
  direction,
  defaultCurrency,
}: {
  orderId: number;
  direction: "in" | "out";
  defaultCurrency: string;
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

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-wrap items-end gap-2"
      data-testid={`payment-form-${direction}`}
    >
      <input type="hidden" name="direction" value={direction} />
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
        <Input name="currency" defaultValue={defaultCurrency} required className="w-20" />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{t("date")}</Label>
        <Input name="paidOn" type="date" defaultValue={today()} required className="w-36" />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{t("account")}</Label>
        <select
          name="account"
          defaultValue={defaultCurrency === "USD" ? "USD" : "RMB"}
          className="flex h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          data-testid={`account-${direction}`}
        >
          <option value="RMB">{t("accountRmb")}</option>
          <option value="USD">{t("accountUsd")}</option>
          <option value="">{t("accountOther")}</option>
        </select>
      </div>
      <div className="flex min-w-32 flex-1 flex-col gap-1">
        <Label className="text-xs">{t("note")}</Label>
        <Input name="note" placeholder={t("notePlaceholder")} />
      </div>
      <ReceiptField testid={`receipt-${direction}`} />
      <Button type="submit" size="sm" disabled={isPending}>
        {t("add")}
      </Button>
      {result?.error ? (
        <p className="w-full text-xs text-red-600 dark:text-red-400">{errorText(result.error)}</p>
      ) : null}
    </form>
  );
}

function PaymentList({
  orderId,
  rows,
}: {
  orderId: number;
  rows: PaymentRow[];
}) {
  const t = useTranslations("finance");
  if (rows.length === 0) {
    return <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("none")}</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
      {rows.map((p) => (
        <li key={p.id} className="flex items-center gap-3 py-1.5 text-sm">
          <span className="w-24 shrink-0 text-neutral-500 dark:text-neutral-400">{p.paidOn}</span>
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {money(p.amount)} {p.currency}
          </span>
          {p.account ? (
            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {p.account}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-neutral-500 dark:text-neutral-400">
            {p.note}
          </span>
          {p.receiptPath ? <ReceiptLink path={p.receiptPath} name={p.receiptName} /> : null}
          <button
            type="button"
            onClick={() => deletePayment(orderId, p.id)}
            className="text-xs text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
          >
            {t("remove")}
          </button>
        </li>
      ))}
    </ul>
  );
}

// --- expenses ---------------------------------------------------------------

function ExpenseSection({
  orderId,
  rows,
  defaultCurrency,
}: {
  orderId: number;
  rows: ExpenseRow[];
  defaultCurrency: string;
}) {
  const t = useTranslations("finance");
  const errorText = useErrorText();
  const formRef = useRef<HTMLFormElement>(null);
  const [category, setCategory] = useState<string>("freight");

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
          <Input name="currency" defaultValue={defaultCurrency} required className="w-20" />
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
          <p className="w-full text-xs text-red-600 dark:text-red-400">
            {errorText(result.error)}
          </p>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("none")}</p>
      ) : (
        <ul
          className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800"
          data-testid="expense-list"
        >
          {rows.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="w-24 shrink-0 text-neutral-500 dark:text-neutral-400">
                {e.spentOn}
              </span>
              <span className="w-32 shrink-0 text-neutral-700 dark:text-neutral-300">
                {t(`category_${e.category}` as "category_other")}
              </span>
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                {money(e.amount)} {e.currency}
              </span>
              <span className="min-w-0 flex-1 truncate text-neutral-500 dark:text-neutral-400">
                {e.note}
              </span>
              {e.receiptPath ? <ReceiptLink path={e.receiptPath} name={e.receiptName} /> : null}
              <button
                type="button"
                onClick={() => deleteExpense(orderId, e.id)}
                className="text-xs text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
              >
                {t("remove")}
              </button>
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
          <input
            name="file"
            type="file"
            required
            accept=".pdf,.xlsx,.xls,.docx,image/png,image/jpeg,image/webp"
            className="text-sm"
          />
        </div>
        <Button type="submit" size="sm" disabled={isPending}>
          {t("upload")}
        </Button>
        {result?.error ? (
          <p className="w-full text-xs text-red-600 dark:text-red-400">
            {errorText(result.error)}
          </p>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("noDocuments")}</p>
      ) : (
        <ul
          className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800"
          data-testid="document-list"
        >
          {rows.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="w-36 shrink-0 text-neutral-500 dark:text-neutral-400">
                {t(`kind_${d.kind}` as "kind_other")}
              </span>
              {/* download keeps the name the file arrived with */}
              <a
                href={d.path}
                download={d.originalName}
                className="min-w-0 flex-1 truncate font-medium text-neutral-900 hover:underline dark:text-neutral-100"
              >
                {d.originalName}
              </a>
              <span className="shrink-0 text-xs text-neutral-400">
                {prettyBytes(d.sizeBytes)}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (confirm(t("deleteDocumentConfirm"))) deleteOrderDocument(orderId, d.id);
                }}
                className="text-xs text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
              >
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- the assembled workspace sections ---------------------------------------

export function OrderFinance({
  orderId,
  quoteCurrency,
  supplierCurrency,
  payments,
  expenses,
  documents,
}: {
  orderId: number;
  quoteCurrency: string;
  supplierCurrency: string;
  payments: PaymentRow[];
  expenses: ExpenseRow[];
  documents: DocumentRow[];
}) {
  const t = useTranslations("finance");
  const paymentsIn = payments.filter((p) => p.direction === "in");
  const paymentsOut = payments.filter((p) => p.direction === "out");

  const box =
    "rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900";
  const heading = "mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100";

  return (
    <div className="flex flex-col gap-4">
      <div className={box} data-testid="section-documents">
        <h2 className={heading}>{t("documents")}</h2>
        <DocumentSection orderId={orderId} rows={documents} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={box} data-testid="section-payments-in">
          <h2 className={heading}>{t("paymentsIn")}</h2>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("gatewayHint")}</p>
            <PaymentForm orderId={orderId} direction="in" defaultCurrency={quoteCurrency} />
            <PaymentList orderId={orderId} rows={paymentsIn} />
          </div>
        </div>
        <div className={box} data-testid="section-payments-out">
          <h2 className={heading}>{t("paymentsOut")}</h2>
          <div className="flex flex-col gap-3">
            <PaymentForm orderId={orderId} direction="out" defaultCurrency={supplierCurrency} />
            <PaymentList orderId={orderId} rows={paymentsOut} />
          </div>
        </div>
      </div>

      <div className={box} data-testid="section-expenses">
        <h2 className={heading}>{t("expenses")}</h2>
        <ExpenseSection orderId={orderId} rows={expenses} defaultCurrency={quoteCurrency} />
      </div>
    </div>
  );
}
