import { db } from "@/db";
import {
  orders,
  orderItems,
  orderPayments,
  orderExpenses,
  contacts,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getExchangeRates, parseRatesSnapshot } from "@/lib/queries/orders";
import { computeSnapshotTotals } from "@/lib/calculations";
import type { FinanceOrderInput } from "@/lib/finance-report";

/**
 * Every order as the finance report wants it: expected figures computed with
 * the order's own rate snapshot (live rates only fill gaps, same rule as the
 * order page), plus its raw payments and expenses. Four selects, grouped in
 * memory — no per-order queries.
 */
export async function getFinanceData(companyId: number): Promise<{
  orders: FinanceOrderInput[];
  rates: Record<string, number>;
}> {
  // The company's orders scope everything else: rows in the child tables
  // belong to whichever order they hang off.
  const companyOrders = db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.companyId, companyId));

  const [orderRows, itemRows, paymentRows, expenseRows, rates] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        createdAt: orders.createdAt,
        displayCurrency: orders.displayCurrency,
        secondaryCurrency: orders.secondaryCurrency,
        commissionPct: orders.commissionPct,
        ratesSnapshot: orders.ratesSnapshot,
        clientName: contacts.companyName,
      })
      .from(orders)
      .leftJoin(contacts, eq(orders.clientId, contacts.id))
      .where(eq(orders.companyId, companyId)),
    db.select().from(orderItems).where(inArray(orderItems.orderId, companyOrders)),
    db.select().from(orderPayments).where(inArray(orderPayments.orderId, companyOrders)),
    db.select().from(orderExpenses).where(inArray(orderExpenses.orderId, companyOrders)),
    getExchangeRates(companyId),
  ]);

  const itemsByOrder = new Map<number, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }
  const paymentsByOrder = new Map<number, typeof paymentRows>();
  for (const p of paymentRows) {
    const list = paymentsByOrder.get(p.orderId) ?? [];
    list.push(p);
    paymentsByOrder.set(p.orderId, list);
  }
  const expensesByOrder = new Map<number, typeof expenseRows>();
  for (const e of expenseRows) {
    const list = expensesByOrder.get(e.orderId) ?? [];
    list.push(e);
    expensesByOrder.set(e.orderId, list);
  }

  const financeOrders: FinanceOrderInput[] = orderRows.map((order) => {
    let snapshot: Record<string, number> = {};
    try {
      snapshot = JSON.parse(order.ratesSnapshot || "{}");
    } catch {
      snapshot = {};
    }
    const effectiveRates = { ...rates, ...snapshot };

    const quote = order.displayCurrency;
    const items = itemsByOrder.get(order.id) ?? [];
    const totals = computeSnapshotTotals(
      items.map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unitPriceSnapshot,
        sellPrice: i.sellPriceSnapshot,
        currency: i.currencySnapshot,
        sellCurrency: i.sellCurrencySnapshot || i.currencySnapshot,
        moq: i.moqSnapshot,
        lineCbm: i.lineCbm,
        lineWeightKg: i.lineWeightKg,
        cartons: i.cartonsSnapshot,
      })),
      [quote],
      effectiveRates,
      order.commissionPct,
    );

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      clientName: order.clientName ?? "—",
      status: order.status,
      createdAt: order.createdAt,
      quoteCurrency: quote,
      expectedRevenue: totals.grandTotal[quote] ?? 0,
      expectedCost: totals.cost[quote] ?? 0,
      payments: (paymentsByOrder.get(order.id) ?? []).map((p) => ({
        direction: p.direction,
        amount: p.amount,
        currency: p.currency,
        paidOn: p.paidOn,
        account: p.account,
        rates: parseRatesSnapshot(p.ratesSnapshot),
        note: p.note,
        receiptPath: p.receiptPath || undefined,
        receiptName: p.receiptName || undefined,
      })),
      expenses: (expensesByOrder.get(order.id) ?? []).map((e) => ({
        category: e.category,
        amount: e.amount,
        currency: e.currency,
        spentOn: e.spentOn,
        rates: parseRatesSnapshot(e.ratesSnapshot),
        note: e.note,
        receiptPath: e.receiptPath || undefined,
        receiptName: e.receiptName || undefined,
      })),
    };
  });

  return { orders: financeOrders, rates };
}
