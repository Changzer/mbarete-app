"use server";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, one } from "@/db";
import { orderDocuments, orderExpenses, orderPayments, orders } from "@/db/schema";
import { requireAdmin, requireModuleAction } from "@/lib/authz";
import { canonicalCurrencyCode } from "@/lib/currency";
import { addExpense, addPayment, uploadOrderDocument, type FinanceActionResult } from "@/lib/actions/finance";
import { FINANCE_EXPENSE_CATEGORIES } from "@/lib/finance-intake";

const INTENTS = ["attach", "payment_in", "payment_out", "expense"] as const;
type IntakeIntent = (typeof INTENTS)[number];

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export async function saveFinanceIntake(
  _prev: FinanceActionResult | undefined,
  formData: FormData,
): Promise<FinanceActionResult> {
  const user = await requireAdmin();
  await requireModuleAction(user, "finance");

  const orderId = Number(formData.get("orderId"));
  const intent = String(formData.get("intent") ?? "") as IntakeIntent;
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !INTENTS.includes(intent)) return { error: "invalid" };
  const order = await db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.companyId, user.companyId), eq(orders.id, orderId)))
    .limit(1).then(one);
  if (!order) return { error: "notFound" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "invalid" };
  const expectedHash = String(formData.get("fileSha256") ?? "");
  const actualHash = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || actualHash !== expectedHash) return { error: "fileChanged" };

  if (intent === "attach") {
    const duplicate = await db.select({ id: orderDocuments.id }).from(orderDocuments)
      .where(and(
        eq(orderDocuments.companyId, user.companyId),
        eq(orderDocuments.orderId, orderId),
        eq(orderDocuments.originalName, file.name),
        eq(orderDocuments.sizeBytes, file.size),
      )).limit(1).then(one);
    if (duplicate) return { error: "duplicate" };
    const body = new FormData();
    body.set("kind", "other");
    body.set("file", file, file.name);
    return uploadOrderDocument(orderId, undefined, body);
  }

  const amount = Number(formData.get("amount"));
  const currency = canonicalCurrencyCode(String(formData.get("currency") ?? ""));
  const date = String(formData.get("date") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  if (!Number.isFinite(amount) || amount <= 0 || !currency || currency.length > 8 || !validDate(date)) {
    return { error: "invalid" };
  }

  if (intent === "expense") {
    const category = String(formData.get("category") ?? "") as (typeof FINANCE_EXPENSE_CATEGORIES)[number];
    if (!FINANCE_EXPENSE_CATEGORIES.includes(category)) {
      return { error: "invalid" };
    }
    const duplicate = await db.select({ id: orderExpenses.id }).from(orderExpenses)
      .where(and(
        eq(orderExpenses.companyId, user.companyId),
        eq(orderExpenses.orderId, orderId),
        eq(orderExpenses.receiptName, file.name),
        eq(orderExpenses.category, category),
        eq(orderExpenses.amount, amount),
        eq(orderExpenses.currency, currency),
        eq(orderExpenses.spentOn, date),
      )).limit(1).then(one);
    if (duplicate) return { error: "duplicate" };
    const body = new FormData();
    body.set("category", category);
    body.set("amount", String(amount));
    body.set("currency", currency);
    body.set("spentOn", date);
    body.set("note", note);
    body.set("receipt", file, file.name);
    return addExpense(orderId, undefined, body);
  }

  const direction = intent === "payment_in" ? "in" : "out";
  const duplicate = await db.select({ id: orderPayments.id }).from(orderPayments)
    .where(and(
      eq(orderPayments.companyId, user.companyId),
      eq(orderPayments.orderId, orderId),
      eq(orderPayments.receiptName, file.name),
      eq(orderPayments.direction, direction),
      eq(orderPayments.amount, amount),
      eq(orderPayments.currency, currency),
      eq(orderPayments.paidOn, date),
    )).limit(1).then(one);
  if (duplicate) return { error: "duplicate" };

  const body = new FormData();
  body.set("direction", direction);
  body.set("amount", String(amount));
  body.set("currency", currency);
  body.set("paidOn", date);
  body.set("account", canonicalCurrencyCode(String(formData.get("account") ?? "")));
  body.set("note", note);
  const supplierId = String(formData.get("supplierId") ?? "");
  if (intent === "payment_out" && supplierId) body.set("supplierId", supplierId);
  body.set("receipt", file, file.name);
  return addPayment(orderId, undefined, body);
}
