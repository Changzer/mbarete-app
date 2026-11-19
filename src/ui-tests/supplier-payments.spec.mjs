import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";

test("supplier payments allocate history and track each mixed-order balance", async () => {
  const browser = await chromium.launch();
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  let orderId, clientId;
  try {
    const account = (await sql.query("SELECT id,company_id FROM users WHERE email=$1", [EMAIL])).rows[0];
    const company = account.company_id;
    const makeContact = async (name, type) => (await sql.query(
      "INSERT INTO contacts(company_id,type,company_name) VALUES ($1,$2,$3) RETURNING id",
      [company, type, name],
    )).rows[0].id;
    const supplierA = await makeContact("Supplier A", "supplier");
    const supplierB = await makeContact("Supplier B", "supplier");
    clientId = await makeContact("Payment QA client", "client");
    orderId = (await sql.query("INSERT INTO orders(company_id,order_number,client_id,created_by) VALUES ($1,'PAY-QA',$2,$3) RETURNING id", [company, clientId, account.id])).rows[0].id;
    const category = (await sql.query("SELECT id FROM categories WHERE company_id=$1 ORDER BY id LIMIT 1", [company])).rows[0].id;
    const product = (await sql.query("INSERT INTO products(company_id,category_id,sku,name_en,name_zh,price,currency) VALUES ($1,$2,'PAY-QA','Payment QA','',10,'CNY') RETURNING id", [company, category])).rows[0].id;
    const addLine = async (supplierId, cost) => sql.query(
      `INSERT INTO order_items(company_id,order_id,product_id,quantity,unit_price_snapshot,currency_snapshot,moq_snapshot,line_total,line_cbm,line_weight_kg,supplier_id_snapshot,supplier_name_en_snapshot)
       VALUES ($1,$2,$3,10,10,'CNY',10,$4,0.1,1,$5,$6)`,
      [company, orderId, product, cost, supplierId, supplierId === supplierA ? "Supplier A" : "Supplier B"],
    );
    await addLine(supplierA, 1000);
    await addLine(supplierB, 500);
    const paymentId = (await sql.query(
      "INSERT INTO order_payments(company_id,order_id,direction,amount,currency,paid_on) VALUES ($1,$2,'out',200,'CNY','2026-01-01') RETURNING id",
      [company, orderId],
    )).rows[0].id;

    const page = await browser.newPage();
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/, { timeout: 30_000 });
    await page.goto(`${BASE}/en/orders/${orderId}`);
    await page.getByTestId("supplier-balances").waitFor();
    assert.match(await page.getByTestId(`supplier-balance-${supplierA}`).innerText(), /1000\.00 CNY/);
    assert.match(await page.getByTestId(`supplier-balance-${supplierB}`).innerText(), /500\.00 CNY/);
    await page.getByTestId("supplier-balance-unassigned").waitFor();

    await page.getByTestId(`payment-assign-${paymentId}`).selectOption(String(supplierA));
    await page.getByTestId(`supplier-balance-${supplierA}`).getByText("800.00 CNY", { exact: true }).waitFor();
    assert.match(await page.getByTestId(`supplier-balance-${supplierB}`).innerText(), /500\.00 CNY/);

    const form = page.getByTestId("payment-form-out");
    await form.locator('input[name="amount"]').fill("100");
    await form.locator('input[name="currency"]').fill("CNY");
    await form.getByTestId("payment-supplier").selectOption(String(supplierB));
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByTestId(`supplier-balance-${supplierB}`).getByText("400.00 CNY", { exact: true }).waitFor();

    const payments = await sql.query("SELECT supplier_id,amount FROM order_payments WHERE order_id=$1 ORDER BY id", [orderId]);
    assert.deepEqual(payments.rows.map((row) => [row.supplier_id, Number(row.amount)]), [[supplierA, 200], [supplierB, 100]]);
    const history = await sql.query("SELECT kind FROM order_events WHERE order_id=$1 ORDER BY id", [orderId]);
    assert.ok(history.rows.some((row) => row.kind === "payment_allocated"));
    console.log("Supplier payments: mixed balances, historical assignment and new payment passed.");
  } finally {
    if (orderId) {
      await sql.query("DELETE FROM order_payments WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM order_events WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM order_items WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM orders WHERE id=$1", [orderId]);
    }
    await sql.query("DELETE FROM products WHERE sku='PAY-QA'");
    if (clientId) await sql.query("DELETE FROM contacts WHERE id=$1", [clientId]);
    await sql.query("DELETE FROM contacts WHERE company_name IN ('Supplier A','Supplier B')");
    await browser.close();
    await sql.end();
  }
});
