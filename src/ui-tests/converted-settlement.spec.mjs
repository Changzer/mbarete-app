import assert from "node:assert/strict";
import test from "node:test";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import pg from "pg";
import { openOrderSection } from "./order-section.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

test("an XTransfer conversion keeps the client's USD payment and Tailong CNY settlement in their own ledgers", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch();
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  let orderId, clientId, supplierId, productId, bankId;
  try {
    const account = (await sql.query("SELECT id,company_id FROM users WHERE email=$1", [EMAIL])).rows[0];
    const company = account.company_id;
    await sql.query(
      "INSERT INTO exchange_rates(company_id,currency_code,rate_to_usd) VALUES ($1,'CNY',0.14) ON CONFLICT(company_id,currency_code) DO UPDATE SET rate_to_usd=0.14",
      [company],
    );
    clientId = (await sql.query("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client','Conversion QA Client') RETURNING id", [company])).rows[0].id;
    supplierId = (await sql.query("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'supplier','Conversion QA Supplier') RETURNING id", [company])).rows[0].id;
    bankId = (await sql.query(
      "INSERT INTO bank_accounts(company_id,label,currency,opening_balance,opening_date,track_balance) VALUES ($1,'Tailong RMB','CNY',0,'2026-01-01',true) RETURNING id",
      [company],
    )).rows[0].id;
    orderId = (await sql.query(
      "INSERT INTO orders(company_id,order_number,client_id,status,display_currency,secondary_currency,rates_snapshot,created_by) VALUES ($1,'CONVERT-QA',$2,'confirmed','USD','CNY','{\"USD\":1,\"CNY\":0.14}',$3) RETURNING id",
      [company, clientId, account.id],
    )).rows[0].id;
    const category = (await sql.query("SELECT id FROM categories WHERE company_id=$1 ORDER BY id LIMIT 1", [company])).rows[0].id;
    productId = (await sql.query("INSERT INTO products(company_id,category_id,sku,name_en,name_zh,price,currency,sell_price,sell_currency) VALUES ($1,$2,'CONVERT-QA','Conversion QA','',10,'CNY',10,'USD') RETURNING id", [company, category])).rows[0].id;
    await sql.query(
      `INSERT INTO order_items(company_id,order_id,product_id,quantity,unit_price_snapshot,sell_price_snapshot,currency_snapshot,sell_currency_snapshot,moq_snapshot,line_total,line_cbm,line_weight_kg,supplier_id_snapshot,supplier_name_en_snapshot)
       VALUES ($1,$2,$3,1000,10,10,'CNY','USD',1,10000,0.1,1,$4,'Conversion QA Supplier')`,
      [company, orderId, productId, supplierId],
    );

    const page = await browser.newPage();
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/, { timeout: 30_000 });
    await page.goto(`${BASE}/en/orders/${orderId}`);
    await openOrderSection(page, "section-payments-in");
    const paymentForm = page.getByTestId("payment-form-in");
    await paymentForm.getByTestId("payment-channel").selectOption("xtransfer");
    await paymentForm.getByTestId("payment-amount").fill("10000");
    await paymentForm.getByTestId("payment-currency").fill("USD");
    await paymentForm.getByTestId("settlement-amount").fill("71200");
    await paymentForm.getByTestId("settlement-currency").fill("CNY");
    await paymentForm.getByTestId("settlement-account").selectOption(String(bankId));
    assert.match(await paymentForm.getByTestId("conversion-preview").innerText(), /7\.1200/);
    assert.match(await paymentForm.getByTestId("conversion-preview").innerText(), /228\.57 CNY/);
    await paymentForm.getByTestId("inbound-receipt").setInputFiles({ name: "inbound.pdf", mimeType: "application/pdf", buffer: PDF });
    await paymentForm.getByTestId("outbound-receipt").setInputFiles({ name: "outbound.pdf", mimeType: "application/pdf", buffer: PDF });
    await paymentForm.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByText("71200.00 CNY", { exact: false }).first().waitFor({ timeout: 15_000 });

    const payment = (await sql.query("SELECT * FROM order_payments WHERE order_id=$1", [orderId])).rows[0];
    assert.equal(payment.channel, "xtransfer");
    assert.equal(Number(payment.amount), 10000);
    assert.equal(payment.currency, "USD");
    assert.equal(Number(payment.settlement_amount), 71200);
    assert.equal(payment.settlement_currency, "CNY");
    assert.equal(payment.settlement_account_id, bankId);
    assert.equal(Number(payment.effective_rate), 7.12);
    assert.equal(Number(payment.conversion_cost), 228.57);
    assert.ok(payment.inbound_receipt_path && payment.outbound_receipt_path);

    await page.goto(`${BASE}/en/finance`);
    const accountCard = page.getByTestId(`cash-account-${bankId}`);
    assert.match(await accountCard.innerText(), /71,200\.00 CNY|71200\.00 CNY/);
    await page.getByTestId(`actual-balance-${bankId}`).fill("71200");
    await page.getByTestId(`check-form-${bankId}`).getByRole("button", { name: "Record balance check" }).click();
    await page.getByText("Difference: 0.00 CNY", { exact: false }).waitFor({ timeout: 15_000 });

    for (const file of [payment.inbound_receipt_path, payment.outbound_receipt_path]) {
      await unlink(path.join(process.env.UPLOADS_DIR ?? "uploads", file.slice("/uploads/".length))).catch(() => {});
    }
  } finally {
    if (orderId) {
      await sql.query("DELETE FROM order_payments WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM order_events WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM order_items WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM orders WHERE id=$1", [orderId]);
    }
    if (productId) await sql.query("DELETE FROM products WHERE id=$1", [productId]);
    if (bankId) {
      await sql.query("DELETE FROM cash_balance_checks WHERE account_id=$1", [bankId]);
      await sql.query("DELETE FROM bank_accounts WHERE id=$1", [bankId]);
    }
    if (clientId) await sql.query("DELETE FROM contacts WHERE id=$1", [clientId]);
    if (supplierId) await sql.query("DELETE FROM contacts WHERE id=$1", [supplierId]);
    await browser.close();
    await sql.end();
  }
});
