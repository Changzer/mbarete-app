import { db, one } from "@/db";
import { orders, orderItems, contacts, exchangeRates, users, orderPayments, orderExpenses, orderDocuments } from "@/db/schema";
import { eq, and, desc, asc } from "drizzle-orm";

export async function getExchangeRates(companyId: number) {
  const rows = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.companyId, companyId));
  return Object.fromEntries(rows.map((r) => [r.currencyCode, r.rateToUsd]));
}

export async function getOrders(companyId: number) {
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      displayCurrency: orders.displayCurrency,
      createdAt: orders.createdAt,
      clientName: contacts.companyName,
      createdByName: users.name,
    })
    .from(orders)
    .leftJoin(contacts, eq(orders.clientId, contacts.id))
    .leftJoin(users, eq(orders.createdBy, users.id))
    .where(eq(orders.companyId, companyId))
    .orderBy(desc(orders.createdAt));

  return rows;
}

export async function getOrderById(companyId: number, id: number) {
  const order = await db
    .select()
    .from(orders)
    .where(and(eq(orders.companyId, companyId), eq(orders.id, id)))
    .limit(1)
    .then(one);
  if (!order) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id));

  const client = await db.select().from(contacts).where(eq(contacts.id, order.clientId)).limit(1).then(one);

  return { order, items, client };
}

export function nextOrderNumber() {
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const suffix = String(Date.now()).slice(-6);
  return `ORD-${yyyymmdd}-${suffix}`;
}

/** Everything attached to one order's money file, oldest first. */
export async function getOrderFinanceRows(orderId: number) {
  const [payments, expenses, documents] = await Promise.all([
    db
      .select()
      .from(orderPayments)
      .where(eq(orderPayments.orderId, orderId))
      .orderBy(asc(orderPayments.paidOn), asc(orderPayments.id)),
    db
      .select()
      .from(orderExpenses)
      .where(eq(orderExpenses.orderId, orderId))
      .orderBy(asc(orderExpenses.spentOn), asc(orderExpenses.id)),
    db
      .select()
      .from(orderDocuments)
      .where(eq(orderDocuments.orderId, orderId))
      .orderBy(asc(orderDocuments.createdAt), asc(orderDocuments.id)),
  ]);
  return { payments, expenses, documents };
}

/** A stored rates snapshot, or undefined when the row predates them. */
export function parseRatesSnapshot(json: string): Record<string, number> | undefined {
  try {
    const parsed = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" && Object.keys(parsed).length > 0
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}
