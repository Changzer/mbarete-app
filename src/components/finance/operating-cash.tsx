"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import type { OperatingCashInput, OperatingCashView } from "@/lib/operating-cash";
import { isTailongAccount } from "@/lib/operating-cash";
import {
  addCashTransaction,
  addOperatingExpense,
  assignExpenseAccount,
  assignPaymentAccount,
  deleteCashTransaction,
  deleteOperatingExpense,
  recordBalanceCheck,
  saveCashAccount,
} from "@/lib/actions/operating-cash";
import { Link } from "@/i18n/navigation";
import type { BankLedgerEntry, StatementDocumentInput } from "@/lib/operating-cash";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CATEGORIES = ["rent", "utilities", "payroll", "taxes", "professional_fees", "software", "marketing", "travel", "office", "bank_fees", "other"] as const;
const today = () => new Date().toISOString().slice(0, 10);
const money = (amount: number, currency: string) => `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const inputClass = "h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink";

function ErrorMessage({ error }: { error?: string }) {
  const t = useTranslations("operatingCash");
  return error ? <p role="alert" className="mt-2 text-xs text-danger">{t(`error_${error}` as "error_invalid")}</p> : null;
}

function OperatingExpenseForm({ accounts }: { accounts: OperatingCashInput["accounts"] }) {
  const t = useTranslations("operatingCash");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [accountId, setAccountId] = useState(String(accounts[0]?.id ?? ""));
  const [state, action, pending] = useActionState(addOperatingExpense, undefined);
  useEffect(() => {
    if (state && !state.error) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);
  return (
    <form ref={formRef} action={action} className="mt-3 flex flex-col gap-3" data-testid="operating-expense-form">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="operating-category">{t("category")}</Label>
          <select id="operating-category" name="category" required defaultValue="rent" className={inputClass} data-testid="operating-category">
            {CATEGORIES.map((category) => <option key={category} value={category}>{t(`category_${category}`)}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="operating-amount">{t("amount")}</Label>
          <Input id="operating-amount" name="amount" type="number" min="0.01" step="0.01" required className="w-full" data-testid="operating-amount" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="operating-currency">{t("currency")}</Label>
          <Input id="operating-currency" name="currency" value={accounts.find((account) => account.id === Number(accountId))?.currency ?? ""} readOnly required className="w-full" data-testid="operating-currency" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="operating-date">{t("date")}</Label>
          <Input id="operating-date" name="spentOn" type="date" defaultValue={today()} required className="w-full" data-testid="operating-date" />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="operating-account">{t("account")}</Label>
          <select id="operating-account" name="accountId" required value={accountId} onChange={(event) => setAccountId(event.target.value)} className={inputClass} data-testid="operating-account">
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.currency}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="operating-vendor">{t("vendor")}</Label>
          <Input id="operating-vendor" name="vendor" maxLength={160} className="w-full" data-testid="operating-vendor" />
        </div>
        <div className="col-span-2 flex flex-col gap-1 md:col-span-3">
          <Label htmlFor="operating-note">{t("note")}</Label>
          <Input id="operating-note" name="note" maxLength={500} className="w-full" data-testid="operating-note" />
        </div>
        <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
          <Label htmlFor="operating-receipt">{t("receipt")}</Label>
          <input id="operating-receipt" name="receipt" type="file" accept="image/*,.pdf" className="text-xs text-sub" data-testid="operating-receipt" />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pending || accounts.length === 0} className="w-fit" data-testid="operating-expense-save">
        <Plus className="h-4 w-4" strokeWidth={1.5} />{pending ? t("saving") : t("addExpense")}
      </Button>
      <ErrorMessage error={state?.error} />
    </form>
  );
}

function AccountRow({ account }: { account: OperatingCashView["accounts"][number] }) {
  const t = useTranslations("operatingCash");
  const router = useRouter();
  const [settingsState, settingsAction, settingsPending] = useActionState(saveCashAccount, undefined);
  const [checkState, checkAction, checkPending] = useActionState(recordBalanceCheck, undefined);
  useEffect(() => {
    if ((settingsState && !settingsState.error) || (checkState && !checkState.error)) router.refresh();
  }, [settingsState, checkState, router]);
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3" data-testid={`cash-account-${account.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-ink">{account.label} · {account.currency}</h3>
          <p className="mt-0.5 text-[11px] text-sub">{t("bookBalance")}: <span className="font-mono text-ink">{money(account.bookBalance, account.currency)}</span></p>
          {account.actualBalance !== null ? (
            <p className="mt-0.5 text-[11px] text-sub">
              {t("actualBalance", { amount: money(account.actualBalance, account.currency), date: account.checkedOn ?? "" })}
              <span className={account.difference === 0 ? "ml-2 text-ok" : "ml-2 text-warn"}>{t("difference", { amount: money(account.difference ?? 0, account.currency) })}</span>
            </p>
          ) : <p className="mt-0.5 text-[11px] text-sub">{t("noBalanceCheck")}</p>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <form action={settingsAction} className="flex flex-wrap items-end gap-2" data-testid={`opening-form-${account.id}`}>
          <input type="hidden" name="id" value={account.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`opening-balance-${account.id}`}>{t("openingBalance")}</Label>
            <Input id={`opening-balance-${account.id}`} name="openingBalance" type="number" step="0.01" defaultValue={account.openingBalance} className="w-32" data-testid={`opening-balance-${account.id}`} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`opening-date-${account.id}`}>{t("openingDate")}</Label>
            <Input id={`opening-date-${account.id}`} name="openingDate" type="date" defaultValue={account.openingDate || today()} className="w-36" data-testid={`opening-date-${account.id}`} />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={settingsPending}>{t("saveOpening")}</Button>
        </form>
        <form action={checkAction} className="flex flex-wrap items-end gap-2" data-testid={`check-form-${account.id}`}>
          <input type="hidden" name="accountId" value={account.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`actual-balance-${account.id}`}>{t("actualBank")}</Label>
            <Input id={`actual-balance-${account.id}`} name="amount" type="number" step="0.01" required className="w-32" data-testid={`actual-balance-${account.id}`} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`actual-date-${account.id}`}>{t("date")}</Label>
            <Input id={`actual-date-${account.id}`} name="checkedOn" type="date" defaultValue={today()} required className="w-36" data-testid={`actual-date-${account.id}`} />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={checkPending || !account.openingDate}>{t("recordCheck")}</Button>
        </form>
      </div>
      <ErrorMessage error={settingsState?.error || checkState?.error} />
    </div>
  );
}

function CashTransactionForm({ accounts }: { accounts: OperatingCashInput["accounts"] }) {
  const t = useTranslations("operatingCash");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState("other_income");
  const [accountId, setAccountId] = useState(String(accounts[0]?.id ?? ""));
  const [destinationAccountId, setDestinationAccountId] = useState(String(accounts[1]?.id ?? ""));
  const [state, action, pending] = useActionState(addCashTransaction, undefined);
  const source = accounts.find((account) => account.id === Number(accountId));
  const destinations = accounts.filter((account) => account.id !== Number(accountId));
  useEffect(() => {
    if (state && !state.error) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);
  return (
    <form ref={formRef} action={action} className="mt-3 flex flex-col gap-3" data-testid="cash-transaction-form">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="cash-kind">{t("transactionKind")}</Label>
          <select id="cash-kind" name="kind" value={kind} onChange={(event) => setKind(event.target.value)} className={inputClass} data-testid="cash-kind">
            <option value="other_income">{t("otherIncome")}</option>
            <option value="other_expense">{t("otherExpense")}</option>
            <option value="exchange">{t("exchange")}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cash-direction">{t("direction")}</Label>
          <select id="cash-direction" name="direction" value={kind === "other_income" ? "in" : "out"} disabled={kind !== "adjustment"} className={inputClass} data-testid="cash-direction">
            <option value="in">{t("moneyIn")}</option>
            <option value="out">{t("moneyOut")}</option>
          </select>
          {kind !== "adjustment" ? <input type="hidden" name="direction" value={kind === "other_income" ? "in" : "out"} /> : null}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cash-account">{t("sourceAccount")}</Label>
          <select
            id="cash-account"
            name="accountId"
            required
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value);
              setDestinationAccountId(String(accounts.find((account) => account.id !== Number(event.target.value))?.id ?? ""));
            }}
            className={inputClass}
            data-testid="cash-account"
          >
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.currency}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cash-currency">{t("currency")}</Label>
          <Input id="cash-currency" name="currency" value={source?.currency ?? ""} readOnly required className="w-full" data-testid="cash-currency" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cash-amount">{t("amount")}</Label>
          <Input id="cash-amount" name="amount" type="number" min="0.01" step="0.01" required className="w-full" data-testid="cash-amount" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cash-date">{t("date")}</Label>
          <Input id="cash-date" name="transactedOn" type="date" defaultValue={today()} required className="w-full" data-testid="cash-date" />
        </div>
        {kind === "exchange" ? (
          <>
            <div className="flex flex-col gap-1 md:col-span-2">
              <Label htmlFor="cash-destination">{t("destinationAccount")}</Label>
              <select id="cash-destination" name="destinationAccountId" required value={destinationAccountId} onChange={(event) => setDestinationAccountId(event.target.value)} className={inputClass} data-testid="cash-destination">
                {destinations.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.currency}</option>)}
              </select>
              <input type="hidden" name="destinationCurrency" value={accounts.find((account) => account.id === Number(destinationAccountId))?.currency ?? ""} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cash-destination-amount">{t("destinationAmount")}</Label>
              <Input id="cash-destination-amount" name="destinationAmount" type="number" min="0.01" step="0.01" required className="w-full" data-testid="cash-destination-amount" />
            </div>
          </>
        ) : null}
        <div className="col-span-2 flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="cash-counterparty">{t("counterparty")}</Label>
          <Input id="cash-counterparty" name="counterparty" maxLength={160} className="w-full" data-testid="cash-counterparty" />
        </div>
        <div className="col-span-2 flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="cash-reference">{t("bankReference")}</Label>
          <Input id="cash-reference" name="bankReference" maxLength={120} className="w-full" data-testid="cash-reference" />
        </div>
        <div className="col-span-2 flex flex-col gap-1 md:col-span-3">
          <Label htmlFor="cash-note">{t("note")}</Label>
          <Input id="cash-note" name="note" maxLength={500} className="w-full" data-testid="cash-note" />
        </div>
        <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
          <Label htmlFor="cash-receipt">{t("receipt")}</Label>
          <input id="cash-receipt" name="receipt" type="file" accept="image/*,.pdf" className="text-xs text-sub" data-testid="cash-receipt" />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pending || accounts.length === 0} className="w-fit" data-testid="cash-transaction-save">
        <Plus className="h-4 w-4" strokeWidth={1.5} />{pending ? t("saving") : t("addTransaction")}
      </Button>
      <ErrorMessage error={state?.error} />
    </form>
  );
}

function PaymentAssignment({ payment, accounts }: { payment: OperatingCashView["unassignedPayments"][number]; accounts: OperatingCashInput["accounts"] }) {
  const t = useTranslations("operatingCash");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [accountId, setAccountId] = useState("");
  const [settlement, setSettlement] = useState("");
  if (payment.id === undefined) return null;
  const save = (settlementAmount?: number) => {
    if (!accountId) return;
    setError(undefined);
    start(async () => {
      const result = await assignPaymentAccount(payment.id!, Number(accountId), settlementAmount);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };
  return (
    <div className="rounded-md border border-line bg-surface-2 p-2" data-testid={`unassigned-payment-${payment.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-sub">{payment.paidOn}</span>
        <Link href={`/orders/${payment.orderId}`} className="text-action-chrome hover:underline">#{payment.orderId}</Link>
        <span className="font-medium text-ink">{money(payment.amount, payment.currency)}</span>
        <span className="text-sub">{payment.direction === "in" ? t("moneyIn") : t("moneyOut")} · {payment.channel === "xtransfer" ? "XTransfer" : payment.note}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        {payment.channel === "xtransfer" ? (
          <div className="flex flex-col gap-1">
            <Label>{t("settlementAmount")}</Label>
            <Input type="number" min="0.01" step="0.01" value={settlement} onChange={(event) => setSettlement(event.target.value)} className="w-32" data-testid={`settlement-unassigned-${payment.id}`} />
          </div>
        ) : null}
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={inputClass} data-testid={`assign-payment-${payment.id}`}>
          <option value="">{t("assignAccount")}</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.currency}</option>)}
        </select>
        <Button type="button" size="sm" variant="outline" disabled={pending || !accountId} onClick={() => save(payment.channel === "xtransfer" ? Number(settlement) : undefined)}>
          {t("assign")}
        </Button>
      </div>
      <ErrorMessage error={error} />
    </div>
  );
}

function UnassignedReview({ view, accounts }: { view: OperatingCashView; accounts: OperatingCashInput["accounts"] }) {
  const t = useTranslations("operatingCash");
  const router = useRouter();
  const [pending, start] = useTransition();
  const count = view.unassignedPayments.length + view.unassignedExpenses.length;
  if (count === 0) return null;
  return (
    <details className="rounded-lg border border-warn bg-warn-soft p-3" data-testid="bank-assignment-review">
      <summary className="cursor-pointer text-xs font-semibold text-warn">{t("reviewUnassigned", { count })}</summary>
      <div className="mt-3 flex flex-col gap-2">
        {view.unassignedPayments.map((payment) => <PaymentAssignment key={`p-${payment.id}`} payment={payment} accounts={accounts} />)}
        {view.unassignedExpenses.map((expense) => expense.id === undefined ? null : (
          <div key={`e-${expense.id}`} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2 p-2 text-xs" data-testid={`unassigned-expense-${expense.id}`}>
            <span className="text-sub">{expense.spentOn}</span>
            <Link href={`/orders/${expense.orderId}`} className="text-action-chrome hover:underline">#{expense.orderId}</Link>
            <span className="font-medium text-ink">{money(expense.amount, expense.currency)}</span>
            <span className="min-w-32 flex-1 text-sub">{expense.note}</span>
            <select
              value=""
              disabled={pending}
              onChange={(event) => start(async () => { await assignExpenseAccount(expense.id!, Number(event.target.value)); router.refresh(); })}
              className={inputClass}
              data-testid={`assign-expense-${expense.id}`}
            >
              <option value="">{t("assignAccount")}</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.currency}</option>)}
            </select>
          </div>
        ))}
      </div>
    </details>
  );
}

function BankLedger({ view, accounts, documents }: { view: OperatingCashView; accounts: OperatingCashInput["accounts"]; documents: StatementDocumentInput[] }) {
  const t = useTranslations("operatingCash");
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 0);
  const [deleting, startDelete] = useTransition();
  const account = accounts.find((candidate) => candidate.id === accountId) ?? accounts[0];
  if (!account) return null;
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const rows = view.entries
    .filter((entry) => entry.accountId === account.id && entry.date >= account.openingDate)
    .reduce<{ entry: BankLedgerEntry; running: number }[]>((result, entry) => {
      const running = (result.at(-1)?.running ?? account.openingBalance) + (entry.direction === "in" ? entry.amount : -entry.amount);
      return [...result, { entry, running }];
    }, [])
    .slice(-50)
    .reverse();
  const label = (entry: BankLedgerEntry) => {
    if (["client_payment", "supplier_payment", "xtransfer_settlement", "other_income", "other_expense", "exchange", "transfer", "adjustment"].includes(entry.kind)) {
      return t(`kind_${entry.kind}` as "kind_other_income");
    }
    return t(`category_${entry.kind}` as "category_other");
  };
  return (
    <section className="rounded-lg border border-line bg-surface p-4" data-testid="bank-ledger">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-ink">{t("ledgerTitle")}</h3>
          <p className="mt-0.5 text-xs text-sub">{t("ledgerHelp")}</p>
        </div>
        <div className="flex gap-1">
          {accounts.map((item) => (
            <button key={item.id} type="button" onClick={() => setAccountId(item.id)} className={`rounded-md px-2 py-1 text-xs ${item.id === account.id ? "bg-action text-white" : "text-sub hover:bg-surface-2"}`} data-testid={`ledger-account-${item.id}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-line text-left text-sub">
            <tr><th className="px-2 py-2">{t("date")}</th><th className="px-2 py-2">{t("description")}</th><th className="px-2 py-2 text-right">{t("moneyIn")}</th><th className="px-2 py-2 text-right">{t("moneyOut")}</th><th className="px-2 py-2 text-right">{t("runningBalance")}</th><th className="px-2 py-2">{t("evidence")}</th><th className="px-2 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr data-testid="ledger-opening"><td className="px-2 py-2 text-sub">{account.openingDate}</td><td className="px-2 py-2 font-medium text-ink">{t("openingBalance")}</td><td /><td /><td className="px-2 py-2 text-right font-mono text-ink">{money(account.openingBalance, account.currency)}</td><td /><td /></tr>
            {rows.map(({ entry, running: balance }) => {
              const document = entry.statementDocumentId === null ? null : documentMap.get(entry.statementDocumentId);
              const receipt = entry.receiptPath || document?.path || "";
              return (
                <tr key={entry.key} data-testid={`ledger-${entry.source}-${entry.sourceId ?? "row"}`}>
                  <td className="whitespace-nowrap px-2 py-2 text-sub">{entry.date}</td>
                  <td className="min-w-48 px-2 py-2"><span className="font-medium text-ink">{label(entry)}</span><span className="ml-1 text-sub">{entry.description}</span>{entry.orderId ? <Link href={`/orders/${entry.orderId}`} className="ml-1 text-action-chrome hover:underline">#{entry.orderId}</Link> : null}</td>
                  <td className="px-2 py-2 text-right font-mono text-ok">{entry.direction === "in" ? money(entry.amount, entry.currency) : ""}</td>
                  <td className="px-2 py-2 text-right font-mono text-danger">{entry.direction === "out" ? money(entry.amount, entry.currency) : ""}</td>
                  <td className="px-2 py-2 text-right font-mono text-ink">{money(balance, account.currency)}</td>
                  <td className="px-2 py-2">{receipt ? <a href={receipt} target="_blank" rel="noreferrer" className="text-action-chrome hover:underline">{document?.originalName || t("viewReceipt")}</a> : "—"}</td>
                  <td className="px-2 py-2 text-right">{entry.source === "cash_transaction" && entry.sourceId !== null ? <button type="button" aria-label={t("deleteTransaction")} disabled={deleting} onClick={() => { if (window.confirm(t("deleteTransactionConfirm"))) startDelete(async () => { await deleteCashTransaction(entry.sourceId!); router.refresh(); }); }} className="text-faint hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function OperatingCash({
  data,
  view,
  companyNet,
  reportCurrency,
}: {
  data: OperatingCashInput;
  view: OperatingCashView;
  companyNet: number;
  reportCurrency: string;
}) {
  const t = useTranslations("operatingCash");
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const trackedAccounts = data.accounts
    .filter((account) => account.trackBalance && isTailongAccount(account))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const activeAccounts = trackedAccounts.filter((account) => account.openingDate);
  const computed = new Map(view.accounts.map((account) => [account.id, account]));
  const accountRows = trackedAccounts.map((account) => computed.get(account.id) ?? {
    ...account,
    bookBalance: 0,
    bookAtCheck: 0,
    actualBalance: null,
    checkedOn: null,
    difference: null,
  });
  return (
    <div className="flex flex-col gap-4" data-testid="operating-cash">
      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">{t("expensesTitle")}</h2>
            <p className="mt-0.5 text-xs text-sub">{t("expensesHelp")}</p>
          </div>
          <div className="text-right text-xs text-sub">
            {t("companyNet")}<div className="font-mono text-[18px] font-semibold text-ink">{money(companyNet, reportCurrency)}</div>
          </div>
        </div>
        <OperatingExpenseForm key={`expenses-${activeAccounts.map((account) => account.id).join("-")}`} accounts={activeAccounts} />
        {data.operatingExpenses.length > 0 ? (
          <ul className="mt-4 flex flex-col divide-y divide-line text-sm">
            {data.operatingExpenses.slice(0, 8).map((expense) => (
              <li key={expense.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid={`operating-expense-${expense.id}`}>
                <span className="w-24 text-sub">{expense.spentOn}</span>
                <span className="w-28 text-ink">{t(`category_${expense.category}`)}</span>
                <span className="font-medium text-ink">{money(expense.amount, expense.currency)}</span>
                <span className="min-w-0 flex-1 truncate text-sub">{expense.vendor || expense.note}</span>
                {expense.receiptPath ? <a href={expense.receiptPath} target="_blank" rel="noreferrer" className="text-xs text-action-chrome hover:underline">{t("viewReceipt")}</a> : null}
                <button
                  type="button"
                  aria-label={t("deleteExpense")}
                  disabled={deleting}
                  onClick={() => {
                    if (window.confirm(t("deleteConfirm"))) startDelete(async () => {
                      await deleteOperatingExpense(expense.id);
                      router.refresh();
                    });
                  }}
                  className="text-faint hover:text-danger"
                  data-testid={`operating-expense-delete-${expense.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-xs text-sub">{t("noExpenses")}</p>}
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">{t("cashTitle")}</h2>
        <p className="mt-0.5 text-xs text-sub">{t("cashHelp")}</p>
        {view.unassigned.length > 0 ? (
          <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn" data-testid="cash-unassigned">
            {t("unassigned", { values: view.unassigned.map((row) => money(row.amount, row.currency)).join(" · ") })}
          </p>
        ) : null}
        <div className="mt-3 flex flex-col gap-3">
          {accountRows.map((account) => <AccountRow key={account.id} account={account} />)}
        </div>
        <div className="mt-3"><UnassignedReview view={view} accounts={activeAccounts} /></div>
        <div className="mt-3"><BankLedger view={view} accounts={activeAccounts} documents={data.statementDocuments ?? []} /></div>
        <details className="mt-5 border-t border-line pt-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink">{t("otherMovements")}</summary>
          <CashTransactionForm key={`transactions-${activeAccounts.map((account) => account.id).join("-")}`} accounts={activeAccounts} />
        </details>
      </section>
    </div>
  );
}
