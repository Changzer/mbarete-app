/** Supplier base price + optional VAT must become a frozen, inclusive order cost. */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

test("VAT survives capture and quote edits, and is applied exactly once to new orders", { timeout: 120_000 }, async () => {
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  const stamp = `vat-qa-${Date.now()}`;
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/, { timeout: 30_000 });
    await page.goto(`${BASE}/en/catalog/new`);
    await page.fill('#nameEn', stamp);
    await page.fill('#price', '36');
    assert.equal(await page.locator('#supplierVatPct').inputValue(), '');
    assert.match(await page.getByTestId('supplier-cost-preview').innerText(), /36\.00/);
    await page.fill('#supplierVatPct', '3');
    assert.match(await page.getByTestId('supplier-cost-preview').innerText(), /37\.08/);
    await mkdir('artifacts/supplier-vat', { recursive: true });
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('#supplierVatPct').scrollIntoViewIfNeeded();
      const price = await page.locator('#price').boundingBox();
      const vat = await page.locator('#supplierVatPct').boundingBox();
      assert.ok(Math.abs(price.y - vat.y) < 2 && vat.x > price.x, 'VAT sits beside the supplier price');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}px`);
      await page.screenshot({ path: `artifacts/supplier-vat/width-${width}.png`, caret: 'initial' });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.fill('#supplierVatPct', '-1');
    await page.getByTestId('save-product').click();
    assert.match(await page.getByTestId('form-error').innerText(), /VAT percentage/);
    assert.equal(await page.locator('#price').inputValue(), '36', 'invalid VAT does not erase the capture');
    await page.fill('#supplierVatPct', '3');
    await page.getByTestId('save-product').click();
    await page.waitForURL(/\/catalog(\?|$)/);
    const product = (await sql.query('SELECT id, price, supplier_vat_pct FROM products WHERE name_en=$1', [stamp])).rows[0];
    assert.equal(Number(product.price), 36);
    assert.equal(Number(product.supplier_vat_pct), 3);
    assert.equal(Number((await sql.query('SELECT supplier_vat_pct FROM product_suppliers WHERE product_id=$1', [product.id])).rows[0].supplier_vat_pct), 3);

    await page.goto(`${BASE}/en/catalog/new?from=${product.id}`);
    assert.equal(await page.locator('#supplierVatPct').inputValue(), '3', 'duplicate carries VAT with its base price');
    await page.goto(`${BASE}/en/orders/new`);
    await page.getByRole('button', { name: '+ New client' }).click();
    await page.fill('input[name="companyName"]', stamp);
    await page.locator('div[role="dialog"] button[type="submit"]').click();
    await page.locator('div[role="dialog"]').waitFor({ state: 'hidden' });
    await page.getByTestId('open-picker').click();
    await page.getByTestId('picker-search').fill(stamp);
    await page.getByText(stamp, { exact: true }).filter({ visible: true }).last().click();
    await page.getByTestId('picker-add').click();
    assert.match(await page.getByTestId('builder-cost').innerText(), /37\.08/);
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await page.waitForURL(/\/en\/orders\/\d+$/);
    const orderId = Number(page.url().match(/orders\/(\d+)/)[1]);
    const line = async () => (await sql.query('SELECT unit_price_snapshot, line_total, sell_price_snapshot FROM order_items WHERE order_id=$1', [orderId])).rows[0];
    assert.equal(Number((await line()).unit_price_snapshot), 37.08);
    assert.equal(Number((await line()).line_total), 37.08);
    assert.equal(Number((await line()).sell_price_snapshot), 37.08, 'blank selling price falls back to inclusive cost');

    await page.goto(`${BASE}/en/catalog/${product.id}/edit`);
    assert.equal(await page.locator('#price').inputValue(), '36');
    assert.equal(await page.locator('#supplierVatPct').inputValue(), '3');
    await page.fill('#supplierVatPct', '');
    await page.getByTestId('save-product').click();
    await page.waitForURL(/\/catalog(\?|$)/);
    assert.equal(Number((await sql.query('SELECT supplier_vat_pct FROM products WHERE id=$1', [product.id])).rows[0].supplier_vat_pct), 0);
    await page.goto(`${BASE}/en/orders/${orderId}/edit`);
    assert.match(await page.getByTestId('builder-cost').innerText(), /37\.08/, 'ordinary edit uses the frozen inclusive cost');
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await page.waitForURL(new RegExp(`/en/orders/${orderId}$`));
    assert.equal(Number((await line()).unit_price_snapshot), 37.08, 'no second VAT and no silent catalog refresh');
    await page.getByTestId('catalog-refresh').click();
    const dialog = page.getByTestId('catalog-refresh-dialog');
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /37\.08/);
    assert.match(await dialog.innerText(), /36\.00/);
    await page.getByTestId('catalog-refresh-apply').click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(Number((await line()).unit_price_snapshot), 36, 'explicit refresh updates cost');
    assert.equal(Number((await line()).sell_price_snapshot), 37.08, 'agreed selling price stays unchanged');

    // A 0.0003 unit-cost change matters over 1,000 pieces. The refresh must
    // neither hide it behind two decimal places nor dismiss it as noise.
    await sql.query('UPDATE products SET price=0.01, supplier_vat_pct=3 WHERE id=$1', [product.id]);
    await sql.query('UPDATE order_items SET unit_price_snapshot=0.01, quantity=1000, line_total=10 WHERE order_id=$1', [orderId]);
    await page.reload();
    await page.getByTestId('catalog-refresh').click();
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /0\.0103/);
    await page.getByTestId('catalog-refresh-apply').click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(Number((await line()).unit_price_snapshot), 0.0103);
    assert.equal(Number((await line()).line_total), 10.3);

    // Offline queue stores the percentage before resetting for the next product.
    await page.goto(`${BASE}/en/catalog/new`);
    await page.fill('#nameEn', `${stamp}-offline`);
    await page.fill('#price', '36');
    await page.fill('#supplierVatPct', '2,5');
    await context.setOffline(true);
    await page.getByTestId('save-and-add-another').click();
    await page.getByTestId('saved-offline').waitFor();
    assert.equal(await page.locator('#supplierVatPct').inputValue(), '', 'next product does not inherit a tax rate');
    const draft = await page.evaluate(async (name) => {
      const db = await new Promise((resolve, reject) => { const req = indexedDB.open('mbarete-outbox'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      try {
        const rows = await new Promise((resolve, reject) => { const req = db.transaction('scoped-drafts').objectStore('scoped-drafts').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        return rows.find((row) => row.fields.nameEn === name);
      } finally { db.close(); }
    }, `${stamp}-offline`);
    assert.equal(draft.fields.supplierVatPct, '2,5');
    await context.setOffline(false);
    const delivered = await context.request.post(`${BASE}/api/drafts`, { multipart: {
      clientId: draft.clientId, kind: 'product', capturedAt: draft.capturedAt, fields: JSON.stringify(draft.fields),
    } });
    assert.ok([200, 201].includes(delivered.status()));
    const { draftId } = await delivered.json();
    await page.goto(`${BASE}/en/catalog/new?draft=${draftId}`);
    assert.equal(await page.locator('#supplierVatPct').inputValue(), '2.5');
    assert.match(await page.getByTestId('supplier-cost-preview').innerText(), /36\.90/);
    await page.getByTestId('save-product').click();
    await page.waitForURL(/\/catalog(\?|$)/);
    assert.equal(Number((await sql.query('SELECT supplier_vat_pct FROM products WHERE name_en=$1', [`${stamp}-offline`])).rows[0].supplier_vat_pct), 2.5);
    assert.deepEqual(errors, []);
  } finally {
    await sql.end();
    await browser.close();
  }
});
