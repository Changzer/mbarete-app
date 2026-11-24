import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import pg from "pg";
import { openOrderSection } from "./order-section.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

test("finance intake reviews a supplier receipt into shared order records and blocks duplicates", { timeout: 120_000 }, async () => {
  const browser = await chromium.launch();
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  let orderId, clientId, supplierId, productId;
  try {
    const account = (await sql.query("SELECT id,company_id FROM users WHERE email=$1", [EMAIL])).rows[0];
    const company = account.company_id;
    clientId = (await sql.query("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client','Intake QA Client') RETURNING id", [company])).rows[0].id;
    supplierId = (await sql.query("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'supplier','Angel Packing') RETURNING id", [company])).rows[0].id;
    orderId = (await sql.query("INSERT INTO orders(company_id,order_number,client_id,status,created_by) VALUES ($1,'INTAKE-QA',$2,'confirmed',$3) RETURNING id", [company, clientId, account.id])).rows[0].id;
    const category = (await sql.query("SELECT id FROM categories WHERE company_id=$1 ORDER BY id LIMIT 1", [company])).rows[0].id;
    productId = (await sql.query("INSERT INTO products(company_id,category_id,sku,name_en,name_zh,price,currency) VALUES ($1,$2,'INTAKE-QA','Intake QA','',10,'CNY') RETURNING id", [company, category])).rows[0].id;
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

    const uploadAndReview = async () => {
      await page.goto(`${BASE}/en/finance`);
      await page.getByTestId("intake-order").selectOption(String(orderId));
      await page.getByTestId("intake-intent").selectOption("payment_out");
      await page.getByTestId("intake-file").setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: PDF });
      await page.getByTestId("intake-analyze").click();
      await page.getByTestId("intake-review").waitFor({ timeout: 30_000 });
      assert.equal(await page.getByTestId("intake-amount").inputValue(), "12500");
      assert.equal(await page.getByTestId("intake-currency").inputValue(), "CNY");
      assert.equal(await page.getByTestId("intake-date").inputValue(), "2026-11-23");
      assert.equal(await page.getByTestId("intake-supplier").inputValue(), String(supplierId));
    };
    await uploadAndReview();
    await page.getByTestId("intake-save").click();
    await page.getByTestId("intake-saved").waitFor({ timeout: 15_000 });

    await page.goto(`${BASE}/en/orders/${orderId}`);
    await openOrderSection(page, "section-payments-out");
    const payments = page.getByTestId("section-payments-out");
    assert.match(await payments.innerText(), /12,500\.00 CNY|12500\.00 CNY/);
    assert.match(await payments.innerText(), /Slip/);
    const saved = (await sql.query("SELECT direction,amount,currency,supplier_id,receipt_name FROM order_payments WHERE order_id=$1", [orderId])).rows[0];
    assert.deepEqual(saved, { direction: "out", amount: "12500.00", currency: "CNY", supplier_id: supplierId, receipt_name: "receipt.pdf" });

    await uploadAndReview();
    await page.getByTestId("intake-save").click();
    await page.getByTestId("intake-error").waitFor();
    assert.match(await page.getByTestId("intake-error").innerText(), /already/);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM order_payments WHERE order_id=$1", [orderId])).rows[0].n, 1);
  } finally {
    if (orderId) {
      const files = (await sql.query("SELECT receipt_path FROM order_payments WHERE order_id=$1", [orderId])).rows;
      await sql.query("DELETE FROM order_payments WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM order_events WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM order_items WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM orders WHERE id=$1", [orderId]);
      const { unlink } = await import("node:fs/promises");
      const path = await import("node:path");
      for (const file of files) {
        if (file.receipt_path) await unlink(path.join(process.env.UPLOADS_DIR ?? "uploads", file.receipt_path.slice("/uploads/".length))).catch(() => {});
      }
    }
    if (productId) await sql.query("DELETE FROM products WHERE id=$1", [productId]);
    if (clientId) await sql.query("DELETE FROM contacts WHERE id=$1", [clientId]);
    if (supplierId) await sql.query("DELETE FROM contacts WHERE id=$1", [supplierId]);
    await browser.close();
    await sql.end();
  }
});
