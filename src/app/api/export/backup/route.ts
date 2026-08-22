import { NextResponse } from "next/server";
import { ZipArchive } from "archiver";
import { PassThrough } from "stream";
import { pool } from "@/db";
import { sessionUser } from "@/lib/authz";

/**
 * GET /api/export/backup — the whole tenant as a zip of CSVs, admin-only.
 *
 * Tenants own their data: this is the take-it-with-you export and the poor
 * man's backup in one. Every business table the company owns, one CSV each,
 * scoped by company_id in SQL — the same wall every query in the app uses.
 *
 * Deliberately excluded: password hashes (a backup must never become a
 * credential dump) and other tenants' anything. Uploaded files are not in the
 * zip — they live in the uploads volume; the CSVs carry their paths.
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

export async function GET() {
  const user = await sessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (user.role !== "admin") return new NextResponse("Forbidden", { status: 403 });

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    out.on("finish", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });
  archive.pipe(out);

  for (const table of TABLES) {
    const { rows } = await pool.query(
      `SELECT * FROM ${table.name} WHERE ${table.scope} = $1 ORDER BY 1`,
      [user.companyId],
    );
    archive.append(toCsv(rows, table.omit), { name: `${table.name}.csv` });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  archive.append(
    [
      `Export of company ${user.companyId} on ${stamp}`,
      `Requested by user ${user.id} (${user.email})`,
      "",
      "One CSV per table, scoped to this company only.",
      "users.csv omits password hashes by design.",
      "Uploaded files are not included; their paths are in the *_images,",
      "order_documents, order_payments and order_expenses CSVs.",
      "",
    ].join("\r\n"),
    { name: "README.txt" },
  );

  await archive.finalize();
  const body = await done;

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="backup-${stamp}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
