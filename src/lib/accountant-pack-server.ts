import fs from "node:fs/promises";
import path from "node:path";
import { db, one } from "@/db";
import { companies, orderDocuments, periodCloses } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getFinanceData } from "@/lib/queries/finance";
import { uploadsDir } from "@/lib/uploads";
import {
  buildAccountantPack,
  sha256Hex,
  type BuildPackInput,
  type BuiltPack,
  type PackFile,
} from "@/lib/accountant-pack";
import { buildAccountantXlsx } from "@/lib/accountant-xlsx";
import { filterFinanceInput, type Period } from "@/lib/finance-report";

/**
 * The server half of the pack: reads the database and the uploads volume,
 * feeds the pure assembler, and returns everything the route streams — or
 * just the digest, which is all closing a period needs. One assembly path
 * for both, so the digest the close records is by construction the digest
 * a regenerated pack computes.
 */

export const periodKey = (period: Period) =>
  period.from === period.to ? period.from : `${period.from}~${period.to}`;

export async function getPeriodClose(companyId: number, period: Period) {
  return db
    .select()
    .from(periodCloses)
    .where(and(eq(periodCloses.companyId, companyId), eq(periodCloses.period, periodKey(period))))
    .limit(1)
    .then(one);
}

export type AssembledPack = {
  built: BuiltPack;
  xlsx: Buffer;
  /** zip path → file bytes, resolved, verified and hashed */
  fileBuffers: Map<string, Buffer>;
  companyName: string;
};

export async function assembleAccountantPack(opts: {
  companyId: number;
  period: Period;
  reportCurrency: string;
  generatedBy: { id: number; email: string };
}): Promise<AssembledPack> {
  const { companyId, period } = opts;
  const [company, financeData, close] = await Promise.all([
    db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1).then(one),
    getFinanceData(companyId),
    getPeriodClose(companyId, period),
  ]);

  // Which orders the period touches decides which evidence travels along.
  const clipped = filterFinanceInput(financeData.orders, period);
  const orderNumberById = new Map(clipped.map((o) => [o.id, o.orderNumber]));

  const documents = clipped.length
    ? await db
        .select()
        .from(orderDocuments)
        .where(
          and(
            eq(orderDocuments.companyId, companyId),
            inArray(orderDocuments.orderId, [...orderNumberById.keys()]),
          ),
        )
    : [];

  // --- resolve, verify and hash every referenced upload --------------------
  const base = path.resolve(uploadsDir());
  const fileBuffers = new Map<string, Buffer>();
  const files: PackFile[] = [];
  const used = new Set<string>();

  const addFile = async (storedPath: string, orderNumber: string, fallbackName: string) => {
    if (!storedPath) return undefined;
    // Stored paths look like "/uploads/<...>"; anything else is not ours.
    const rel = storedPath.replace(/^\/uploads\//, "");
    const resolved = path.resolve(base, rel);
    // A stored path is a claim, not a right: it must stay inside the
    // uploads volume, and it must exist. Missing files degrade to an empty
    // reference rather than failing the whole pack.
    if (!resolved.startsWith(base + path.sep)) return undefined;
    const data = await fs.readFile(resolved).catch(() => null);
    if (!data) return undefined;
    let zipName = `files/${orderNumber}/${fallbackName || path.basename(rel)}`;
    // Two receipts named "slip.jpg" on one order must not overwrite each other.
    while (used.has(zipName)) zipName = zipName.replace(/(\.[^.\\/]*)?$/, `-1$1`);
    used.add(zipName);
    fileBuffers.set(zipName, data);
    files.push({ zipName, sha256: sha256Hex(data), bytes: data.length });
    return zipName;
  };

  for (const order of clipped) {
    for (const p of order.payments) {
      if (p.receiptPath) {
        p.receiptZipPath = await addFile(p.receiptPath, order.orderNumber, p.receiptName ?? "");
      }
    }
    for (const e of order.expenses) {
      if (e.receiptPath) {
        e.receiptZipPath = await addFile(e.receiptPath, order.orderNumber, e.receiptName ?? "");
      }
    }
  }
  for (const doc of documents) {
    const orderNumber = orderNumberById.get(doc.orderId);
    if (orderNumber) await addFile(doc.path, orderNumber, doc.originalName);
  }

  const input: BuildPackInput = {
    companyId,
    companyName: company?.name ?? "",
    period,
    reportCurrency: opts.reportCurrency,
    // buildAccountantPack re-clips internally; handing it the full input
    // keeps aging-as-of correct (it needs pre-period payments too). The
    // receiptZipPath mutations above landed on the same objects.
    orders: financeData.orders,
    rates: financeData.rates,
    generatedBy: opts.generatedBy,
    files,
    close: close ? { closedAt: close.closedAt, digest: close.packSha256 } : undefined,
  };
  const built = buildAccountantPack(input);

  const xlsx = await buildAccountantXlsx({
    companyName: input.companyName,
    period,
    report: built.report,
    receivables: built.aging.receivables,
    payables: built.aging.payables,
    cashRows: built.cashRows,
    expenseLines: built.expenseLines,
    generatedAt: built.manifest.generatedAt,
  });
  // The workbook joins the manifest (hash recorded) but stays out of the
  // close digest — its bytes embed the generation timestamp.
  built.manifest.entries.push({ path: "report.xlsx", sha256: sha256Hex(xlsx), bytes: xlsx.length });

  return { built, xlsx, fileBuffers, companyName: input.companyName };
}
