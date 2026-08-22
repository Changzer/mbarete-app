import {
  convert,
  roundMoney,
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
  payments: {
    direction: "in" | "out";
    amount: number;
    currency: string;
    paidOn: string;
    /** which bank account the money touched, e.g. "RMB" or "USD" */
    account?: string;
    /** the rate table frozen when the payment was recorded, when present */
    rates?: CurrencyRates;
  }[];
  expenses: {
    category: string;
    amount: number;
    currency: string;
    spentOn: string;
    rates?: CurrencyRates;
  }[];
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

/**
 * Where client money actually landed. XTransfer settlements often arrive
 * already converted to RMB; this is the view that says how much did, and how
 * much stayed in USD (or anything else).
 */
export type LandingRow = {
  /** the account tag, falling back to the payment's own currency */
  key: string;
  /** native sums per currency inside this bucket, e.g. { RMB: 7100 } */
  native: Record<string, number>;
  /** the bucket valued in the report currency */
  value: number;
  /** share of everything received */
  pct: number;
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
    /** Value of draft orders — 报价, quotes sent but not yet 下单/confirmed. */
    quotedRevenue: number;
    quotedOrders: number;
  };
  months: MonthRow[];
  expensesByCategory: { category: string; amount: number; pct: number }[];
  clients: ClientRow[];
  receivedByAccount: LandingRow[];
  receivablesList: OpenBalance[];
  payablesList: OpenBalance[];
  missingRates: string[];
};

const month = (isoDate: string) => isoDate.slice(0, 7);

/**
 * The whole business, one report.
 *
 * Only confirmed and shipped orders (下单) carry expected figures and open
 * balances: a draft is a quote (报价) — money you hope for, not money you are
 * owed — so drafts roll up separately as the quoted pipeline, and cancelled
 * orders count nowhere. Money that actually moved (payments, expenses) stays
 * in the cash flow whatever the status, because the bank account does not
 * forget a deposit taken on a draft or a cost sunk into a cancelled order.
 */
export function computeFinanceReport(
  orders: FinanceOrderInput[],
  reportCurrency: string,
  rates: CurrencyRates,
): FinanceReport {
  const missing = new Set<string>();
  const conv = (amount: number, from: string, own?: CurrencyRates) => {
    try {
      // Money that recorded its own day's rates is valued at them; the
      // report currency leg still needs today's table when the snapshot
      // does not carry the report currency.
      const table = own && own[reportCurrency] !== undefined ? own : rates;
      return convert(amount, from, reportCurrency, table);
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
    quotedRevenue: 0,
    quotedOrders: 0,
  };
  const months = new Map<string, MonthRow>();
  const landing = new Map<string, { native: Record<string, number>; value: number }>();
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
    // Only a confirmed or shipped order (下单) is expected money; a draft is
    // still just a quote (报价) and a cancelled order is nothing at all.
    const counted = order.status === "confirmed" || order.status === "shipped";

    // --- cash and expenses: real money, counted whatever the status --------
    let received = 0;
    let paidOut = 0;
    for (const p of order.payments) {
      const amount = conv(p.amount, p.currency, p.rates);
      const m = monthRow(month(p.paidOn));
      if (p.direction === "in") {
        received += amount;
        m.cashIn += amount;
        totals.cashIn += amount;

        // An untagged payment landed wherever its own currency says.
        const key = p.account?.trim() || p.currency;
        let bucket = landing.get(key);
        if (!bucket) {
          bucket = { native: {}, value: 0 };
          landing.set(key, bucket);
        }
        bucket.native[p.currency] = (bucket.native[p.currency] ?? 0) + p.amount;
        bucket.value += amount;
      } else {
        paidOut += amount;
        m.cashOut += amount;
        totals.cashOut += amount;
      }
    }
    let orderExpenses = 0;
    for (const e of order.expenses) {
      const amount = conv(e.amount, e.currency, e.rates);
      orderExpenses += amount;
      totals.expensesTotal += amount;
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + amount);
      const m = monthRow(month(e.spentOn));
      m.cashOut += amount;
      totals.cashOut += amount;
    }

    if (!counted) {
      if (order.status === "draft") {
        // The quoted pipeline: visible as its own figure, never as a
        // receivable — nobody owes money on an unconfirmed quote.
        totals.quotedOrders += 1;
        totals.quotedRevenue += conv(order.expectedRevenue, order.quoteCurrency);
      }
      continue;
    }

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

  // Every accumulated figure lands on exact cents before derived values are
  // taken from it, so the report's rows always reconcile to the totals.
  totals.expectedRevenue = roundMoney(totals.expectedRevenue);
  totals.expectedCost = roundMoney(totals.expectedCost);
  totals.expensesTotal = roundMoney(totals.expensesTotal);
  totals.cashIn = roundMoney(totals.cashIn);
  totals.cashOut = roundMoney(totals.cashOut);
  totals.receivables = roundMoney(totals.receivables);
  totals.payables = roundMoney(totals.payables);
  totals.quotedRevenue = roundMoney(totals.quotedRevenue);
  totals.expectedNet = roundMoney(
    totals.expectedRevenue - totals.expectedCost - totals.expensesTotal,
  );
  totals.marginPct =
    totals.expectedRevenue > 0 ? (totals.expectedNet / totals.expectedRevenue) * 100 : null;
  totals.netCash = roundMoney(totals.cashIn - totals.cashOut);

  for (const row of months.values()) {
    row.cashIn = roundMoney(row.cashIn);
    row.cashOut = roundMoney(row.cashOut);
    row.expectedRevenue = roundMoney(row.expectedRevenue);
    row.expectedNet = roundMoney(row.expectedNet);
    row.netCash = roundMoney(row.cashIn - row.cashOut);
  }
  for (const row of clients.values()) {
    row.expectedRevenue = roundMoney(row.expectedRevenue);
    row.expectedNet = roundMoney(row.expectedNet);
    row.outstanding = roundMoney(row.outstanding);
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

  const receivedByAccount: LandingRow[] = [...landing.entries()]
    .map(([key, bucket]) => ({
      key,
      native: bucket.native,
      value: bucket.value,
      pct: totals.cashIn > 0 ? (bucket.value / totals.cashIn) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    currency: reportCurrency,
    totals,
    receivedByAccount,
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
    expensesByCategory,
    clients: [...clients.values()].sort((a, b) => b.expectedRevenue - a.expectedRevenue),
    receivablesList: receivablesList.sort((a, b) => b.amount - a.amount),
    payablesList: payablesList.sort((a, b) => b.amount - a.amount),
    missingRates: [...missing],
  };
}
