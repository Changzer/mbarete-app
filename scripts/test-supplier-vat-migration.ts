/** Full 0031 → 0032 upgrade in an isolated, disposable database. */
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
  const databaseName = `vat_upgrade_${randomUUID().replaceAll("-", "")}`;
  const temporary = await mkdtemp(path.join(os.tmpdir(), "vat-upgrade-"));
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
    const previous = journal.entries.filter((e: { idx: number }) => e.idx <= 31);
    await mkdir(path.join(temporary, "meta"));
    await writeFile(path.join(temporary, "meta/_journal.json"), JSON.stringify({ ...journal, entries: previous }));
    for (const entry of previous) await copyFile(`drizzle/${entry.tag}.sql`, path.join(temporary, `${entry.tag}.sql`));
    await migrate(drizzle(target), { migrationsFolder: temporary });
    const company = (await target.query("INSERT INTO companies (name) VALUES ('Upgrade QA') RETURNING id")).rows[0].id;
    const user = (await target.query("INSERT INTO users (company_id,email,password_hash,name) VALUES ($1,'upgrade@example.com','unused-test-hash','Upgrade QA') RETURNING id", [company])).rows[0].id;
    const contact = (await target.query("INSERT INTO contacts (company_id,type,company_name) VALUES ($1,'supplier','Current, not historical') RETURNING id", [company])).rows[0].id;
    const category = (await target.query("INSERT INTO categories (company_id,name_en,name_zh) VALUES ($1,'QA','测试') RETURNING id", [company])).rows[0].id;
    const product = (await target.query("INSERT INTO products (company_id,sku,name_en,name_zh,category_id,price,supplier_id) VALUES ($1,'QA-1','QA','测试',$2,20,$3) RETURNING id", [company, category, contact])).rows[0].id;
    const order = (await target.query("INSERT INTO orders (company_id,order_number,client_id,status,created_by) VALUES ($1,'UPGRADE-QA',$2,'shipped',$3) RETURNING id", [company, contact, user])).rows[0].id;
    await target.query("INSERT INTO order_items (company_id,order_id,product_id,quantity,unit_price_snapshot,currency_snapshot,moq_snapshot,line_total,line_cbm,line_weight_kg) VALUES ($1,$2,$3,10,15,'USD',10,150,0.2,5)", [company, order, product]);
    await target.query("INSERT INTO product_suppliers (company_id,product_id,supplier_id,price,quoted_on) VALUES ($1,$2,$3,20,'2026-09-01')", [company, product, contact]);
    const productBefore = (await target.query("SELECT * FROM products WHERE id=$1", [product])).rows[0];
    const offerBefore = (await target.query("SELECT * FROM product_suppliers WHERE product_id=$1", [product])).rows[0];
    const before = (await target.query("SELECT * FROM order_items WHERE order_id=$1", [order])).rows[0];
    await migrate(drizzle(target), { migrationsFolder: "drizzle" });
    const after = (await target.query("SELECT * FROM order_items WHERE order_id=$1", [order])).rows[0];
    assert.deepEqual(after, before, "VAT migration must not rewrite historical order prices");
    for (const [table, beforeRow] of [["products", productBefore], ["product_suppliers", offerBefore]] as const) {
      const row = (await target.query(`SELECT * FROM ${table} WHERE id=$1`, [beforeRow.id])).rows[0];
      const { supplier_vat_pct, ...original } = row;
      assert.equal(Number(supplier_vat_pct), 0, "existing quotes stay tax-free");
      assert.deepEqual(original, beforeRow, "all original data retained");
      for (const bad of [-1, 101]) {
        await assert.rejects(target.query(`UPDATE ${table} SET supplier_vat_pct=$1 WHERE id=$2`, [bad, row.id]), /check constraint/);
      }
      await target.query(`UPDATE ${table} SET supplier_vat_pct=3 WHERE id=$1`, [row.id]);
    }
    await migrate(drizzle(target), { migrationsFolder: "drizzle" });
    assert.equal((await target.query('SELECT count(*)::int AS n FROM drizzle."__drizzle_migrations"')).rows[0].n, journal.entries.length, "repeat migration is a no-op");
    assert.equal((await target.query("SELECT relrowsecurity FROM pg_class WHERE relname='order_items'")).rows[0].relrowsecurity, true, "existing RLS remains enabled");
    console.log("Supplier VAT upgrade: base prices and historical orders preserved; zero defaults, bounds, retry and RLS passed.");
  } finally {
    await target.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin.end();
    await rm(temporary, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
