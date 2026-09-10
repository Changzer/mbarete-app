import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { db, one } from "@/db";
import { orders, orderItems, orderDocuments } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { Locale } from "@/i18n/routing";
import type { SessionUser } from "@/lib/authz";
import { getCompanyProfile } from "@/lib/queries/settings";
import { getOrderExportData } from "@/lib/export/order-export";
import { buildOrderPdf } from "@/lib/export/order-pdf";
import {
  uploadsDir,
  saveUploadedDocument,
  saveUploadedVideo,
  FileTooLargeError,
  StorageFullError,
  UnsupportedFileTypeError,
} from "@/lib/uploads";
import { logOrderEvent } from "@/lib/order-log";
import {
  DOSSIER_ITEMS,
  DOSSIER_KINDS,
  FAPIAO_TYPES,
  computeDossierStatus,
  dossierFileName,
  dossierFolderName,
  dossierItem,
  type FapiaoType,
  type TaxRegime,
} from "@/lib/dossier";
import {
  buildDossierReadme,
  catalogRows,
  dossierDigest,
  sha256Hex,
  type DossierEntry,
  type DossierManifest,
} from "@/lib/dossier-pack";

/**
 * The database and file-system half of the dossier: storing an upload
 * against a checklist item, and assembling the zip the accountant files.
 */

export type StoreResult = { error?: "invalid" | "size" | "storageFull" | "file" | "notFound" };

/** Saves one file as a dossier document. The caller has already checked the session and module. */
export async function storeDossierDocument(
  user: SessionUser,
  orderId: number,
  kind: string,
  fapiaoType: string | null,
  file: File,
): Promise<StoreResult> {
  const item = dossierItem(kind);
  if (!item || !(file instanceof File) || file.size === 0) return { error: "invalid" };
  const order = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.companyId, user.companyId), eq(orders.id, orderId)))
    .limit(1)
    .then(one);
  if (!order) return { error: "notFound" };
  let fapiao: FapiaoType | null = null;
  if (kind === "supplier_invoice") {
    if (!fapiaoType || !FAPIAO_TYPES.includes(fapiaoType as FapiaoType)) return { error: "invalid" };
    fapiao = fapiaoType as FapiaoType;
  }
  let storedPath: string;
  try {
    storedPath = item.video
      ? await saveUploadedVideo(user.companyId, file)
      : await saveUploadedDocument(user.companyId, file);
  } catch (err) {
    if (err instanceof FileTooLargeError) return { error: "size" };
    if (err instanceof StorageFullError) return { error: "storageFull" };
    if (err instanceof UnsupportedFileTypeError) return { error: "file" };
    throw err;
  }
  await db.insert(orderDocuments).values({
    companyId: user.companyId,
    orderId,
    kind: kind as (typeof orderDocuments.$inferInsert)["kind"],
    fapiaoType: fapiao,
    path: storedPath,
    originalName: file.name || "document",
    sizeBytes: file.size,
    uploadedBy: user.id,
  });
  await logOrderEvent(orderId, user.id, "document_added", {
    kind,
    fapiaoType: fapiao,
    name: file.name || "document",
  });
  return {};
}

export type AssembledDossier = {
  folder: string;
  entries: DossierEntry[];
  manifest: DossierManifest;
};

/**
 * The zip's contents for one order: numbered documents, an auto-generated
 * proforma when none was uploaded, the 目录 workbook, README and manifest.
 * Stored paths are claims, not rights: each must resolve inside the uploads
 * volume and exist, or it is left out and the 目录 shows ✗.
 */
export async function assembleDossier(opts: {
  companyId: number;
  orderId: number;
  locale: Locale;
  generatedBy: { id: number; email: string };
}): Promise<AssembledDossier | null> {
  const order = await db
    .select()
    .from(orders)
    .where(and(eq(orders.companyId, opts.companyId), eq(orders.id, opts.orderId)))
    .limit(1)
    .then(one);
  if (!order) return null;
  const [{ lines }] = await db
    .select({ lines: sql<number>`count(*)::int` })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  const docs = await db
    .select()
    .from(orderDocuments)
    .where(and(eq(orderDocuments.companyId, opts.companyId), eq(orderDocuments.orderId, order.id)));
  const profile = await getCompanyProfile(opts.companyId);

  const regime = order.taxRegime as TaxRegime;
  const dossierDocs = docs
    .filter((d) => DOSSIER_KINDS.includes(d.kind))
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      fapiaoType: d.fapiaoType,
      originalName: d.originalName,
      path: d.path,
      sizeBytes: d.sizeBytes,
    }));

  const folder = dossierFolderName(order.customsDeclarationNo, order.orderNumber);
  const base = path.resolve(uploadsDir());
  const entries: DossierEntry[] = [];
  const files: DossierManifest["files"] = [];
  const used = new Set<string>();
  const namesByItem = new Map<number, string[]>();
  const present = new Set<number>();

  const put = (name: string, data: Buffer | string) => {
    let unique = name;
    while (used.has(unique)) unique = unique.replace(/(\.[^./]*)?$/, "-1$1");
    used.add(unique);
    entries.push({ name: `${folder}/${unique}`, data });
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    files.push({ path: `${folder}/${unique}`, sha256: sha256Hex(buf), bytes: buf.length });
    return unique;
  };

  for (const def of DOSSIER_ITEMS) {
    for (const d of dossierDocs.filter((x) => x.kind === def.key)) {
      const rel = d.path.replace(/^\/uploads\//, "");
      const resolved = path.resolve(base, rel);
      if (!resolved.startsWith(base + path.sep)) continue;
      const data = await fs.readFile(resolved).catch(() => null);
      if (!data) continue;
      const name = put(dossierFileName(def, d.originalName), data);
      namesByItem.set(def.n, [...(namesByItem.get(def.n) ?? []), name]);
      present.add(def.n);
    }
  }

  // Item 8: the proforma the system prints, when nobody uploaded a signed one.
  const proforma = DOSSIER_ITEMS.find((i) => i.auto)!;
  if (!present.has(proforma.n) && lines > 0) {
    const data = await getOrderExportData(opts.companyId, order.id, opts.locale);
    if (data) {
      const pdf = await buildOrderPdf(data);
      const name = put(dossierFileName(proforma, `${order.orderNumber}.pdf`), pdf);
      namesByItem.set(proforma.n, [name]);
    }
  }

  // Status is judged on what actually went into the zip, not on rows whose
  // files have gone missing on disk.
  const inZip = dossierDocs.filter((d) => present.has(dossierItem(d.kind)?.n ?? -1));
  const status = computeDossierStatus(
    { taxRegime: regime, exportDate: order.exportDate ?? null, hasLines: lines > 0 },
    inZip,
  );

  const digest = dossierDigest(files);
  const generatedAt = new Date().toISOString();

  // 00_单证目录.xlsx — the accountant's sheet, ticked.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("单证目录");
  ws.columns = [{ width: 6 }, { width: 22 }, { width: 30 }, { width: 8 }, { width: 16 }, { width: 44 }, { width: 50 }];
  ws.addRow(["出口退税/免税-单证资料表 / Export rebate dossier"]);
  ws.addRow([`报关单号 / Customs declaration no.: ${order.customsDeclarationNo ?? ""}`]);
  ws.addRow([`订单号 / Order: ${order.orderNumber}`]);
  ws.addRow([`申报方式 / Regime: ${regime}`]);
  ws.addRow([
    `外销合同日期 ${order.exportContractDate ?? ""}`,
    `工厂合同日期 ${order.purchaseContractDate ?? ""}`,
    `入库日期 ${order.warehouseInDate ?? ""}`,
    `出库日期(申报日期) ${order.exportDate ?? ""}`,
  ]);
  ws.addRow([]);
  const header = ws.addRow(["#", "目录", "Item", "勾选", "状态 / Status", "特别注意事项", "文件 / Files"]);
  header.font = { bold: true };
  for (const row of catalogRows(status, namesByItem)) {
    ws.addRow([row.n, row.zh, row.en, row.check, row.status, row.note, row.files]);
  }
  ws.addRow([]);
  ws.addRow(["备注：上表资料，以报关单命名文件夹，汇总发送至会计处进行电子存档。"]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  put("00_单证目录.xlsx", xlsx);

  const readme = buildDossierReadme({
    companyName: profile?.companyName ?? "",
    orderNumber: order.orderNumber,
    customsDeclarationNo: order.customsDeclarationNo,
    regime,
    deadlines: status.deadlines,
    exportDate: order.exportDate ?? null,
    generatedAt,
    digest,
  });
  put("README.txt", readme);

  const manifest: DossierManifest = {
    version: 1,
    order: { id: order.id, number: order.orderNumber, customsDeclarationNo: order.customsDeclarationNo },
    regime,
    generatedAt,
    generatedBy: opts.generatedBy,
    digest,
    files,
  };
  entries.push({ name: `${folder}/manifest.json`, data: JSON.stringify(manifest, null, 2) });
  return { folder, entries, manifest };
}
