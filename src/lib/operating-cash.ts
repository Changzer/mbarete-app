import { convert, roundMoney, type CurrencyRates } from "@/lib/calculations";
import { canonicalCurrencyCode, canonicalCurrencyRates } from "@/lib/currency";

export type CashAccountInput = {
  id: number;
  label: string;
  currency: string;
  openingBalance: number;
  openingDate: string;
  trackBalance: boolean;
};

export type OrderPaymentCashInput = {
  direction: "in" | "out";
  amount: number;
  currency: string;
  account: string;
  paidOn: string;
  ratesSnapshot: string;
};

export type OrderExpenseCashInput = {
  amount: number;
  currency: string;
  spentOn: string;
  ratesSnapshot: string;
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
};

export type CashTransactionInput = {
  kind: "other_income" | "transfer" | "adjustment";
  direction: "in" | "out";
  amount: number;
  currency: string;
  transactedOn: string;
  accountId: number;
  destinationAccountId: number | null;
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
};

export type OperatingCashAccount = CashAccountInput & {
  bookBalance: number;
  bookAtCheck: number;
  actualBalance: number | null;
  checkedOn: string | null;
  difference: number | null;
};

export type OperatingCashView = {
  accounts: OperatingCashAccount[];
  unassigned: { currency: string; amount: number }[];
};

function parseSnapshot(raw: string, fallback: CurrencyRates): CurrencyRates {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? canonicalCurrencyRates(parsed) : fallback;
  } catch {
    return fallback;
  }
}

export function computeOperatingCash(input: OperatingCashInput, asOf: string, rates: CurrencyRates): OperatingCashView {
  const accounts = input.accounts.filter((account) => account.trackBalance && account.openingDate);
  const unassigned = new Map<string, number>();
  const forCurrency = (currency: string) => {
    const code = canonicalCurrencyCode(currency);
    return accounts.filter((account) => canonicalCurrencyCode(account.currency) === code);
  };
  const converted = (amount: number, from: string, to: string, ownRates: CurrencyRates) => {
    const source = canonicalCurrencyCode(from);
    const target = canonicalCurrencyCode(to);
    return source === target ? amount : convert(amount, source, target, ownRates);
  };
  const book = (account: CashAccountInput, end: string) => {
    const relevant = (date: string) => date >= account.openingDate && date <= end;
    let total = 0;
    for (const payment of input.payments) {
      if (!relevant(payment.paidOn)) continue;
      const candidates = forCurrency(payment.account || payment.currency);
      if (candidates.length === 1 && candidates[0].id === account.id) {
        const amount = payment.direction === "in" ? payment.amount : -payment.amount;
        total += converted(amount, payment.currency, account.currency, parseSnapshot(payment.ratesSnapshot, rates));
      }
    }
    for (const expense of input.orderExpenses) {
      if (!relevant(expense.spentOn)) continue;
      const candidates = forCurrency(expense.currency);
      if (candidates.length === 1 && candidates[0].id === account.id) {
        total += converted(-expense.amount, expense.currency, account.currency, parseSnapshot(expense.ratesSnapshot, rates));
      }
    }
    for (const expense of input.operatingExpenses) {
      if (expense.accountId === account.id && relevant(expense.spentOn)) total -= expense.amount;
    }
    for (const transaction of input.transactions) {
      if (!relevant(transaction.transactedOn)) continue;
      if (transaction.kind === "transfer") {
        if (transaction.accountId === account.id) total -= transaction.amount;
        if (transaction.destinationAccountId === account.id) total += transaction.amount;
      } else if (transaction.accountId === account.id) {
        total += transaction.direction === "in" ? transaction.amount : -transaction.amount;
      }
    }
    return roundMoney(account.openingBalance + total);
  };

  for (const payment of input.payments) {
    if (forCurrency(payment.account || payment.currency).length !== 1) {
      const code = canonicalCurrencyCode(payment.account || payment.currency);
      unassigned.set(code, roundMoney((unassigned.get(code) ?? 0) + (payment.direction === "in" ? payment.amount : -payment.amount)));
    }
  }
  for (const expense of input.orderExpenses) {
    if (forCurrency(expense.currency).length !== 1) {
      const code = canonicalCurrencyCode(expense.currency);
      unassigned.set(code, roundMoney((unassigned.get(code) ?? 0) - expense.amount));
    }
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
    unassigned: [...unassigned.entries()].map(([currency, amount]) => ({ currency, amount: roundMoney(amount) })),
  };
}
