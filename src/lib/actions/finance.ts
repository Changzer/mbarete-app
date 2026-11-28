"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, one } from "@/db";
import { orders, orderItems, orderPayments, orderExpenses, orderDocuments, bankAccounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser, requireAdmin, requireModuleAction, type SessionUser } from "@/lib/authz";
import {
  saveUploadedDocument,
  saveUploadedReceipt,
  deleteUpload,
  UnsupportedFileTypeError,
  FileTooLargeError,
  StorageFullError,
} from "@/lib/uploads";
import { logOrderEvent } from "@/lib/order-log";
import { getExchangeRates } from "@/lib/queries/orders";
import { canonicalCurrencyCode } from "@/lib/currency";
import { calculateConversion } from "@/lib/conversion";
import { isTailongAccount } from "@/lib/operating-cash";

async function requireSession() {
  const user = await requireUser();
  // Payments, expenses and documents live on orders: they gate on the orders
  // module. The finance REPORT is the finance module, gated at its page.
  await requireModuleAction(user, "orders");
  return user;
}

/** Rows only attach to an order of the caller's company; anything else 404s. */
async function requireOrder(user: SessionUser, orderId: number) {
  const order = await db
    .select()
    .from(orders)
    .where(and(eq(orders.companyId, user.companyId), eq(orders.id, orderId)))
    .limit(1)
    .then(one);
  if (!order) throw new Error("order not found");
  return order;
}

function refresh(orderId: number) {
  // Pattern form: routes live under /[locale]/…, so a literal locale-less
  // path would name a page that does not exist.
  revalidatePath("/[locale]/orders/[id]", "page");
  revalidatePath("/[locale]/orders/[id]/proforma", "page");
  revalidatePath("/[locale]/orders", "page");
  revalidatePath("/[locale]/finance", "page");
  void orderId;
}

export type FinanceActionResult = { error?: string };

/**
 * The optional slip attached to money movements. Absent file → empty fields;
 * a bad file refuses the whole submission so a payment is never silently
 * recorded without the slip the user attached.
 */
async function readReceipt(
  companyId: number,
  formData: FormData,
  fieldName = "receipt",
): Promise<
  | { receiptPath: string; receiptName: string }
  | { error: "receiptType" | "receiptSize" | "storageFull" }
> {
  const file = formData.get(fieldName);
  if (!(file instanceof File) || file.size === 0) {
    return { receiptPath: "", receiptName: "" };
  }
  try {
    const receiptPath = await saveUploadedReceipt(companyId, file);
    return { receiptPath, receiptName: file.name || "receipt" };
  } catch (err) {
    if (err instanceof FileTooLargeError) return { error: "receiptSize" };
    if (err instanceof StorageFullError) return { error: "storageFull" };
    if (err instanceof UnsupportedFileTypeError) return { error: "receiptType" };
    throw err;
  }
}

// --- payments ----------------------------------------------------------------

const paymentSchema = z.object({
  direction: z.enum(["in", "out"]),
  channel: z.enum(["bank", "xtransfer"]).default("bank"),
  settlementAmount: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.coerce.number().positive().nullable(),
  ).default(null),
  settlementCurrency: z.string().trim().max(8).default("").transform(canonicalCurrencyCode),
  settlementAccountId: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.coerce.number().int().positive().nullable(),
  ).default(null),
  cashAccountId: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.coerce.number().int().positive().nullable(),
  ).default(null),
  supplierId: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.coerce.number().int().positive().nullable(),
  ).default(null),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().min(1).max(8).transform(canonicalCurrencyCode),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account: z.string().trim().max(32).default("").transform(canonicalCurrencyCode),
  note: z.string().default(""),
});

async function supplierOnOrder(companyId: number, orderId: number, supplierId: number) {
  return db
    .select({
      id: orderItems.supplierIdSnapshot,
      nameEn: orderItems.supplierNameEnSnapshot,
      nameZh: orderItems.supplierNameZhSnapshot,
    })
    .from(orderItems)
    .where(and(
      eq(orderItems.companyId, companyId),
      eq(orderItems.orderId, orderId),
      eq(orderItems.supplierIdSnapshot, supplierId),
    ))
    .limit(1)
    .then(one);
}

export async function addPayment(
  orderId: number,
  _prev: FinanceActionResult | undefined,
  formData: FormData,
): Promise<FinanceActionResult> {
  const user = await requireSession();
  await requireOrder(user, orderId);

  const parsed = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid" };
  if (parsed.data.direction === "in") parsed.data.supplierId = null;
  if (parsed.data.supplierId !== null &&
      !(await supplierOnOrder(user.companyId, orderId, parsed.data.supplierId))) {
    return { error: "invalidSupplier" };
  }

  const converted = parsed.data.settlementAmount !== null;
  if (parsed.data.channel === "xtransfer" && !converted) return { error: "settlementRequired" };
  let settlement = { effectiveRate: null as number | null, conversionCost: null as number | null };
  let documents: Record<string, string> = {};
  const rates = await getExchangeRates(user.companyId);
  if (converted) {
    if (parsed.data.direction !== "in" || !parsed.data.settlementCurrency || !parsed.data.settlementAccountId) {
      return { error: "invalid" };
    }
    const account = await db.select().from(bankAccounts)
      .where(and(eq(bankAccounts.companyId, user.companyId), eq(bankAccounts.id, parsed.data.settlementAccountId)))
      .limit(1).then(one);
    if (!account || !account.trackBalance || !account.openingDate || !isTailongAccount(account)) return { error: "invalidSettlementAccount" };
    if (canonicalCurrencyCode(account.currency) !== parsed.data.settlementCurrency) return { error: "accountCurrency" };
    settlement = calculateConversion({
      sourceAmount: parsed.data.amount,
      sourceCurrency: parsed.data.currency,
      settlementAmount: parsed.data.settlementAmount!,
      settlementCurrency: parsed.data.settlementCurrency,
      rates,
    });
    const inbound = await readReceipt(user.companyId, formData, "inboundReceipt");
    if ("error" in inbound) return { error: inbound.error };
    const outbound = await readReceipt(user.companyId, formData, "outboundReceipt");
    if ("error" in outbound) {
      if (inbound.receiptPath) await deleteUpload(inbound.receiptPath);
      return { error: outbound.error };
    }
    if (!inbound.receiptPath || !outbound.receiptPath) {
      if (inbound.receiptPath) await deleteUpload(inbound.receiptPath);
      if (outbound.receiptPath) await deleteUpload(outbound.receiptPath);
      return { error: "missingDocuments" };
    }
    documents = {
      inboundReceiptPath: inbound.receiptPath,
      inboundReceiptName: inbound.receiptName,
      outboundReceiptPath: outbound.receiptPath,
      outboundReceiptName: outbound.receiptName,
    };
  } else {
    if (parsed.data.cashAccountId !== null) {
      const account = await db.select().from(bankAccounts)
        .where(and(eq(bankAccounts.companyId, user.companyId), eq(bankAccounts.id, parsed.data.cashAccountId)))
        .limit(1).then(one);
      if (!account || !account.trackBalance || !account.openingDate || !isTailongAccount(account)) return { error: "invalidSettlementAccount" };
      if (canonicalCurrencyCode(account.currency) !== parsed.data.currency) return { error: "accountCurrency" };
    }
    const receipt = await readReceipt(user.companyId, formData);
    if ("error" in receipt) return { error: receipt.error };
    documents = receipt;
  }

  // Freeze today's rates onto the payment: what this money was worth the day
  // it was recorded must not drift when rates move later.
  const ratesSnapshot = JSON.stringify(rates);

  await db
    .insert(orderPayments)
    .values({ companyId: user.companyId, orderId, createdBy: user.id, ratesSnapshot, ...settlement, ...documents, ...parsed.data });
  await logOrderEvent(orderId, user.id, "payment_added", parsed.data);
  refresh(orderId);
  return {};
}

export async function assignPaymentSupplier(
  orderId: number,
  paymentId: number,
  supplierId: number | null,
): Promise<FinanceActionResult> {
  const user = await requireSession();
  await requireOrder(user, orderId);
  const row = await db
    .select()
    .from(orderPayments)
    .where(and(
      eq(orderPayments.companyId, user.companyId),
      eq(orderPayments.orderId, orderId),
      eq(orderPayments.id, paymentId),
    ))
    .limit(1)
    .then(one);
  if (!row || row.direction !== "out") return { error: "notFound" };
  const supplier = supplierId === null ? null : await supplierOnOrder(user.companyId, orderId, supplierId);
  if (supplierId !== null && !supplier) return { error: "invalidSupplier" };

  await db
    .update(orderPayments)
    .set({ supplierId })
    .where(and(eq(orderPayments.companyId, user.companyId), eq(orderPayments.id, paymentId)));
  await logOrderEvent(orderId, user.id, "payment_allocated", {
    amount: row.amount,
    currency: row.currency,
    supplier: supplier ? supplier.nameEn || supplier.nameZh : null,
  });
  refresh(orderId);
  return {};
}

export async function deletePayment(orderId: number, paymentId: number) {
  const admin = await requireAdmin();
  await requireModuleAction(admin, "orders");
  await requireOrder(admin, orderId);
  const row = await db
    .select()
    .from(orderPayments)
    .where(eq(orderPayments.id, paymentId))
    .limit(1)
    .then(one);
  // The orderId comes from the page; the row's own parent is what counts.
  if (!row || row.orderId !== orderId) return;
  await db.delete(orderPayments).where(eq(orderPayments.id, paymentId));
  if (row.receiptPath) await deleteUpload(row.receiptPath);
  await logOrderEvent(orderId, admin.id, "payment_removed", {
    direction: row.direction,
    amount: row.amount,
    currency: row.currency,
    paidOn: row.paidOn,
  });
  refresh(orderId);
}

// --- expenses ----------------------------------------------------------------

const expenseSchema = z.object({
  category: z.enum([
    "freight",
    "customs",
    "inspection",
    "local_transport",
    "bank_fees",
    "other",
  ]),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().min(1).max(8).transform(canonicalCurrencyCode),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.coerce.number().int().positive().nullable(),
  ).default(null),
  note: z.string().default(""),
});

export async function addExpense(
  orderId: number,
  _prev: FinanceActionResult | undefined,
  formData: FormData,
): Promise<FinanceActionResult> {
  const user = await requireSession();
  await requireOrder(user, orderId);

  const parsed = expenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid" };
  if (parsed.data.accountId !== null) {
    const account = await db.select().from(bankAccounts)
      .where(and(eq(bankAccounts.companyId, user.companyId), eq(bankAccounts.id, parsed.data.accountId)))
      .limit(1).then(one);
    if (!account || !account.trackBalance || !account.openingDate || !isTailongAccount(account)) return { error: "invalidSettlementAccount" };
    if (canonicalCurrencyCode(account.currency) !== parsed.data.currency) return { error: "accountCurrency" };
  }

  const receipt = await readReceipt(user.companyId, formData);
  if ("error" in receipt) return { error: receipt.error };

  const ratesSnapshot = JSON.stringify(await getExchangeRates(user.companyId));

  await db
    .insert(orderExpenses)
    .values({ companyId: user.companyId, orderId, createdBy: user.id, ratesSnapshot, ...receipt, ...parsed.data });
  await logOrderEvent(orderId, user.id, "expense_added", parsed.data);
  refresh(orderId);
  return {};
}

export async function deleteExpense(orderId: number, expenseId: number) {
  const admin = await requireAdmin();
  await requireModuleAction(admin, "orders");
  await requireOrder(admin, orderId);
  const row = await db
    .select()
    .from(orderExpenses)
    .where(eq(orderExpenses.id, expenseId))
    .limit(1)
    .then(one);
  if (!row || row.orderId !== orderId) return;
  await db.delete(orderExpenses).where(eq(orderExpenses.id, expenseId));
  if (row.receiptPath) await deleteUpload(row.receiptPath);
  await logOrderEvent(orderId, admin.id, "expense_removed", {
    category: row.category,
    amount: row.amount,
    currency: row.currency,
  });
  refresh(orderId);
}

// --- documents ---------------------------------------------------------------

const documentKind = z.enum([
  "supplier_invoice",
  "packing_list",
  "bill_of_lading",
  "inspection",
  "other",
]);

export async function uploadOrderDocument(
  orderId: number,
  _prev: FinanceActionResult | undefined,
  formData: FormData,
): Promise<FinanceActionResult> {
  const user = await requireSession();
  await requireOrder(user, orderId);

  const kind = documentKind.safeParse(formData.get("kind"));
  const file = formData.get("file");
  if (!kind.success || !(file instanceof File) || file.size === 0) {
    return { error: "invalid" };
  }

  let path: string;
  try {
    path = await saveUploadedDocument(user.companyId, file);
  } catch (err) {
    // Which rule refused it matters: "too large" and "wrong format" call
    // for different next moves at the user's end.
    if (err instanceof FileTooLargeError) return { error: "size" };
    if (err instanceof StorageFullError) return { error: "storageFull" };
    if (err instanceof UnsupportedFileTypeError) return { error: "file" };
    throw err;
  }

  await db.insert(orderDocuments)
    .values({
      companyId: user.companyId,
      orderId,
      kind: kind.data,
      path,
      originalName: file.name || "document",
      sizeBytes: file.size,
      uploadedBy: user.id,
    });
  await logOrderEvent(orderId, user.id, "document_added", {
    kind: kind.data,
    name: file.name || "document",
  });
  refresh(orderId);
  return {};
}

export async function deleteOrderDocument(orderId: number, documentId: number) {
  const admin = await requireAdmin();
  await requireModuleAction(admin, "orders");
  await requireOrder(admin, orderId);
  const row = await db
    .select()
    .from(orderDocuments)
    .where(eq(orderDocuments.id, documentId))
    .limit(1)
    .then(one);
  if (!row || row.orderId !== orderId) return;
  await db.delete(orderDocuments).where(eq(orderDocuments.id, documentId));
  // The DB row is the record; the file goes with it or it leaks in the volume.
  await deleteUpload(row.path);
  await logOrderEvent(orderId, admin.id, "document_removed", {
    kind: row.kind,
    name: row.originalName,
  });
  refresh(orderId);
}
