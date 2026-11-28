/** Full 0044 → 0045 upgrade in an isolated, disposable database. */
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
  const databaseName = `tailong_cash_${randomUUID().replaceAll("-", "")}`;
  const temporary = await mkdtemp(path.join(os.tmpdir(), "tailong-cash-"));
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
    await migrate(drizzle(target), { migrationsFolder: await upTo(44) });

    const company = (await target.query("INSERT INTO companies (name) VALUES ('Tailong Cash Upgrade QA') RETURNING id")).rows[0].id;
    const usd = (await target.query(
      "INSERT INTO bank_accounts(company_id,label,currency,opening_balance,opening_date,track_balance) VALUES ($1,'Tailong USD','USD',123.45,'2026-01-01',false) RETURNING id",
      [company],
    )).rows[0].id;
    const cny = (await target.query(
      "INSERT INTO bank_accounts(company_id,label,currency,opening_balance,opening_date,track_balance) VALUES ($1,'Tailong RMB','CNY',1000,'2026-01-01',true) RETURNING id",
      [company],
    )).rows[0].id;
    const duplicate = (await target.query(
      "INSERT INTO bank_accounts(company_id,label,currency,track_balance) VALUES ($1,'Tailong duplicate','CNY',true) RETURNING id",
      [company],
    )).rows[0].id;
    const xtransfer = (await target.query(
      "INSERT INTO bank_accounts(company_id,label,currency,track_balance) VALUES ($1,'XTransfer-HK','USD',true) RETURNING id",
      [company],
    )).rows[0].id;
    const emptyCompany = (await target.query("INSERT INTO companies (name) VALUES ('Tailong Cash Empty QA') RETURNING id")).rows[0].id;

    await migrate(drizzle(target), { migrationsFolder: await upTo(45) });

    for (const companyId of [company, emptyCompany]) {
      const rows = (await target.query(
        "SELECT label,currency FROM bank_accounts WHERE company_id=$1 AND track_balance=true ORDER BY currency",
        [companyId],
      )).rows;
      assert.deepEqual(rows, [
        { label: "Tailong RMB", currency: "CNY" },
        { label: "Tailong USD", currency: "USD" },
      ]);
    }
    assert.deepEqual((await target.query(
      "SELECT opening_balance::float8 AS balance,opening_date,track_balance FROM bank_accounts WHERE id=$1",
      [usd],
    )).rows[0], { balance: 123.45, opening_date: "2026-01-01", track_balance: true });
    assert.equal((await target.query("SELECT track_balance FROM bank_accounts WHERE id=$1", [cny])).rows[0].track_balance, true);
    assert.equal((await target.query("SELECT track_balance FROM bank_accounts WHERE id=$1", [duplicate])).rows[0].track_balance, false);
    assert.equal((await target.query("SELECT track_balance FROM bank_accounts WHERE id=$1", [xtransfer])).rows[0].track_balance, false);
    await assert.rejects(
      target.query("INSERT INTO bank_accounts(company_id,label,currency,track_balance) VALUES ($1,'Tailong second RMB','CNY',true)", [company]),
      /bank_accounts_tracked_currency_uq/,
    );

    await migrate(drizzle(target), { migrationsFolder: "drizzle" });
    assert.equal((await target.query('SELECT count(*)::int AS n FROM drizzle."__drizzle_migrations"')).rows[0].n, journal.entries.length);
    console.log("Tailong cash migration: fixed pair, preserved balances, deduplication and retry passed.");
  } finally {
    await target.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin.end();
    await rm(temporary, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
