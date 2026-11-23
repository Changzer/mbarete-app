import assert from "node:assert/strict";
import test from "node:test";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { chromium, request } from "playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

test("Kimi files clear dossier matches and leaves unknown documents untouched", async () => {
  const browser = await chromium.launch();
  const anonymous = await request.newContext();
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  let orderId, clientId, account;
  try {
    account = (await sql.query("SELECT id, company_id FROM users WHERE email=$1", [EMAIL])).rows[0];
    const stamp = `dossier-sort-${Date.now()}`;
    clientId = (await sql.query("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client',$2) RETURNING id", [account.company_id, stamp])).rows[0].id;
    orderId = (await sql.query("INSERT INTO orders(company_id,order_number,client_id,created_by) VALUES ($1,$2,$3,$4) RETURNING id", [account.company_id, stamp, clientId, account.id])).rows[0].id;
    const endpoint = `${BASE}/api/orders/${orderId}/dossier-sort`;
    assert.equal((await anonymous.post(endpoint)).status(), 401);

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/, { timeout: 30_000 });
    await page.goto(`${BASE}/en/orders/${orderId}`);
    await page.getByTestId("dossier-ai-sort").waitFor();

    await page.getByTestId("dossier-ai-files").setInputFiles([
      { name: "customs.pdf", mimeType: "application/pdf", buffer: PDF },
      { name: "invoice.pdf", mimeType: "application/pdf", buffer: PDF },
      { name: "unknown.pdf", mimeType: "application/pdf", buffer: PDF },
    ]);
    const answered = page.waitForResponse((response) => response.url() === endpoint && response.request().method() === "POST");
    await page.getByTestId("dossier-ai-submit").click();
    assert.equal((await answered).status(), 200);

    await page.getByTestId("dossier-item-1").getByRole("link", { name: "customs.pdf" }).waitFor();
    await page.getByTestId("dossier-item-6").getByRole("link", { name: "invoice.pdf" }).waitFor();
    assert.match(await page.getByTestId("dossier-ai-result-2").innerText(), /Not filed/);
    assert.equal(await page.getByTestId("dossier-ai-files").evaluate((input) => input.files.length), 0);

    const documents = await sql.query(
      "SELECT kind, fapiao_type FROM order_documents WHERE order_id=$1 ORDER BY kind",
      [orderId],
    );
    assert.deepEqual(documents.rows, [
      { kind: "customs_declaration", fapiao_type: null },
      { kind: "supplier_invoice", fapiao_type: "special_3" },
    ]);
    const history = await sql.query(
      "SELECT payload FROM order_events WHERE order_id=$1 AND kind='document_added'",
      [orderId],
    );
    assert.equal(history.rowCount, 2);
    assert.ok(history.rows.every((row) => JSON.parse(row.payload).source === "ai"));
    await context.close();
  } finally {
    if (orderId) {
      const files = (await sql.query("SELECT path FROM order_documents WHERE order_id=$1", [orderId])).rows;
      for (const file of files) await unlink(path.join(process.env.UPLOADS_DIR ?? "uploads", file.path.slice("/uploads/".length))).catch(() => {});
      await sql.query("DELETE FROM order_documents WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM order_events WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM orders WHERE id=$1", [orderId]);
    }
    if (clientId) await sql.query("DELETE FROM contacts WHERE id=$1", [clientId]);
    await anonymous.dispose();
    await browser.close();
    await sql.end();
  }
});
