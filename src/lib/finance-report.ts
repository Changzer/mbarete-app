import {
  convert,
  UnknownCurrencyError,
  type CurrencyRates,
} from "@/lib/calculations";

/**
 * Cross-order financial reporting.
 *
 * Each order's own maths stays true to its rate snapshot — expected revenue
 * and cost arrive here already computed in the order's quote currency. Only
 * the aggregation across currencies uses the live rate table, because a
 * report that sums USD and RMB orders needs one consistent basis. The page
 * says so next to the currency picker.
 */

export type FinanceOrderInput = {
  id: number;
  orderNumber: string;
  clientName: string;
  status: "draft" | "confirmed" | "shipped" | "cancelled";
  /** ISO timestamp; the month bucket is its first seven characters. */
  createdAt: string;
  quoteCurrency: string;
  /** goods + commission, in the quote currency, from the order's snapshot. */
  expectedRevenue: number;
  /** goods alone — what the supplier charges — in the quote currency. */
  expectedCost: number;
  payments: { direction: "in" | "out"; amount: number; currency: string; paidOn: string }[];
  expenses: { category: string; amount: number; currency: string; spentOn: string }[];
};

export type MonthRow = {
  month: string;
  orders: number;
  expectedRevenue: number;
  expectedNet: number;
  cashIn: number;
  cashOut: number;
  netCash: number;
};

export type ClientRow = {
  clientName: string;
  orders: number;
  expectedRevenue: number;
  expectedNet: number;
  marginPct: number | null;
  outstanding: number;
};

export type OpenBalance = {
  orderId: number;
  orderNumber: string;
  clientName: string;
  amount: number;
};

export type FinanceReport = {
  currency: string;
  totals: {
    expectedRevenue: number;
    expectedCost: number;
    expensesTotal: number;
    expectedNet: number;
    marginPct: number | null;
    receivables: number;
    payables: number;
    cashIn: number;
    cashOut: number;
    netCash: number;
  };
  months: MonthRow[];
  expensesByCategory: { category: string; amount: number; pct: number }[];
  clients: ClientRow[];
  receivablesList: OpenBalance[];
  payablesList: OpenBalance[];
  missingRates: string[];
};

const month = (isoDate: string) => isoDate.slice(0, 7);

/**
 * The whole business, one report.
 *
 * Cancelled orders are excluded from every expected figure — a dead quote is
 * not revenue and not a receivable — but any money that actually moved on
 * them (payments, expenses) stays in the cash flow and the expense
 * breakdown, because the bank account does not forget a cancelled order.
 */
export function computeFinanceReport(
  orders: FinanceOrderInput[],
  reportCurrency: string,
  rates: CurrencyRates,
): FinanceReport {
  const missing = new Set<string>();
  const conv = (amount: number, from: string) => {
    try {
      return convert(amount, from, reportCurrency, rates);
    } catch (err) {
      if (err instanceof UnknownCurrencyError) {
        missing.add(err.currency);
        return 0;
      }
      throw err;
    }
  };

  const totals = {
    expectedRevenue: 0,
    expectedCost: 0,
    expensesTotal: 0,
    expectedNet: 0,
    marginPct: null as number | null,
    receivables: 0,
    payables: 0,
    cashIn: 0,
    cashOut: 0,
    netCash: 0,
  };
  const months = new Map<string, MonthRow>();
  const clients = new Map<string, ClientRow>();
  const byCategory = new Map<string, number>();
  const receivablesList: OpenBalance[] = [];
  const payablesList: OpenBalance[] = [];

  const monthRow = (key: string) => {
    let row = months.get(key);
    if (!row) {
      row = { month: key, orders: 0, expectedRevenue: 0, expectedNet: 0, cashIn: 0, cashOut: 0, netCash: 0 };
      months.set(key, row);
    }
    return row;
  };

  for (const order of orders) {
    const live = order.status !== "cancelled";

    // --- cash and expenses: real money, counted whatever the status --------
    let received = 0;
    let paidOut = 0;
    for (const p of order.payments) {
      const amount = conv(p.amount, p.currency);
      const m = monthRow(month(p.paidOn));
      if (p.direction === "in") {
        received += amount;
        m.cashIn += amount;
        totals.cashIn += amount;
      } else {
        paidOut += amount;
        m.cashOut += amount;
        totals.cashOut += amount;
      }
    }
    let orderExpenses = 0;
    for (const e of order.expenses) {
      const amount = conv(e.amount, e.currency);
      orderExpenses += amount;
      totals.expensesTotal += amount;
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + amount);
      const m = monthRow(month(e.spentOn));
      m.cashOut += amount;
      totals.cashOut += amount;
    }

    if (!live) continue;

    // --- expected figures: only orders that are still real -----------------
    const revenue = conv(order.expectedRevenue, order.quoteCurrency);
    const cost = conv(order.expectedCost, order.quoteCurrency);
    const net = revenue - cost - orderExpenses;

    totals.expectedRevenue += revenue;
    totals.expectedCost += cost;

    const m = monthRow(month(order.createdAt));
    m.orders += 1;
    m.expectedRevenue += revenue;
    m.expectedNet += net;

    let clientRow = clients.get(order.clientName);
    if (!clientRow) {
      clientRow = {
        clientName: order.clientName,
        orders: 0,
        expectedRevenue: 0,
        expectedNet: 0,
        marginPct: null,
        outstanding: 0,
      };
      clients.set(order.clientName, clientRow);
    }
    clientRow.orders += 1;
    clientRow.expectedRevenue += revenue;
    clientRow.expectedNet += net;

    // Open balances: only what is genuinely still to move, never negative.
    const receivable = Math.max(0, revenue - received);
    const payable = Math.max(0, cost - paidOut);
    totals.receivables += receivable;
    totals.payables += payable;
    clientRow.outstanding += receivable;
    if (receivable > 0.005) {
      receivablesList.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        clientName: order.clientName,
        amount: receivable,
      });
    }
    if (payable > 0.005) {
      payablesList.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        clientName: order.clientName,
        amount: payable,
      });
    }
  }

  totals.expectedNet = totals.expectedRevenue - totals.expectedCost - totals.expensesTotal;
  totals.marginPct =
    totals.expectedRevenue > 0 ? (totals.expectedNet / totals.expectedRevenue) * 100 : null;
  totals.netCash = totals.cashIn - totals.cashOut;

  for (const row of months.values()) {
    row.netCash = row.cashIn - row.cashOut;
  }
  for (const row of clients.values()) {
    row.marginPct =
      row.expectedRevenue > 0 ? (row.expectedNet / row.expectedRevenue) * 100 : null;
  }

  const expenseTotal = totals.expensesTotal;
  const expensesByCategory = [...byCategory.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      pct: expenseTotal > 0 ? (amount / expenseTotal) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    currency: reportCurrency,
    totals,
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
    expensesByCategory,
    clients: [...clients.values()].sort((a, b) => b.expectedRevenue - a.expectedRevenue),
    receivablesList: receivablesList.sort((a, b) => b.amount - a.amount),
    payablesList: payablesList.sort((a, b) => b.amount - a.amount),
    missingRates: [...missing],
  };
}
