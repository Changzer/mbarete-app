/** Full 0040 → 0041 upgrade in an isolated, disposable database. */
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
  const databaseName = `canonical_cny_${randomUUID().replaceAll("-", "")}`;
  const temporary = await mkdtemp(path.join(os.tmpdir(), "canonical-cny-"));
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
    await migrate(drizzle(target), { migrationsFolder: await upTo(40) });

    const company = (await target.query("INSERT INTO companies (name) VALUES ('CNY Upgrade QA') RETURNING id")).rows[0].id;
    const user = (await target.query("INSERT INTO users (company_id,email,password_hash,name) VALUES ($1,'cny-upgrade@example.com','unused-test-hash','CNY Upgrade QA') RETURNING id", [company])).rows[0].id;
    const contact = (await target.query("INSERT INTO contacts (company_id,type,company_name) VALUES ($1,'client','CNY QA Client') RETURNING id", [company])).rows[0].id;
    const category = (await target.query("INSERT INTO categories (company_id,name_en,name_zh) VALUES ($1,'QA','测试') RETURNING id", [company])).rows[0].id;
    const product = (await target.query(
      "INSERT INTO products (company_id,sku,name_en,name_zh,category_id,price,currency,sell_currency) VALUES ($1,'CNY-QA','QA','测试',$2,20,'RMB','RMB') RETURNING id",
      [company, category],
    )).rows[0].id;
    await target.query("INSERT INTO product_suppliers (company_id,product_id,price,currency,moq,quoted_on) VALUES ($1,$2,20,'RMB',1,'2026-01-01')", [company, product]);
    await target.query("INSERT INTO shipping_rates (company_id,destination,amount,currency,effective_from) VALUES ($1,'BR',10,'RMB','2026-01-01')", [company]);
    await target.query("INSERT INTO company_profile (company_id,functional_currency) VALUES ($1,'RMB')", [company]);
    await target.query("INSERT INTO bank_accounts (company_id,label,currency) VALUES ($1,'CNY QA Bank','RMB')", [company]);
    await target.query("INSERT INTO exchange_rates (company_id,currency_code,rate_to_usd) VALUES ($1,'CNY',0.14),($1,'RMB',0.15),($1,'USD',1)", [company]);
    const aliasOnlyCompany = (await target.query("INSERT INTO companies (name) VALUES ('RMB-only Upgrade QA') RETURNING id")).rows[0].id;
    await target.query("INSERT INTO exchange_rates (company_id,currency_code,rate_to_usd) VALUES ($1,'RMB',0.16)", [aliasOnlyCompany]);
    await target.query("INSERT INTO exchange_rate_history (company_id,day,currency_code,rate_to_usd) VALUES ($1,'2026-01-01','CNY',0.14),($1,'2026-01-01','RMB',0.15),($1,'2026-01-02','RMB',0.15)", [company]);
    const order = (await target.query(
      "INSERT INTO orders (company_id,order_number,client_id,created_by,display_currency,secondary_currency,rates_snapshot) VALUES ($1,'CNY-QA',$2,$3,'RMB','RMB','{\"USD\":1,\"CNY\":0.14,\"RMB\":0.15}') RETURNING id",
      [company, contact, user],
    )).rows[0].id;
    await target.query(
      `INSERT INTO order_items (company_id,order_id,product_id,quantity,unit_price_snapshot,currency_snapshot,sell_currency_snapshot,moq_snapshot,line_total,line_cbm,line_weight_kg)
       VALUES ($1,$2,$3,10,20,'RMB','RMB',1,200,0.2,5)`,
      [company, order, product],
    );
    await target.query(
      "INSERT INTO order_payments (company_id,order_id,direction,amount,currency,paid_on,account,rates_snapshot) VALUES ($1,$2,'in',200,'RMB','2026-01-01','RMB','{\"USD\":1,\"RMB\":0.15}')",
      [company, order],
    );
    await target.query(
      "INSERT INTO order_expenses (company_id,order_id,category,amount,currency,spent_on,rates_snapshot) VALUES ($1,$2,'freight',10,'RMB','2026-01-01','{\"USD\":1,\"CNY\":0.14,\"RMB\":0.15}')",
      [company, order],
    );
    await target.query(
      "INSERT INTO capture_drafts (company_id,client_id,captured_at,fields) VALUES ($1,'cny-draft','2026-01-01','{\"currency\":\"RMB\",\"sellCurrency\":\"RMB\"}')",
      [company],
    );

    await migrate(drizzle(target), { migrationsFolder: await upTo(41) });

    assert.deepEqual((await target.query("SELECT currency,sell_currency FROM products WHERE id=$1", [product])).rows[0], { currency: "CNY", sell_currency: "CNY" });
    assert.equal((await target.query("SELECT currency FROM product_suppliers WHERE product_id=$1", [product])).rows[0].currency, "CNY");
    assert.equal((await target.query("SELECT currency FROM shipping_rates WHERE company_id=$1", [company])).rows[0].currency, "CNY");
    assert.equal((await target.query("SELECT functional_currency FROM company_profile WHERE company_id=$1", [company])).rows[0].functional_currency, "CNY");
    assert.equal((await target.query("SELECT currency FROM bank_accounts WHERE company_id=$1", [company])).rows[0].currency, "CNY");
    assert.deepEqual((await target.query("SELECT currency_code,rate_to_usd::float8 AS rate FROM exchange_rates WHERE company_id=$1 ORDER BY currency_code", [company])).rows, [
      { currency_code: "CNY", rate: 0.14 },
      { currency_code: "USD", rate: 1 },
    ]);
    assert.deepEqual((await target.query("SELECT currency_code,rate_to_usd::float8 AS rate FROM exchange_rates WHERE company_id=$1", [aliasOnlyCompany])).rows, [
      { currency_code: "CNY", rate: 0.16 },
    ]);
    assert.deepEqual((await target.query("SELECT day,currency_code,rate_to_usd::float8 AS rate FROM exchange_rate_history WHERE company_id=$1 ORDER BY day", [company])).rows, [
      { day: "2026-01-01", currency_code: "CNY", rate: 0.14 },
      { day: "2026-01-02", currency_code: "CNY", rate: 0.15 },
    ]);
    const savedOrder = (await target.query("SELECT display_currency,secondary_currency,rates_snapshot FROM orders WHERE id=$1", [order])).rows[0];
    assert.equal(savedOrder.display_currency, "CNY");
    assert.equal(savedOrder.secondary_currency, "CNY");
    assert.deepEqual(JSON.parse(savedOrder.rates_snapshot), { USD: 1, CNY: 0.14 });
    assert.deepEqual((await target.query("SELECT currency_snapshot,sell_currency_snapshot FROM order_items WHERE order_id=$1", [order])).rows[0], { currency_snapshot: "CNY", sell_currency_snapshot: "CNY" });
    const payment = (await target.query("SELECT currency,account,rates_snapshot FROM order_payments WHERE order_id=$1", [order])).rows[0];
    assert.equal(payment.currency, "CNY");
    assert.equal(payment.account, "CNY");
    assert.deepEqual(JSON.parse(payment.rates_snapshot), { USD: 1, CNY: 0.15 });
    const expense = (await target.query("SELECT currency,rates_snapshot FROM order_expenses WHERE order_id=$1", [order])).rows[0];
    assert.equal(expense.currency, "CNY");
    assert.deepEqual(JSON.parse(expense.rates_snapshot), { USD: 1, CNY: 0.14 });
    const draft = (await target.query("SELECT fields FROM capture_drafts WHERE company_id=$1", [company])).rows[0];
    assert.deepEqual(JSON.parse(draft.fields), { currency: "CNY", sellCurrency: "CNY" });

    await migrate(drizzle(target), { migrationsFolder: "drizzle" });
    assert.equal((await target.query('SELECT count(*)::int AS n FROM drizzle."__drizzle_migrations"')).rows[0].n, journal.entries.length, "repeat migration is a no-op");
    console.log("Canonical CNY migration: columns, duplicate rates, snapshots, drafts and retry passed.");
  } finally {
    await target.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin.end();
    await rm(temporary, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
