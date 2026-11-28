"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db, one } from "@/db";
import {
  bankAccounts,
  bankStatementDocuments,
  cashBalanceChecks,
  cashTransactions,
  operatingExpenses,
  orderExpenses,
  orderItems,
  orderPayments,
  orders,
} from "@/db/schema";
import { requireAdmin, requireModuleAction } from "@/lib/authz";
import { BANK_STATEMENT_KINDS, ORDER_EXPENSE_CATEGORIES, OPERATING_EXPENSE_CATEGORIES, bankStatementDirection } from "@/lib/bank-statement-shared";
import { buildBankLedgerEntries, isDuplicateBankEntry, isTailongAccount, type BankLedgerEntry } from "@/lib/operating-cash";
import { getOperatingCashData } from "@/lib/queries/operating-cash";
import { getExchangeRates } from "@/lib/queries/orders";
import { logOrderEvent, type OrderEventKind } from "@/lib/order-log";
import { deleteUpload } from "@/lib/uploads";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.coerce.number().int().positive();
const rowSchema = z.object({
  documentId: id,
  statementRow: z.string().regex(/^[1-9]\d{0,3}$/),
  kind: z.enum(BANK_STATEMENT_KINDS),
  date,
  description: z.string().trim().max(500).default(""),
  counterparty: z.string().trim().max(160).default(""),
  reference: z.string().trim().max(120).default(""),
  amount: z.coerce.number().finite().positive(),
  orderId: z.coerce.number().int().positive().nullable().default(null),
  supplierId: z.coerce.number().int().positive().nullable().default(null),
  expenseCategory: z.string().trim().max(40).default(""),
  destinationAccountId: z.coerce.number().int().positive().nullable().default(null),
  destinationAmount: z.coerce.number().finite().positive().nullable().default(null),
});
const payloadSchema = z.object({
  accountId: id,
  rows: z.array(rowSchema).min(1).max(200),
  balanceChecks: z.array(z.object({ documentId: id, amount: z.coerce.number().finite(), date, enabled: z.boolean().default(false) })).max(20).default([]),
});

export type StatementSaveResult = { error?: string; saved?: number; rowIds?: string[] };

async function cashAccount(companyId: number, id: number) {
  const row = await db.select().from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.id, id)))
    .limit(1).then(one);
  return row?.trackBalance && row.openingDate && isTailongAccount(row) ? row : null;
}

function candidate(row: z.infer<typeof rowSchema>, accountId: number, currency: string): BankLedgerEntry {
  return {
    key: `candidate-${row.documentId}-${row.statementRow}`,
    source: "cash_transaction",
    sourceId: null,
    accountId,
    date: row.date,
    kind: row.kind,
    direction: bankStatementDirection(row.kind) || "out",
    amount: row.amount,
    currency,
    description: row.description,
    counterparty: row.counterparty || row.description,
    reference: row.reference,
    orderId: row.orderId,
    receiptPath: "",
    statementDocumentId: row.documentId,
    statementRow: row.statementRow,
  };
}

function refresh() {
  revalidatePath("/[locale]/finance", "page");
  revalidatePath("/[locale]/orders", "page");
  revalidatePath("/[locale]/orders/[id]", "page");
}

export async function confirmBankStatementImport(payload: unknown): Promise<StatementSaveResult> {
  const user = await requireAdmin();
  await requireModuleAction(user, "finance");
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { error: "invalid" };
  const { accountId, rows, balanceChecks } = parsed.data;
  const account = await cashAccount(user.companyId, accountId);
  if (!account) return { error: "notFound" };

  const documentIds = [...new Set([...rows.map((row) => row.documentId), ...balanceChecks.map((check) => check.documentId)])];
  const documents = await db.select().from(bankStatementDocuments)
    .where(and(eq(bankStatementDocuments.companyId, user.companyId), inArray(bankStatementDocuments.id, documentIds)));
  if (documents.length !== documentIds.length || documents.some((document) => document.accountId !== accountId)) return { error: "notFound" };

  const invalid = new Set<string>();
  const keyOf = (row: { documentId: number; statementRow: string }) => `${row.documentId}:${row.statementRow}`;
  for (const row of rows) {
    const direction = bankStatementDirection(row.kind);
    if (!direction) invalid.add(keyOf(row));
    if (["client_payment", "supplier_payment", "order_expense"].includes(row.kind) && row.orderId === null) invalid.add(keyOf(row));
    if (row.kind === "order_expense" && !ORDER_EXPENSE_CATEGORIES.includes(row.expenseCategory as (typeof ORDER_EXPENSE_CATEGORIES)[number])) invalid.add(keyOf(row));
    if (row.kind === "operating_expense" && !OPERATING_EXPENSE_CATEGORIES.includes(row.expenseCategory as (typeof OPERATING_EXPENSE_CATEGORIES)[number])) invalid.add(keyOf(row));
    if (row.kind === "exchange" && (row.destinationAccountId === null || row.destinationAmount === null)) invalid.add(keyOf(row));
  }
  if (invalid.size > 0) return { error: "invalid", rowIds: [...invalid] };

  const orderIds = [...new Set(rows.flatMap((row) => row.orderId === null ? [] : [row.orderId]))];
  const orderRows = orderIds.length > 0 ? await db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.companyId, user.companyId), inArray(orders.id, orderIds))) : [];
  if (orderRows.length !== orderIds.length) return { error: "notFound" };
  const supplierRows = orderIds.length > 0 ? await db.select({ orderId: orderItems.orderId, supplierId: orderItems.supplierIdSnapshot }).from(orderItems)
    .where(and(eq(orderItems.companyId, user.companyId), inArray(orderItems.orderId, orderIds))) : [];
  for (const row of rows) {
    if (row.kind === "supplier_payment" && row.supplierId !== null && !supplierRows.some((supplier) => supplier.orderId === row.orderId && supplier.supplierId === row.supplierId)) invalid.add(keyOf(row));
  }
  if (invalid.size > 0) return { error: "invalid", rowIds: [...invalid] };

  let destination: typeof account | null = null;
  const exchange = rows.find((row) => row.kind === "exchange");
  if (exchange) {
    if (rows.some((row) => row.kind === "exchange" && (row.destinationAccountId !== exchange.destinationAccountId || row.destinationAmount === null))) return { error: "invalid" };
    destination = await cashAccount(user.companyId, exchange.destinationAccountId!);
    if (!destination || destination.id === account.id) return { error: "notFound" };
  }

  const reviewed = buildBankLedgerEntries(await getOperatingCashData(user.companyId));
  const duplicates = new Set<string>();
  for (const row of rows) {
    const entry = candidate(row, accountId, account.currency);
    if (isDuplicateBankEntry(reviewed, entry)) duplicates.add(keyOf(row));
    else reviewed.push(entry);
  }
  if (duplicates.size > 0) return { error: "duplicate", rowIds: [...duplicates] };

  const ratesSnapshot = JSON.stringify(await getExchangeRates(user.companyId));
  const events: { orderId: number; kind: OrderEventKind; payload: unknown }[] = [];
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const evidence = { bankReference: row.reference, statementDocumentId: row.documentId, statementRow: row.statementRow };
      const note = [row.description, row.reference ? `Ref ${row.reference}` : ""].filter(Boolean).join(" · ").slice(0, 1000);
      if (row.kind === "client_payment" || row.kind === "supplier_payment") {
        const direction = row.kind === "client_payment" ? "in" : "out";
        await tx.insert(orderPayments).values({
          companyId: user.companyId,
          orderId: row.orderId!,
          direction,
          supplierId: direction === "out" ? row.supplierId : null,
          amount: row.amount,
          currency: account.currency,
          paidOn: row.date,
          account: account.currency,
          cashAccountId: accountId,
          channel: "bank",
          ratesSnapshot,
          note,
          createdBy: user.id,
          ...evidence,
        });
        events.push({ orderId: row.orderId!, kind: "payment_added", payload: { direction, amount: row.amount, currency: account.currency, accountId, reference: row.reference } });
      } else if (row.kind === "order_expense") {
        await tx.insert(orderExpenses).values({
          companyId: user.companyId,
          orderId: row.orderId!,
          category: row.expenseCategory as (typeof ORDER_EXPENSE_CATEGORIES)[number],
          amount: row.amount,
          currency: account.currency,
          spentOn: row.date,
          accountId,
          ratesSnapshot,
          note,
          createdBy: user.id,
          ...evidence,
        });
        events.push({ orderId: row.orderId!, kind: "expense_added", payload: { category: row.expenseCategory, amount: row.amount, currency: account.currency, accountId } });
      } else if (row.kind === "operating_expense") {
        await tx.insert(operatingExpenses).values({
          companyId: user.companyId,
          category: row.expenseCategory,
          accountId,
          amount: row.amount,
          currency: account.currency,
          spentOn: row.date,
          vendor: row.counterparty || row.description.slice(0, 160),
          note,
          createdBy: user.id,
          ...evidence,
        });
      } else {
        const exchangeRow = row.kind === "exchange";
        await tx.insert(cashTransactions).values({
          companyId: user.companyId,
          kind: row.kind as "other_income" | "other_expense" | "exchange",
          direction: bankStatementDirection(row.kind) || "out",
          amount: row.amount,
          currency: account.currency,
          transactedOn: row.date,
          accountId,
          destinationAccountId: exchangeRow ? row.destinationAccountId : null,
          destinationAmount: exchangeRow ? row.destinationAmount : null,
          destinationCurrency: exchangeRow ? destination!.currency : "",
          counterparty: row.counterparty,
          note,
          createdBy: user.id,
          ...evidence,
        });
      }
    }
    for (const check of balanceChecks) {
      if (!check.enabled) continue;
      const document = documents.find((candidate) => candidate.id === check.documentId);
      await tx.insert(cashBalanceChecks).values({
        companyId: user.companyId,
        accountId,
        amount: check.amount,
        checkedOn: check.date,
        note: document ? `Statement: ${document.originalName}`.slice(0, 200) : "Bank statement",
        createdBy: user.id,
      });
    }
  });
  for (const event of events) await logOrderEvent(event.orderId, user.id, event.kind, event.payload);
  refresh();
  return { saved: rows.length };
}

export async function discardStatementDocuments(documentIds: number[]): Promise<{ error?: string }> {
  const user = await requireAdmin();
  await requireModuleAction(user, "finance");
  if (documentIds.length === 0 || documentIds.length > 20 || documentIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) return { error: "invalid" };
  const documents = await db.select().from(bankStatementDocuments)
    .where(and(eq(bankStatementDocuments.companyId, user.companyId), inArray(bankStatementDocuments.id, documentIds)));
  if (documents.length !== new Set(documentIds).size) return { error: "notFound" };
  const references = await Promise.all([
    db.select({ id: orderPayments.id }).from(orderPayments).where(and(eq(orderPayments.companyId, user.companyId), inArray(orderPayments.statementDocumentId, documentIds))).limit(1),
    db.select({ id: orderExpenses.id }).from(orderExpenses).where(and(eq(orderExpenses.companyId, user.companyId), inArray(orderExpenses.statementDocumentId, documentIds))).limit(1),
    db.select({ id: operatingExpenses.id }).from(operatingExpenses).where(and(eq(operatingExpenses.companyId, user.companyId), inArray(operatingExpenses.statementDocumentId, documentIds))).limit(1),
    db.select({ id: cashTransactions.id }).from(cashTransactions).where(and(eq(cashTransactions.companyId, user.companyId), inArray(cashTransactions.statementDocumentId, documentIds))).limit(1),
  ]);
  if (references.some((rows) => rows.length > 0)) return { error: "inUse" };
  await db.delete(bankStatementDocuments).where(and(eq(bankStatementDocuments.companyId, user.companyId), inArray(bankStatementDocuments.id, documentIds)));
  for (const document of documents) await deleteUpload(document.path);
  return {};
}
