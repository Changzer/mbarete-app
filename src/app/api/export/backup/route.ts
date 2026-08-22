import { NextResponse } from "next/server";
import { ZipArchive } from "archiver";
import { Readable } from "stream";
import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "@/db";
import { sessionUser } from "@/lib/authz";
import { uploadsDir } from "@/lib/uploads";
import { isSaas } from "@/lib/deploy";

/**
 * GET /api/export/backup — the whole tenant as one zip, admin-only.
 *
 * Tenants own their data: this is the take-it-with-you export and the poor
 * man's backup in one. Every business table the company owns, one CSV each,
 * scoped by company_id in SQL — the same wall every query in the app uses —
 * plus every uploaded file under files/: product photos, business cards,
 * order documents, payment slips. The paper trail travels with the records.
 *
 * Deliberately excluded: password hashes (a backup must never become a
 * credential dump), other tenants' anything, and the .variants resize cache
 * (derived data, regenerated on demand).
 *
 * The response streams: with years of photos the archive can run to
 * gigabytes, and it must never be held in memory whole.
 */

// Table name → WHERE column. All constants — nothing user-supplied ever
// reaches the SQL text.
const TABLES: { name: string; scope: "company_id" | "id"; omit?: string[] }[] = [
  { name: "companies", scope: "id" },
  { name: "company_profile", scope: "company_id" },
  { name: "bank_accounts", scope: "company_id" },
  { name: "users", scope: "company_id", omit: ["password_hash"] },
  { name: "categories", scope: "company_id" },
  { name: "products", scope: "company_id" },
  { name: "product_images", scope: "company_id" },
  { name: "product_suppliers", scope: "company_id" },
  { name: "contacts", scope: "company_id" },
  { name: "contact_images", scope: "company_id" },
  { name: "exchange_rates", scope: "company_id" },
  { name: "exchange_rate_history", scope: "company_id" },
  { name: "orders", scope: "company_id" },
  { name: "order_items", scope: "company_id" },
  { name: "order_documents", scope: "company_id" },
  { name: "order_payments", scope: "company_id" },
  { name: "order_expenses", scope: "company_id" },
  { name: "order_events", scope: "company_id" },
  { name: "entity_events", scope: "company_id" },
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[], omit: string[] = []): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]).filter((c) => !omit.includes(c));
  const lines = [cols.join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => csvCell(row[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

async function isDir(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then((s) => s.isDirectory())
    .catch(() => false);
}

export async function GET() {
  const user = await sessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (user.role !== "admin") return new NextResponse("Forbidden", { status: 403 });

  const archive = new ZipArchive({ zlib: { level: 6 } });

  // The database rows are gathered up front (they are small); the file
  // entries are only registered here — archiver reads each from disk with
  // backpressure while the response streams.
  for (const table of TABLES) {
    const { rows } = await pool.query(
      `SELECT * FROM ${table.name} WHERE ${table.scope} = $1 ORDER BY 1`,
      [user.companyId],
    );
    archive.append(toCsv(rows, table.omit), { name: `${table.name}.csv` });
  }

  // The company's uploads folder: photos, cards, documents, slips.
  const base = uploadsDir();
  const companyDir = path.join(/* turbopackIgnore: true */ base, `c${user.companyId}`);
  if (await isDir(companyDir)) {
    archive.directory(companyDir, `files/c${user.companyId}`);
  }
  // A self-hosted install's pre-tenancy files sit flat in the uploads root
  // and all belong to its one company. In saas mode flat files are ownerless
  // legacy and stay out — a tenant only ever receives its own folder.
  if (!isSaas() && (await isDir(base))) {
    const entries = await fs.readdir(/* turbopackIgnore: true */ base, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        archive.file(path.join(base, entry.name), { name: `files/${entry.name}` });
      }
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  archive.append(
    [
      `Export of company ${user.companyId} on ${stamp}`,
      `Requested by user ${user.id} (${user.email})`,
      "",
      "One CSV per table, scoped to this company only.",
      "users.csv omits password hashes by design.",
      "Uploaded files (product photos, business cards, order documents,",
      "payment slips) are under files/ with the same paths the *_images,",
      "order_documents, order_payments and order_expenses CSVs reference.",
      "",
    ].join("\r\n"),
    { name: "README.txt" },
  );

  // Finalize without awaiting: entries are read and compressed as the client
  // consumes the stream. An error mid-stream can only truncate the download —
  // the zip's central directory then fails to parse, so a bad backup is
  // detectable, never silently partial.
  archive.finalize();

  return new NextResponse(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="backup-${stamp}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
