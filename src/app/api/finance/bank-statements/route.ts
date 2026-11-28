import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, one } from "@/db";
import { bankAccounts, bankStatementDocuments } from "@/db/schema";
import { companyLifecycleBlock, requireModuleAction, sessionUser } from "@/lib/authz";
import { limitedFormData, UploadBodyTooLargeError } from "@/lib/limited-form-data";
import { makeLimiter } from "@/lib/rate-limit";
import { reserveAiRead } from "@/lib/ai-budget";
import { recordAiUsage } from "@/lib/ai-usage";
import { visionProvider } from "@/lib/vision";
import { analyzeBankStatement, type BankStatementContext, type BankStatementRow } from "@/lib/bank-statement";
import { bankStatementDirection } from "@/lib/bank-statement-shared";
import { getFinanceIntakeOrders } from "@/lib/queries/finance";
import { deleteUpload, saveUploadedDocument } from "@/lib/uploads";
import { isTailongAccount, buildBankLedgerEntries, isDuplicateBankEntry, type BankLedgerEntry } from "@/lib/operating-cash";
import { getOperatingCashData } from "@/lib/queries/operating-cash";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_BODY_BYTES = 35 * 1024 * 1024;
const MAX_FILES = 10;
const limiter = makeLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

function draftEntry(row: BankStatementRow, accountId: number, currency: string, documentId: number, statementRow: string): BankLedgerEntry | null {
  const direction = bankStatementDirection(row.kind);
  if (!row.date || row.amount === null || !direction) return null;
  return {
    key: `draft-${documentId}-${statementRow}`,
    source: "cash_transaction",
    sourceId: null,
    accountId,
    date: row.date,
    kind: row.kind,
    direction,
    amount: row.amount,
    currency,
    description: row.description,
    counterparty: row.counterparty || row.description,
    reference: row.reference,
    orderId: row.orderId,
    receiptPath: "",
    statementDocumentId: documentId,
    statementRow,
  };
}

export async function POST(request: NextRequest) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin" || await companyLifecycleBlock(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    await requireModuleAction(user, "finance");
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!visionProvider()) return NextResponse.json({ error: "notConfigured" }, { status: 503 });

  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() ?? request.headers.get("host");
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (origin) {
    try {
      if (new URL(origin).host !== host) throw new Error("Origin mismatch");
    } catch {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  if (limiter.hit(`u${user.id}`)) return NextResponse.json({ error: "rate" }, { status: 429, headers: { "Retry-After": "3600" } });

  let form: FormData;
  try {
    form = await limitedFormData(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof UploadBodyTooLargeError) return NextResponse.json({ error: "size", maxMb: 35 }, { status: 413 });
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const accountId = Number(form.get("accountId"));
  const files = form.getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || files.length === 0 || files.length > MAX_FILES || files.some((file) => file.size > MAX_FILE_BYTES)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const account = await db.select().from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, user.companyId), eq(bankAccounts.id, accountId)))
    .limit(1).then(one);
  if (!account?.trackBalance || !account.openingDate || !isTailongAccount(account)) return NextResponse.json({ error: "notFound" }, { status: 404 });

  const orders = await getFinanceIntakeOrders(user.companyId);
  const context: BankStatementContext = { accountLabel: account.label, currency: account.currency, orders };
  const existing = buildBankLedgerEntries(await getOperatingCashData(user.companyId));
  const reviewed = [...existing];
  const results = [];

  for (const file of files) {
    let documentId = 0;
    let receiptPath = "";
    try {
      const sha256 = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
      const duplicate = await db.select({ id: bankStatementDocuments.id }).from(bankStatementDocuments)
        .where(and(eq(bankStatementDocuments.companyId, user.companyId), eq(bankStatementDocuments.accountId, accountId), eq(bankStatementDocuments.sha256, sha256)))
        .limit(1).then(one);
      if (duplicate) {
        results.push({ fileName: file.name, error: "duplicateFile", transactions: [] });
        continue;
      }
      receiptPath = await saveUploadedDocument(user.companyId, file);
      const [document] = await db.insert(bankStatementDocuments).values({
        companyId: user.companyId,
        accountId,
        path: receiptPath,
        originalName: file.name || "statement",
        sha256,
        createdBy: user.id,
      }).returning();
      documentId = document.id;
      const budget = await reserveAiRead({ companyId: user.companyId, userId: user.id });
      if (budget !== "ok") {
        results.push({ documentId, fileName: file.name, path: receiptPath, error: "limit", transactions: [] });
        continue;
      }
      const analysis = await analyzeBankStatement(file, context, (usage) => recordAiUsage({ companyId: user.companyId, userId: user.id, kind: "finance", images: 1, ...usage }));
      const transactions = analysis.transactions.map((row, index) => {
        const statementRow = String(index + 1);
        const candidate = draftEntry(row, accountId, account.currency, documentId, statementRow);
        const duplicate = candidate ? isDuplicateBankEntry(reviewed, candidate) : false;
        if (candidate && !duplicate) reviewed.push(candidate);
        return { ...row, id: `${documentId}:${index + 1}`, documentId, statementRow, duplicate };
      });
      results.push({ documentId, fileName: file.name, path: receiptPath, closingBalance: analysis.closingBalance, closingDate: analysis.closingDate, transactions });
    } catch (error) {
      console.error("Bank statement analysis failed", error);
      if (!documentId && receiptPath) await deleteUpload(receiptPath).catch(() => {});
      results.push({ documentId: documentId || undefined, fileName: file.name, path: documentId ? receiptPath : undefined, error: "read", transactions: [] });
    }
  }
  return NextResponse.json({ ok: true, account: { id: account.id, label: account.label, currency: account.currency }, results });
}
