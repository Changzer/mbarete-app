"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { orders, orderPayments, orderExpenses, orderDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireUser, requireAdmin } from "@/lib/authz";
import {
  saveUploadedDocument,
  saveUploadedReceipt,
  deleteUpload,
  UnsupportedFileTypeError,
  FileTooLargeError,
} from "@/lib/uploads";
import { logOrderEvent } from "@/lib/order-log";
import { getExchangeRates } from "@/lib/queries/orders";

async function requireSession() {
  return (await requireUser()).id;
}

/** Rows only ever attach to an order that exists; everything else 404s here. */
function requireOrder(orderId: number) {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) throw new Error("order not found");
  return order;
}

function refresh(orderId: number) {
  // Pattern form: routes live under /[locale]/…, so a literal locale-less
  // path would name a page that does not exist.
  revalidatePath("/[locale]/orders/[id]", "page");
  revalidatePath("/[locale]/orders/[id]/proforma", "page");
  revalidatePath("/[locale]/orders", "page");
  void orderId;
}

export type FinanceActionResult = { error?: string };

/**
 * The optional slip attached to money movements. Absent file → empty fields;
 * a bad file refuses the whole submission so a payment is never silently
 * recorded without the slip the user attached.
 */
async function readReceipt(
  formData: FormData,
): Promise<
  | { receiptPath: string; receiptName: string }
  | { error: "receiptType" | "receiptSize" }
> {
  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) {
    return { receiptPath: "", receiptName: "" };
  }
  try {
    const receiptPath = await saveUploadedReceipt(file);
    return { receiptPath, receiptName: file.name || "receipt" };
  } catch (err) {
    if (err instanceof FileTooLargeError) return { error: "receiptSize" };
    if (err instanceof UnsupportedFileTypeError) return { error: "receiptType" };
    throw err;
  }
}

// --- payments ----------------------------------------------------------------

const paymentSchema = z.object({
  direction: z.enum(["in", "out"]),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().min(1).max(8).transform((s) => s.toUpperCase()),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account: z.string().trim().max(32).default(""),
  note: z.string().default(""),
});

export async function addPayment(
  orderId: number,
  _prev: FinanceActionResult | undefined,
  formData: FormData,
): Promise<FinanceActionResult> {
  const userId = await requireSession();
  requireOrder(orderId);

  const parsed = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid" };

  const receipt = await readReceipt(formData);
  if ("error" in receipt) return { error: receipt.error };

  // Freeze today's rates onto the payment: what this money was worth the day
  // it was recorded must not drift when rates move later.
  const ratesSnapshot = JSON.stringify(await getExchangeRates());

  db.insert(orderPayments)
    .values({ orderId, createdBy: userId, ratesSnapshot, ...receipt, ...parsed.data })
    .run();
  logOrderEvent(orderId, userId, "payment_added", parsed.data);
  refresh(orderId);
  return {};
}

export async function deletePayment(orderId: number, paymentId: number) {
  await requireAdmin();
  const row = db
    .select()
    .from(orderPayments)
    .where(eq(orderPayments.id, paymentId))
    .get();
  // The orderId comes from the page; the row's own parent is what counts.
  if (!row || row.orderId !== orderId) return;
  db.delete(orderPayments).where(eq(orderPayments.id, paymentId)).run();
  if (row.receiptPath) await deleteUpload(row.receiptPath);
  const session = await auth();
  logOrderEvent(orderId, Number(session?.user?.id ?? 0) || null, "payment_removed", {
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
  currency: z.string().trim().min(1).max(8).transform((s) => s.toUpperCase()),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().default(""),
});

export async function addExpense(
  orderId: number,
  _prev: FinanceActionResult | undefined,
  formData: FormData,
): Promise<FinanceActionResult> {
  const userId = await requireSession();
  requireOrder(orderId);

  const parsed = expenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid" };

  const receipt = await readReceipt(formData);
  if ("error" in receipt) return { error: receipt.error };

  const ratesSnapshot = JSON.stringify(await getExchangeRates());

  db.insert(orderExpenses)
    .values({ orderId, createdBy: userId, ratesSnapshot, ...receipt, ...parsed.data })
    .run();
  logOrderEvent(orderId, userId, "expense_added", parsed.data);
  refresh(orderId);
  return {};
}

export async function deleteExpense(orderId: number, expenseId: number) {
  await requireAdmin();
  const row = db
    .select()
    .from(orderExpenses)
    .where(eq(orderExpenses.id, expenseId))
    .get();
  if (!row || row.orderId !== orderId) return;
  db.delete(orderExpenses).where(eq(orderExpenses.id, expenseId)).run();
  if (row.receiptPath) await deleteUpload(row.receiptPath);
  const session = await auth();
  logOrderEvent(orderId, Number(session?.user?.id ?? 0) || null, "expense_removed", {
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
  const userId = await requireSession();
  requireOrder(orderId);

  const kind = documentKind.safeParse(formData.get("kind"));
  const file = formData.get("file");
  if (!kind.success || !(file instanceof File) || file.size === 0) {
    return { error: "invalid" };
  }

  let path: string;
  try {
    path = await saveUploadedDocument(file);
  } catch (err) {
    // Which rule refused it matters: "too large" and "wrong format" call
    // for different next moves at the user's end.
    if (err instanceof FileTooLargeError) return { error: "size" };
    if (err instanceof UnsupportedFileTypeError) return { error: "file" };
    throw err;
  }

  db.insert(orderDocuments)
    .values({
      orderId,
      kind: kind.data,
      path,
      originalName: file.name || "document",
      sizeBytes: file.size,
      uploadedBy: userId,
    })
    .run();
  logOrderEvent(orderId, userId, "document_added", {
    kind: kind.data,
    name: file.name || "document",
  });
  refresh(orderId);
  return {};
}

export async function deleteOrderDocument(orderId: number, documentId: number) {
  await requireAdmin();
  const row = db
    .select()
    .from(orderDocuments)
    .where(eq(orderDocuments.id, documentId))
    .get();
  if (!row || row.orderId !== orderId) return;
  db.delete(orderDocuments).where(eq(orderDocuments.id, documentId)).run();
  // The DB row is the record; the file goes with it or it leaks in the volume.
  await deleteUpload(row.path);
  const session = await auth();
  logOrderEvent(orderId, Number(session?.user?.id ?? 0) || null, "document_removed", {
    kind: row.kind,
    name: row.originalName,
  });
  refresh(orderId);
}
