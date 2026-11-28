import assert from "node:assert/strict";
import test from "node:test";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";
const PDF_A = Buffer.from("%PDF-1.4\n% statement A\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const PDF_B = Buffer.from("%PDF-1.4\n% statement B\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

test("bank statement intake reviews multiple rows, blocks duplicates and reconciles the shared ledger", { timeout: 120_000 }, async () => {
  const browser = await chromium.launch();
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  let orderId, clientId, supplierId, productId, bankId;
  try {
    const account = (await sql.query("SELECT id,company_id FROM users WHERE email=$1", [EMAIL])).rows[0];
    const company = account.company_id;
    bankId = (await sql.query("SELECT id FROM bank_accounts WHERE company_id=$1 AND label='Tailong RMB' AND currency='CNY' AND track_balance=true", [company])).rows[0].id;
    await sql.query("UPDATE bank_accounts SET opening_balance=0,opening_date='2026-01-01' WHERE id=$1", [bankId]);
    clientId = (await sql.query("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client','Statement QA Client') RETURNING id", [company])).rows[0].id;
    supplierId = (await sql.query("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'supplier','Angel Packing') RETURNING id", [company])).rows[0].id;
    orderId = (await sql.query("INSERT INTO orders(company_id,order_number,client_id,status,created_by) VALUES ($1,'STATEMENT-QA',$2,'confirmed',$3) RETURNING id", [company, clientId, account.id])).rows[0].id;
    const category = (await sql.query("SELECT id FROM categories WHERE company_id=$1 ORDER BY id LIMIT 1", [company])).rows[0].id;
    productId = (await sql.query("INSERT INTO products(company_id,category_id,sku,name_en,name_zh,price,currency) VALUES ($1,$2,'STATEMENT-QA','Statement QA','',10,'CNY') RETURNING id", [company, category])).rows[0].id;
    await sql.query(
      `INSERT INTO order_items(company_id,order_id,product_id,quantity,unit_price_snapshot,currency_snapshot,moq_snapshot,line_total,line_cbm,line_weight_kg,supplier_id_snapshot,supplier_name_en_snapshot)
       VALUES ($1,$2,$3,1250,10,'CNY',1,12500,0.1,1,$4,'Angel Packing')`,
      [company, orderId, productId, supplierId],
    );

    const page = await browser.newPage();
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/, { timeout: 30_000 });
    await page.goto(`${BASE}/en/finance`);
    await page.getByTestId("intake-mode-bank").click();
    await page.getByTestId("bank-account").selectOption(String(bankId));
    await page.getByTestId("bank-files").setInputFiles([
      { name: "statement-a.pdf", mimeType: "application/pdf", buffer: PDF_A },
      { name: "statement-b.pdf", mimeType: "application/pdf", buffer: PDF_B },
    ]);
    await page.getByTestId("bank-analyze").click();
    await page.getByTestId("bank-review").waitFor({ timeout: 45_000 });

    const rows = page.locator('[data-testid^="bank-row-"]');
    assert.equal(await rows.count(), 3);
    const firstRowKey = (await rows.nth(0).getAttribute("data-testid")).replace("bank-row-", "");
    const documentId = firstRowKey.split(":")[0];
    assert.equal(await page.getByTestId(`bank-order-${firstRowKey}`).inputValue(), String(orderId));
    assert.equal(await page.getByTestId(`bank-amount-${firstRowKey}`).inputValue(), "20000");
    const supplierRowKey = (await rows.nth(1).getAttribute("data-testid")).replace("bank-row-", "");
    assert.equal(await page.getByTestId(`bank-supplier-${supplierRowKey}`).inputValue(), String(supplierId));
    const duplicateRowKey = (await rows.nth(2).getAttribute("data-testid")).replace("bank-row-", "");
    assert.equal(await page.getByTestId(`bank-select-${duplicateRowKey}`).isDisabled(), true);

    await page.getByTestId(`bank-select-${firstRowKey}`).check();
    await page.getByTestId(`bank-select-${supplierRowKey}`).check();
    await page.getByTestId(`bank-balance-${documentId}`).check();
    await page.getByTestId("bank-confirm").click();
    await page.getByTestId("bank-saved").waitFor({ timeout: 20_000 });
    assert.match(await page.getByTestId("bank-saved").innerText(), /2/);

    const payments = (await sql.query("SELECT direction,amount,currency,cash_account_id,statement_document_id,bank_reference,supplier_id FROM order_payments WHERE order_id=$1 ORDER BY direction", [orderId])).rows;
    assert.equal(payments.length, 2);
    assert.ok(payments.every((payment) => payment.cash_account_id === bankId && payment.statement_document_id === Number(documentId)));
    const incoming = payments.find((payment) => payment.direction === "in");
    const outgoing = payments.find((payment) => payment.direction === "out");
    assert.equal(Number(incoming.amount), 20000);
    assert.equal(incoming.bank_reference, "STATEMENT-IN");
    assert.equal(Number(outgoing.amount), 12500);
    assert.equal(outgoing.supplier_id, supplierId);

    const ledger = page.getByTestId("bank-ledger");
    await ledger.waitFor();
    assert.match(await ledger.innerText(), /Client payment/);
    assert.match(await ledger.innerText(), /Supplier payment/);
    assert.match(await ledger.innerText(), /7,500\.00 CNY/);
    await page.getByText("Difference: 0.00 CNY", { exact: false }).waitFor({ timeout: 15_000 });
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM cash_balance_checks WHERE account_id=$1 AND amount=7500", [bankId])).rows[0].n, 1);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM bank_statement_documents WHERE company_id=$1", [company])).rows[0].n, 2);

    await page.getByTestId("bank-discard").click();
    await page.getByTestId("bank-review").waitFor({ state: "detached" });
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM bank_statement_documents WHERE company_id=$1", [company])).rows[0].n, 1);
  } finally {
    if (orderId) {
      await sql.query("DELETE FROM order_payments WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM order_events WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM order_items WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM orders WHERE id=$1", [orderId]);
    }
    if (productId) await sql.query("DELETE FROM products WHERE id=$1", [productId]);
    if (clientId) await sql.query("DELETE FROM contacts WHERE id=$1", [clientId]);
    if (supplierId) await sql.query("DELETE FROM contacts WHERE id=$1", [supplierId]);
    if (bankId) {
      await sql.query("DELETE FROM cash_balance_checks WHERE account_id=$1", [bankId]);
      await sql.query("UPDATE bank_accounts SET opening_balance=0,opening_date='' WHERE id=$1", [bankId]);
      const documents = (await sql.query("SELECT id,path FROM bank_statement_documents WHERE original_name IN ('statement-a.pdf','statement-b.pdf')")).rows;
      await sql.query("DELETE FROM bank_statement_documents WHERE original_name IN ('statement-a.pdf','statement-b.pdf')");
      for (const document of documents) await unlink(path.join(process.env.UPLOADS_DIR ?? "uploads", document.path.slice("/uploads/".length))).catch(() => {});
    }
    await browser.close();
    await sql.end();
  }
});
