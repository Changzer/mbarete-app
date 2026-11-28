"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, one } from "@/db";
import { bankAccounts, cashBalanceChecks, cashTransactions, operatingExpenses } from "@/db/schema";
import { requireAdmin, requireModuleAction } from "@/lib/authz";
import { canonicalCurrencyCode } from "@/lib/currency";
import { isTailongAccount } from "@/lib/operating-cash";
import {
  deleteUpload,
  FileTooLargeError,
  saveUploadedReceipt,
  StorageFullError,
  UnsupportedFileTypeError,
} from "@/lib/uploads";

const EXPENSE_CATEGORIES = [
  "rent",
  "utilities",
  "payroll",
  "taxes",
  "professional_fees",
  "software",
  "marketing",
  "travel",
  "office",
  "bank_fees",
  "other",
] as const;

type ActionResult = { error?: string };

function refresh() {
  revalidatePath("/[locale]/finance", "page");
}

async function session() {
  const user = await requireAdmin();
  await requireModuleAction(user, "finance");
  return user;
}

async function account(companyId: number, id: number) {
  const row = await db.select().from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.id, id)))
    .limit(1).then(one);
  if (!row || !row.trackBalance || !isTailongAccount(row)) return null;
  return row;
}

const money = z.coerce.number().positive();
const currency = z.string().trim().min(1).max(8).transform(canonicalCurrencyCode);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const accountId = z.coerce.number().int().positive();

async function optionalReceipt(companyId: number, formData: FormData) {
  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) return { receiptPath: "", receiptName: "" };
  try {
    return { receiptPath: await saveUploadedReceipt(companyId, file), receiptName: file.name || "receipt" };
  } catch (error) {
    if (error instanceof UnsupportedFileTypeError) return { error: "receiptType" as const };
    if (error instanceof FileTooLargeError) return { error: "receiptSize" as const };
    if (error instanceof StorageFullError) return { error: "storageFull" as const };
    throw error;
  }
}

const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: money,
  currency,
  spentOn: date,
  accountId,
  vendor: z.string().trim().max(160).default(""),
  note: z.string().trim().max(500).default(""),
});

export async function addOperatingExpense(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const user = await session();
  const parsed = expenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;
  const accountRow = await account(user.companyId, data.accountId);
  if (!accountRow?.openingDate) return { error: "notFound" };
  if (canonicalCurrencyCode(accountRow.currency) !== data.currency) return { error: "accountCurrency" };
  const receipt = await optionalReceipt(user.companyId, formData);
  if ("error" in receipt) return { error: receipt.error };
  await db.insert(operatingExpenses).values({ companyId: user.companyId, createdBy: user.id, ...data, ...receipt });
  refresh();
  return {};
}

export async function deleteOperatingExpense(id: number): Promise<void> {
  const user = await session();
  const row = await db.select().from(operatingExpenses)
    .where(and(eq(operatingExpenses.companyId, user.companyId), eq(operatingExpenses.id, id)))
    .limit(1).then(one);
  if (!row) return;
  await db.delete(operatingExpenses).where(eq(operatingExpenses.id, id));
  if (row.receiptPath) await deleteUpload(row.receiptPath);
  refresh();
}

const accountSchema = z.object({
  id: accountId,
  openingBalance: z.coerce.number().finite().default(0),
  openingDate: date,
});

export async function saveCashAccount(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const user = await session();
  const parsed = accountSchema.safeParse({
    id: formData.get("id"),
    openingBalance: formData.get("openingBalance") || "0",
    openingDate: formData.get("openingDate") || "",
  });
  if (!parsed.success) return { error: "invalid" };
  const { id, ...data } = parsed.data;
  const existing = await account(user.companyId, id);
  if (!existing) return { error: "notFound" };
  if (!existing.currency) return { error: "invalid" };
  await db.update(bankAccounts).set(data)
    .where(and(eq(bankAccounts.companyId, user.companyId), eq(bankAccounts.id, id)));
  refresh();
  return {};
}

const checkSchema = z.object({
  accountId,
  amount: z.coerce.number().finite(),
  checkedOn: date,
  note: z.string().trim().max(200).default(""),
});

export async function recordBalanceCheck(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const user = await session();
  const parsed = checkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;
  const accountRow = await account(user.companyId, data.accountId);
  if (!accountRow?.openingDate) return { error: "notFound" };
  await db.insert(cashBalanceChecks).values({ companyId: user.companyId, createdBy: user.id, ...data });
  refresh();
  return {};
}

const transactionSchema = z.object({
  kind: z.enum(["other_income", "transfer", "adjustment"]),
  direction: z.enum(["in", "out"]),
  amount: money,
  currency,
  transactedOn: date,
  accountId,
  destinationAccountId: z.coerce.number().int().positive().nullable().default(null),
  counterparty: z.string().trim().max(160).default(""),
  note: z.string().trim().max(500).default(""),
});

export async function addCashTransaction(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const user = await session();
  const parsed = transactionSchema.safeParse({
    ...Object.fromEntries(formData),
    destinationAccountId: formData.get("destinationAccountId") || null,
  });
  if (!parsed.success) return { error: "invalid" };
  const data = parsed.data;
  const source = await account(user.companyId, data.accountId);
  if (!source?.openingDate) return { error: "notFound" };
  if (canonicalCurrencyCode(source.currency) !== data.currency) return { error: "accountCurrency" };
  if (data.kind === "other_income" && data.direction !== "in") return { error: "invalid" };
  if (data.kind !== "transfer") data.destinationAccountId = null;
  if (data.kind === "transfer") {
    if (data.destinationAccountId === null || data.destinationAccountId === data.accountId) return { error: "invalid" };
    const destination = await account(user.companyId, data.destinationAccountId);
    if (!destination?.openingDate) return { error: "notFound" };
    if (canonicalCurrencyCode(destination.currency) !== data.currency) return { error: "accountCurrency" };
  }
  await db.insert(cashTransactions).values({ companyId: user.companyId, createdBy: user.id, ...data });
  refresh();
  return {};
}
