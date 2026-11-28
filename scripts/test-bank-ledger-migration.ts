/** Full 0045 → 0046 upgrade in an isolated, disposable database. */
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
  const databaseName = `bank_ledger_${randomUUID().replaceAll("-", "")}`;
  const temporary = await mkdtemp(path.join(os.tmpdir(), "bank-ledger-"));
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
    await migrate(drizzle(target), { migrationsFolder: await upTo(45) });
    const company = (await target.query("INSERT INTO companies (name) VALUES ('Bank Ledger Upgrade QA') RETURNING id")).rows[0].id;
    const user = (await target.query("INSERT INTO users (company_id,email,password_hash,name) VALUES ($1,'bank-ledger@example.com','unused-test-hash','Bank Ledger QA') RETURNING id", [company])).rows[0].id;
    const account = (await target.query("SELECT id FROM bank_accounts WHERE company_id=$1 AND currency='CNY' AND track_balance=true", [company])).rows[0].id;

    await migrate(drizzle(target), { migrationsFolder: await upTo(46) });

    const columns = (await target.query(
      `SELECT table_name,column_name FROM information_schema.columns
       WHERE table_schema='public' AND (
         (table_name='order_payments' AND column_name IN ('cash_account_id','bank_reference','statement_document_id','statement_row'))
         OR (table_name='order_expenses' AND column_name IN ('account_id','bank_reference','statement_document_id','statement_row'))
         OR (table_name='cash_transactions' AND column_name IN ('destination_amount','destination_currency','statement_document_id','statement_row'))
       )`,
    )).rows;
    assert.equal(columns.length, 12);
    const document = (await target.query(
      "INSERT INTO bank_statement_documents(company_id,account_id,path,original_name,sha256,created_by) VALUES ($1,$2,'/uploads/c1/doc-qa.pdf','statement.pdf','qa-hash',$3) RETURNING id",
      [company, account, user],
    )).rows[0].id;
    await assert.rejects(
      target.query("INSERT INTO bank_statement_documents(company_id,account_id,path,original_name,sha256) VALUES ($1,$2,'/uploads/c1/doc-other.pdf','other.pdf','qa-hash')", [company, account]),
      /bank_statement_documents_company_account_sha_uq/,
    );
    await target.query(
      "INSERT INTO cash_transactions(company_id,kind,direction,amount,currency,transacted_on,account_id,statement_document_id,statement_row) VALUES ($1,'other_income','in',100,'CNY','2026-01-01',$2,$3,'1')",
      [company, account, document],
    );
    await assert.rejects(
      target.query("INSERT INTO cash_transactions(company_id,kind,direction,amount,currency,transacted_on,account_id,statement_document_id,statement_row) VALUES ($1,'other_income','in',100,'CNY','2026-01-01',$2,$3,'1')", [company, account, document]),
      /cash_transactions_statement_row_uq/,
    );
    const rls = (await target.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='bank_statement_documents'")).rows[0];
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });

    await migrate(drizzle(target), { migrationsFolder: "drizzle" });
    assert.equal((await target.query('SELECT count(*)::int AS n FROM drizzle."__drizzle_migrations"')).rows[0].n, journal.entries.length);
    console.log("Bank ledger migration: account links, statement evidence, uniqueness, RLS and retry passed.");
  } finally {
    await target.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin.end();
    await rm(temporary, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
