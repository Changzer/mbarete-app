/** Full 0039 → 0040 upgrade in an isolated, disposable database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  assert.ok(process.env.DATABASE_ADMIN_URL, "explicit test database admin URL required");
  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  const databaseName = `supplier_payment_${randomUUID().replaceAll("-", "")}`;
  const temporary = await mkdtemp(path.join(os.tmpdir(), "supplier-payment-"));
  const url = new URL(process.env.DATABASE_ADMIN_URL);
  url.pathname = `/${databaseName}`;
  const target = new Client({ connectionString: url.href });
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    await target.connect();
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const upTo = async (idx: number) => {
      const folder = path.join(temporary, `upto-${idx}`);
      const entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= idx);
      await mkdir(path.join(folder, "meta"), { recursive: true });
      await writeFile(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
      for (const entry of entries) await copyFile(`drizzle/${entry.tag}.sql`, path.join(folder, `${entry.tag}.sql`));
      return folder;
    };
    await migrate(drizzle(target), { migrationsFolder: await upTo(39) });

    const company = (await target.query("INSERT INTO companies (name) VALUES ('Upgrade QA') RETURNING id")).rows[0].id;
    const user = (await target.query("INSERT INTO users (company_id,email,password_hash,name) VALUES ($1,'upgrade@example.com','unused-test-hash','Upgrade QA') RETURNING id", [company])).rows[0].id;
    const supplier1 = (await target.query("INSERT INTO contacts (company_id,type,company_name) VALUES ($1,'supplier','Supplier One') RETURNING id", [company])).rows[0].id;
    const supplier2 = (await target.query("INSERT INTO contacts (company_id,type,company_name) VALUES ($1,'supplier','Supplier Two') RETURNING id", [company])).rows[0].id;
    const category = (await target.query("INSERT INTO categories (company_id,name_en,name_zh) VALUES ($1,'QA','测试') RETURNING id", [company])).rows[0].id;
    const product = (await target.query("INSERT INTO products (company_id,sku,name_en,name_zh,category_id,price) VALUES ($1,'QA-1','QA','测试',$2,20) RETURNING id", [company, category])).rows[0].id;

    const makeOrder = async (number: string) => (await target.query(
      "INSERT INTO orders (company_id,order_number,client_id,created_by) VALUES ($1,$2,$3,$4) RETURNING id",
      [company, number, supplier1, user],
    )).rows[0].id;
    const addLine = async (orderId: number, supplierId: number | null) => target.query(
      `INSERT INTO order_items (company_id,order_id,product_id,quantity,unit_price_snapshot,currency_snapshot,moq_snapshot,line_total,line_cbm,line_weight_kg,supplier_id_snapshot)
       VALUES ($1,$2,$3,10,15,'CNY',10,150,0.2,5,$4)`,
      [company, orderId, product, supplierId],
    );
    const addPayment = async (orderId: number, direction = "out") => (await target.query(
      "INSERT INTO order_payments (company_id,order_id,direction,amount,currency,paid_on) VALUES ($1,$2,$3,10,'CNY','2026-01-01') RETURNING id",
      [company, orderId, direction],
    )).rows[0].id;

    const single = await makeOrder("SINGLE");
    await addLine(single, supplier1);
    const singlePayment = await addPayment(single);
    const singleClientPayment = await addPayment(single, "in");

    const mixed = await makeOrder("MIXED");
    await addLine(mixed, supplier1);
    await addLine(mixed, supplier2);
    const mixedPayment = await addPayment(mixed);

    const unknown = await makeOrder("UNKNOWN");
    await addLine(unknown, supplier1);
    await addLine(unknown, null);
    const unknownPayment = await addPayment(unknown);

    await migrate(drizzle(target), { migrationsFolder: await upTo(40) });
    const rows = (await target.query("SELECT id,direction,supplier_id FROM order_payments ORDER BY id")).rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(byId.get(singlePayment).supplier_id, supplier1, "unambiguous single-supplier history is linked");
    assert.equal(byId.get(singleClientPayment).supplier_id, null, "client money is never supplier-allocated");
    assert.equal(byId.get(mixedPayment).supplier_id, null, "mixed history never guesses");
    assert.equal(byId.get(unknownPayment).supplier_id, null, "an unknown line prevents backfill");

    const otherCompany = (await target.query("INSERT INTO companies (name) VALUES ('Other') RETURNING id")).rows[0].id;
    const otherSupplier = (await target.query("INSERT INTO contacts (company_id,type,company_name) VALUES ($1,'supplier','Other') RETURNING id", [otherCompany])).rows[0].id;
    await assert.rejects(
      target.query("UPDATE order_payments SET supplier_id=$1 WHERE id=$2", [otherSupplier, mixedPayment]),
      (error: { code?: string }) => error.code === "23503",
    );
    await migrate(drizzle(target), { migrationsFolder: "drizzle" });
    assert.equal((await target.query('SELECT count(*)::int AS n FROM drizzle."__drizzle_migrations"')).rows[0].n, journal.entries.length, "repeat migration is a no-op");
    console.log("Supplier payment migration: safe backfill, mixed/unknown preservation, tenant FK and retry passed.");
  } finally {
    await target.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin.end();
    await rm(temporary, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
