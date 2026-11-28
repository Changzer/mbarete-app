import { roundMoney, type CurrencyRates } from "@/lib/calculations";
import { canonicalCurrencyCode } from "@/lib/currency";

export type CashAccountInput = {
  id: number;
  label: string;
  currency: string;
  openingBalance: number;
  openingDate: string;
  trackBalance: boolean;
};

export function isTailongAccount(account: Pick<CashAccountInput, "label">): boolean {
  return account.label.trim().toLowerCase().startsWith("tailong");
}

export type StatementDocumentInput = {
  id: number;
  accountId: number;
  path: string;
  originalName: string;
};

export type OrderPaymentCashInput = {
  id?: number;
  orderId?: number;
  direction: "in" | "out";
  amount: number;
  currency: string;
  account: string;
  paidOn: string;
  ratesSnapshot: string;
  channel?: "bank" | "xtransfer";
  cashAccountId?: number | null;
  settlementAmount?: number | null;
  settlementCurrency?: string;
  settlementAccountId?: number | null;
  note?: string;
  receiptPath?: string;
  outboundReceiptPath?: string;
  bankReference?: string;
  statementDocumentId?: number | null;
  statementRow?: string;
};

export type OrderExpenseCashInput = {
  id?: number;
  orderId?: number;
  category?: string;
  amount: number;
  currency: string;
  spentOn: string;
  ratesSnapshot: string;
  accountId?: number | null;
  note?: string;
  receiptPath?: string;
  bankReference?: string;
  statementDocumentId?: number | null;
  statementRow?: string;
};

export type OperatingExpenseCashInput = {
  id: number;
  category: string;
  accountId: number;
  amount: number;
  currency: string;
  spentOn: string;
  vendor: string;
  note: string;
  receiptPath: string;
  bankReference?: string;
  statementDocumentId?: number | null;
  statementRow?: string;
};

export type CashTransactionInput = {
  id?: number;
  kind: "other_income" | "other_expense" | "transfer" | "exchange" | "adjustment";
  direction: "in" | "out";
  amount: number;
  currency: string;
  transactedOn: string;
  accountId: number;
  destinationAccountId: number | null;
  destinationAmount?: number | null;
  destinationCurrency?: string;
  counterparty?: string;
  note?: string;
  receiptPath?: string;
  bankReference?: string;
  statementDocumentId?: number | null;
  statementRow?: string;
};

export type BalanceCheckInput = {
  accountId: number;
  amount: number;
  checkedOn: string;
};

export type OperatingCashInput = {
  accounts: CashAccountInput[];
  payments: OrderPaymentCashInput[];
  orderExpenses: OrderExpenseCashInput[];
  operatingExpenses: OperatingExpenseCashInput[];
  transactions: CashTransactionInput[];
  balanceChecks: BalanceCheckInput[];
  statementDocuments?: StatementDocumentInput[];
};

export type OperatingCashAccount = CashAccountInput & {
  bookBalance: number;
  bookAtCheck: number;
  actualBalance: number | null;
  checkedOn: string | null;
  difference: number | null;
};

export type BankLedgerEntry = {
  key: string;
  source: "order_payment" | "order_expense" | "operating_expense" | "cash_transaction";
  sourceId: number | null;
  accountId: number;
  date: string;
  kind: string;
  direction: "in" | "out";
  amount: number;
  currency: string;
  description: string;
  counterparty: string;
  reference: string;
  orderId: number | null;
  receiptPath: string;
  statementDocumentId: number | null;
  statementRow: string;
};

export type OperatingCashView = {
  accounts: OperatingCashAccount[];
  entries: BankLedgerEntry[];
  unassigned: { currency: string; amount: number }[];
  unassignedPayments: OrderPaymentCashInput[];
  unassignedExpenses: OrderExpenseCashInput[];
};

export function buildBankLedgerEntries(input: OperatingCashInput): BankLedgerEntry[] {
  const accounts = new Map(input.accounts.map((account) => [account.id, account]));
  const entries: BankLedgerEntry[] = [];
  const add = (entry: Omit<BankLedgerEntry, "currency"> & { currency: string }) => {
    const account = accounts.get(entry.accountId);
    if (!account?.trackBalance || !isTailongAccount(account)) return;
    if (canonicalCurrencyCode(account.currency) !== canonicalCurrencyCode(entry.currency)) return;
    entries.push({ ...entry, currency: canonicalCurrencyCode(entry.currency) });
  };

  input.payments.forEach((payment, index) => {
    const sourceId = payment.id ?? null;
    const base = {
      source: "order_payment" as const,
      sourceId,
      date: payment.paidOn,
      description: payment.note ?? "",
      counterparty: payment.note ?? "",
      reference: payment.bankReference ?? "",
      orderId: payment.orderId ?? null,
      receiptPath: payment.receiptPath ?? "",
      statementDocumentId: payment.statementDocumentId ?? null,
      statementRow: payment.statementRow ?? "",
    };
    if (payment.settlementAccountId != null && payment.settlementAmount != null) {
      add({
        ...base,
        key: `payment-${sourceId ?? index}-settlement`,
        accountId: payment.settlementAccountId,
        kind: "xtransfer_settlement",
        direction: "in",
        amount: payment.settlementAmount,
        currency: payment.settlementCurrency ?? "CNY",
        receiptPath: payment.outboundReceiptPath ?? payment.receiptPath ?? "",
      });
    } else if (payment.channel !== "xtransfer" && payment.cashAccountId != null) {
      add({
        ...base,
        key: `payment-${sourceId ?? index}`,
        accountId: payment.cashAccountId,
        kind: payment.direction === "in" ? "client_payment" : "supplier_payment",
        direction: payment.direction,
        amount: payment.amount,
        currency: payment.currency,
      });
    }
  });

  input.orderExpenses.forEach((expense, index) => {
    if (expense.accountId == null) return;
    add({
      key: `order-expense-${expense.id ?? index}`,
      source: "order_expense",
      sourceId: expense.id ?? null,
      accountId: expense.accountId,
      date: expense.spentOn,
      kind: expense.category ?? "order_expense",
      direction: "out",
      amount: expense.amount,
      currency: expense.currency,
      description: expense.note ?? "",
      counterparty: expense.note ?? "",
      reference: expense.bankReference ?? "",
      orderId: expense.orderId ?? null,
      receiptPath: expense.receiptPath ?? "",
      statementDocumentId: expense.statementDocumentId ?? null,
      statementRow: expense.statementRow ?? "",
    });
  });

  for (const expense of input.operatingExpenses) {
    add({
      key: `operating-expense-${expense.id}`,
      source: "operating_expense",
      sourceId: expense.id,
      accountId: expense.accountId,
      date: expense.spentOn,
      kind: expense.category,
      direction: "out",
      amount: expense.amount,
      currency: expense.currency,
      description: expense.note,
      counterparty: expense.vendor,
      reference: expense.bankReference ?? "",
      orderId: null,
      receiptPath: expense.receiptPath,
      statementDocumentId: expense.statementDocumentId ?? null,
      statementRow: expense.statementRow ?? "",
    });
  }

  input.transactions.forEach((transaction, index) => {
    const base = {
      source: "cash_transaction" as const,
      sourceId: transaction.id ?? null,
      date: transaction.transactedOn,
      description: transaction.note ?? "",
      counterparty: transaction.counterparty ?? "",
      reference: transaction.bankReference ?? "",
      orderId: null,
      receiptPath: transaction.receiptPath ?? "",
      statementDocumentId: transaction.statementDocumentId ?? null,
      statementRow: transaction.statementRow ?? "",
    };
    const direction = transaction.kind === "transfer" || transaction.kind === "exchange"
      ? "out"
      : transaction.kind === "other_income"
        ? "in"
        : transaction.kind === "other_expense"
          ? "out"
          : transaction.direction;
    add({
      ...base,
      key: `cash-${transaction.id ?? index}`,
      accountId: transaction.accountId,
      kind: transaction.kind,
      direction,
      amount: transaction.amount,
      currency: transaction.currency,
    });
    if ((transaction.kind === "transfer" || transaction.kind === "exchange") && transaction.destinationAccountId != null) {
      add({
        ...base,
        key: `cash-${transaction.id ?? index}-destination`,
        accountId: transaction.destinationAccountId,
        kind: transaction.kind,
        direction: "in",
        amount: transaction.kind === "exchange" ? transaction.destinationAmount ?? 0 : transaction.amount,
        currency: transaction.kind === "exchange" ? transaction.destinationCurrency ?? "" : transaction.currency,
      });
    }
  });

  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

function validAccount(input: OperatingCashInput, id: number, currency: string): boolean {
  const account = input.accounts.find((candidate) => candidate.id === id);
  return Boolean(account?.trackBalance && isTailongAccount(account) && canonicalCurrencyCode(account.currency) === canonicalCurrencyCode(currency));
}

function assignedPayment(input: OperatingCashInput, payment: OrderPaymentCashInput): boolean {
  if (payment.settlementAccountId != null && payment.settlementAmount != null) {
    return validAccount(input, payment.settlementAccountId, payment.settlementCurrency ?? "CNY");
  }
  return payment.channel !== "xtransfer" && payment.cashAccountId != null && validAccount(input, payment.cashAccountId, payment.currency);
}

export function isDuplicateBankEntry(
  entries: BankLedgerEntry[],
  candidate: Pick<BankLedgerEntry, "accountId" | "date" | "direction" | "amount" | "reference" | "counterparty" | "statementDocumentId" | "statementRow">,
): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const reference = normalize(candidate.reference);
  const counterparty = normalize(candidate.counterparty);
  return entries.some((entry) => {
    if (candidate.statementDocumentId !== null && entry.statementDocumentId === candidate.statementDocumentId && entry.statementRow === candidate.statementRow) return true;
    if (entry.accountId !== candidate.accountId || entry.date !== candidate.date || entry.direction !== candidate.direction || Math.abs(entry.amount - candidate.amount) > 0.0001) return false;
    if (reference && normalize(entry.reference) === reference) return true;
    return !reference && Boolean(counterparty) && normalize(entry.counterparty) === counterparty;
  });
}

export function computeOperatingCash(input: OperatingCashInput, asOf: string, _rates: CurrencyRates): OperatingCashView {
  void _rates;
  const accounts = input.accounts.filter((account) => account.trackBalance && account.openingDate && isTailongAccount(account));
  const entries = buildBankLedgerEntries(input);
  const book = (account: CashAccountInput, end: string) => {
    const total = entries
      .filter((entry) => entry.accountId === account.id && entry.date >= account.openingDate && entry.date <= end)
      .reduce((sum, entry) => sum + (entry.direction === "in" ? entry.amount : -entry.amount), 0);
    return roundMoney(account.openingBalance + total);
  };

  const unassignedPayments = input.payments.filter((payment) => !assignedPayment(input, payment));
  const unassignedExpenses = input.orderExpenses.filter((expense) => expense.accountId == null || !validAccount(input, expense.accountId, expense.currency));
  const unassigned = new Map<string, number>();
  for (const payment of unassignedPayments) {
    const code = canonicalCurrencyCode(payment.account || payment.currency);
    unassigned.set(code, roundMoney((unassigned.get(code) ?? 0) + (payment.direction === "in" ? payment.amount : -payment.amount)));
  }
  for (const expense of unassignedExpenses) {
    const code = canonicalCurrencyCode(expense.currency);
    unassigned.set(code, roundMoney((unassigned.get(code) ?? 0) - expense.amount));
  }

  return {
    accounts: accounts.map((account) => {
      const check = input.balanceChecks
        .filter((candidate) => candidate.accountId === account.id && candidate.checkedOn <= asOf)
        .sort((a, b) => b.checkedOn.localeCompare(a.checkedOn))[0];
      const checkedOn = check?.checkedOn ?? null;
      const bookAtCheck = checkedOn ? book(account, checkedOn) : book(account, asOf);
      return {
        ...account,
        bookBalance: book(account, asOf),
        bookAtCheck,
        actualBalance: check?.amount ?? null,
        checkedOn,
        difference: check ? roundMoney(check.amount - bookAtCheck) : null,
      };
    }),
    entries,
    unassigned: [...unassigned.entries()].map(([currency, amount]) => ({ currency, amount: roundMoney(amount) })),
    unassignedPayments,
    unassignedExpenses,
  };
}
