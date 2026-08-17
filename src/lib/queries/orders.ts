import { db } from "@/db";
import { orders, orderItems, contacts, exchangeRates } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function getExchangeRates() {
  const rows = await db.select().from(exchangeRates).all();
  return Object.fromEntries(rows.map((r) => [r.currencyCode, r.rateToUsd]));
}

export async function getOrders() {
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      displayCurrency: orders.displayCurrency,
      createdAt: orders.createdAt,
      clientName: contacts.companyName,
    })
    .from(orders)
    .leftJoin(contacts, eq(orders.clientId, contacts.id))
    .orderBy(desc(orders.createdAt))
    .all();

  return rows;
}

export async function getOrderById(id: number) {
  const order = db.select().from(orders).where(eq(orders.id, id)).get();
  if (!order) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id))
    .all();

  const client = db.select().from(contacts).where(eq(contacts.id, order.clientId)).get();

  return { order, items, client };
}

export function nextOrderNumber() {
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const suffix = String(Date.now()).slice(-6);
  return `ORD-${yyyymmdd}-${suffix}`;
}
