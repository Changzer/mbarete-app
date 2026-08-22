import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { Pool } from "pg";

/**
 * One-time upgrade: copies everything from the SQLite era's mbarete.db into
 * the Postgres database, under one company.
 *
 * Run inside the app container, where both the old data volume and the new
 * database are reachable:
 *
 *   docker compose exec mbarete-app npm run db:import-sqlite
 *
 * Idempotent by refusal: if Postgres already holds any products, contacts or
 * orders the script stops rather than doubling the catalog. Ids are preserved
 * exactly (sequences are bumped past them afterwards), so every stored
 * image path, order number and cross-reference survives.
 */

const SQLITE_PATH = path.join(process.env.DATABASE_DIR ?? "./data", "mbarete.db");
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://mbarete:mbarete@localhost:5432/mbarete";

type Row = Record<string, unknown>;

function tableExists(sqlite: Database.Database, name: string): boolean {
  return Boolean(
    sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name),
  );
}

function columns(sqlite: Database.Database, name: string): string[] {
  return (sqlite.prepare(`pragma table_info(${name})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`[import] no SQLite database at ${SQLITE_PATH} — nothing to import`);
    process.exit(1);
  }
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pool = new Pool({ connectionString: DATABASE_URL });
  const pg = await pool.connect();

  try {
    // Refuse to import into a database that already has business data.
    for (const table of ["products", "contacts", "orders"]) {
      const { rows } = await pg.query(`select 1 from ${table} limit 1`);
      if (rows.length > 0) {
        console.error(`[import] Postgres already has rows in ${table} — refusing to import twice`);
        process.exit(1);
      }
    }

    // The one company everything belongs to. The seed usually created it on
    // boot; create it here if the import runs first.
    let companyId: number;
    const existing = await pg.query("select id from companies order by id limit 1");
    if (existing.rows.length > 0) {
      companyId = existing.rows[0].id;
    } else {
      const created = await pg.query(
        "insert into companies (name) values ($1) returning id",
        [process.env.COMPANY_NAME ?? "Mbarete"],
      );
      companyId = created.rows[0].id;
    }

    await pg.query("begin");

    // The boot seed has usually already made the admin account, starter
    // categories and starter rates — the same rows the old database carries,
    // which would collide on ids and emails. The guard above proved no
    // business data references them, so the seeded copies step aside and the
    // originals come across with their history intact.
    await pg.query("update companies set owner_user_id = null where id = $1", [companyId]);
    for (const table of [
      "exchange_rate_history",
      "exchange_rates",
      "categories",
      "users",
      "company_profile",
      "bank_accounts",
      "entity_events",
    ]) {
      await pg.query(`delete from ${table} where company_id = $1`, [companyId]);
    }

    /**
     * Copies one table verbatim, filling company_id where the new schema
     * demands it and normalising SQLite's 0/1 into booleans. Columns the old
     * database never had (older installs) fall back to the schema defaults.
     */
    async function copy(
      table: string,
      opts: { addCompanyId?: boolean; boolCols?: string[]; skipCols?: string[] } = {},
    ) {
      if (!tableExists(sqlite, table)) {
        console.log(`[import] ${table}: not in the old database, skipped`);
        return;
      }
      const cols = columns(sqlite, table).filter((c) => !(opts.skipCols ?? []).includes(c));
      const rows = sqlite.prepare(`select * from ${table}`).all() as Row[];
      if (rows.length === 0) {
        console.log(`[import] ${table}: empty`);
        return;
      }
      const targetCols = [...cols, ...(opts.addCompanyId ? ["company_id"] : [])];
      const placeholders = targetCols.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `insert into ${table} (${targetCols.map((c) => `"${c}"`).join(", ")}) values (${placeholders})`;
      for (const row of rows) {
        const values = cols.map((c) =>
          (opts.boolCols ?? []).includes(c) ? Boolean(row[c]) : (row[c] ?? null),
        );
        if (opts.addCompanyId) values.push(companyId);
        await pg.query(sql, values);
      }
      console.log(`[import] ${table}: ${rows.length} rows`);
    }

    await copy("users", { addCompanyId: true, boolCols: ["active"] });
    // A database from before roles existed imported everyone as the schema
    // default (collaborator); those accounts had full power and keep it.
    if (tableExists(sqlite, "users") && !columns(sqlite, "users").includes("role")) {
      await pg.query("update users set role = 'admin' where company_id = $1", [companyId]);
      console.log("[import] users: promoted pre-role accounts to admin");
    }
    await copy("categories", { addCompanyId: true });
    await copy("contacts", { addCompanyId: true, boolCols: ["active"] });
    await copy("contact_images", { addCompanyId: true });
    await copy("products", { addCompanyId: true, boolCols: ["active"] });
    await copy("product_images", { addCompanyId: true });
    await copy("product_suppliers", { addCompanyId: true, boolCols: ["active"] });
    await copy("bank_accounts", { addCompanyId: true, boolCols: ["is_default"] });
    await copy("exchange_rates", { addCompanyId: true });
    await copy("exchange_rate_history", { addCompanyId: true });
    await copy("orders", { addCompanyId: true });
    await copy("order_items", { addCompanyId: true });
    await copy("order_documents", { addCompanyId: true });
    await copy("order_payments", { addCompanyId: true });
    await copy("order_expenses", { addCompanyId: true });
    await copy("order_events", { addCompanyId: true });
    await copy("entity_events", { addCompanyId: true });
    await copy("capture_drafts", { addCompanyId: true });
    await copy("capture_draft_images", { addCompanyId: true });

    // company_profile moved from "always id 1" to "keyed by company".
    if (tableExists(sqlite, "company_profile")) {
      const profile = sqlite.prepare("select * from company_profile limit 1").get() as
        | Row
        | undefined;
      if (profile) {
        const cols = Object.keys(profile).filter((c) => c !== "id");
        const targetCols = ["company_id", ...cols];
        const placeholders = targetCols.map((_, i) => `$${i + 1}`).join(", ");
        await pg.query(
          `insert into company_profile (${targetCols.map((c) => `"${c}"`).join(", ")}) values (${placeholders})
           on conflict (company_id) do nothing`,
          [companyId, ...cols.map((c) => profile[c] ?? null)],
        );
        console.log("[import] company_profile: 1 row");
      }
    }

    // The old owner: the first admin becomes the company owner.
    const owner = await pg.query(
      "select id from users where company_id = $1 and role = 'admin' order by id limit 1",
      [companyId],
    );
    if (owner.rows.length > 0) {
      await pg.query("update companies set owner_user_id = $1 where id = $2", [
        owner.rows[0].id,
        companyId,
      ]);
    }

    // Sequences must move past the ids we imported verbatim.
    const serialTables = [
      "users",
      "categories",
      "contacts",
      "contact_images",
      "products",
      "product_images",
      "product_suppliers",
      "bank_accounts",
      "orders",
      "order_items",
      "order_documents",
      "order_payments",
      "order_expenses",
      "order_events",
      "entity_events",
      "capture_drafts",
      "capture_draft_images",
      "companies",
    ];
    for (const table of serialTables) {
      await pg.query(
        `select setval(pg_get_serial_sequence('${table}', 'id'), coalesce((select max(id) from ${table}), 1))`,
      );
    }

    await pg.query("commit");
    console.log("[import] done — the SQLite file was left untouched as a backup");
  } catch (err) {
    await pg.query("rollback").catch(() => {});
    throw err;
  } finally {
    pg.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((err) => {
  console.error("[import] failed:", err);
  process.exit(1);
});
