/** Shipment confirmation and recovery against the real app and disposable database. */
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

test("shipping needs confirmation and can be safely undone without changing saved commercial data", { timeout: 180_000 }, async () => {
  assert.ok(process.env.DATABASE_ADMIN_URL, "explicit disposable test database required");
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  let orderId, productId, clientId, categoryId, otherCompany, otherClient, otherOrder;
  const errors = [];
  try {
    const user = (await sql.query("SELECT id,company_id FROM users WHERE email=$1", [EMAIL])).rows[0];
    const stamp = `status-qa-${Date.now()}`;
    categoryId = (await sql.query("INSERT INTO categories(company_id,name_en,name_zh) VALUES ($1,$2,'状态测试') RETURNING id", [user.company_id, stamp])).rows[0].id;
    clientId = (await sql.query("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client','Renamed client') RETURNING id", [user.company_id])).rows[0].id;
    productId = (await sql.query("INSERT INTO products(company_id,sku,name_en,name_zh,category_id,price,currency,moq,qty_per_box) VALUES ($1,$2,$2,'测试商品',$3,90,'USD',1,10) RETURNING id", [user.company_id, stamp, categoryId])).rows[0].id;
    const parties = JSON.stringify({
      v: 1, frozenAt: "2026-01-01T00:00:00.000Z",
      client: { companyName: "Original client", address: "Original address", taxId: "", contactPerson: "", phone: "", email: "", whatsapp: "", wechat: "" },
      seller: { companyName: "Original seller", addressLines: "", phone: "", email: "", website: "", taxId: "", incoterms: "FOB", paymentTerms: "Deposit", footerNote: "", validityDays: 30 },
      bank: null,
    });
    orderId = (await sql.query("INSERT INTO orders(company_id,order_number,client_id,status,rates_snapshot,parties_snapshot,notes,export_date,created_by) VALUES ($1,$2,$3,'confirmed',$4,$5,'Original terms','2026-10-01',$6) RETURNING id", [user.company_id, stamp, clientId, '{"USD":1,"CNY":0.14}', parties, user.id])).rows[0].id;
    await sql.query("INSERT INTO order_items(company_id,order_id,product_id,quantity,unit_price_snapshot,sell_price_snapshot,currency_snapshot,moq_snapshot,line_total,line_cbm,line_weight_kg,cartons_snapshot,sku_snapshot,name_en_snapshot,qty_per_box_snapshot,carton_cbm_snapshot,carton_weight_snapshot,sell_currency_snapshot) VALUES ($1,$2,$3,10,37.08,50,'USD',10,370.80,0.01,1,1,$4,$4,10,0.01,1,'USD')", [user.company_id, orderId, productId, stamp]);
    await sql.query("INSERT INTO order_documents(company_id,order_id,kind,path,original_name,uploaded_by) VALUES ($1,$2,'packing_list','/uploads/status-qa.pdf','packing-list.pdf',$3)", [user.company_id, orderId, user.id]);
    await sql.query("INSERT INTO order_payments(company_id,order_id,direction,amount,currency,paid_on,created_by) VALUES ($1,$2,'in',100,'USD','2026-10-01',$3)", [user.company_id, orderId, user.id]);
    otherCompany = (await sql.query("INSERT INTO companies(name) VALUES ($1) RETURNING id", [stamp])).rows[0].id;
    otherClient = (await sql.query("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client','Other company client') RETURNING id", [otherCompany])).rows[0].id;
    otherOrder = (await sql.query("INSERT INTO orders(company_id,order_number,client_id,status) VALUES ($1,$2,$3,'shipped') RETURNING id", [otherCompany, `${stamp}-other`, otherClient])).rows[0].id;

    const state = async () => (await sql.query("SELECT status,version,updated_by FROM orders WHERE id=$1", [orderId])).rows[0];
    const history = async () => (await sql.query("SELECT user_id,payload FROM order_events WHERE order_id=$1 AND kind='status' ORDER BY id", [orderId])).rows;
    const commercial = async () => ({
      order: (await sql.query("SELECT parties_snapshot,rates_snapshot,bank_account_id,notes,export_date FROM orders WHERE id=$1", [orderId])).rows[0],
      lines: (await sql.query("SELECT * FROM order_items WHERE order_id=$1 ORDER BY id", [orderId])).rows,
      documents: (await sql.query("SELECT * FROM order_documents WHERE order_id=$1 ORDER BY id", [orderId])).rows,
      payments: (await sql.query("SELECT * FROM order_payments WHERE order_id=$1 ORDER BY id", [orderId])).rows,
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/);
    const url = `${BASE}/en/orders/${orderId}`;
    await page.goto(url);
    const dialog = page.getByTestId("order-status-dialog");
    await page.getByTestId("mark-shipped").click();
    await dialog.waitFor();
    assert.equal((await state()).status, "confirmed", "first click never ships");
    assert.equal((await history()).length, 0);
    assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).evaluate((el) => el === document.activeElement), true, "confirmation is not the default keyboard action");
    await mkdir("artifacts/order-status", { recursive: true });
    await page.screenshot({ path: "artifacts/order-status/ship-desktop.png" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal((await state()).status, "confirmed");

    let actionId;
    await page.route(url, async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.continue();
      actionId = req.headers()["next-action"];
      const args = JSON.parse(req.postData());
      assert.equal(args[3], "ship");
      await route.continue({ postData: JSON.stringify(args.slice(0, 3)) });
    });
    await page.getByTestId("mark-shipped").click();
    await dialog.getByTestId("confirm-order-status").click();
    await dialog.getByRole("alert").waitFor();
    assert.match(await dialog.getByRole("alert").innerText(), /Confirm this change/);
    assert.equal((await state()).status, "confirmed", "the server also requires acknowledgement");
    await page.unroute(url);
    await dialog.getByTestId("confirm-order-status").click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByTestId("reopen-shipped-order").waitFor();
    assert.deepEqual(await state(), { status: "shipped", version: 2, updated_by: user.id });
    assert.equal((await history()).length, 1);
    const postStatus = (args) => context.request.post(url, {
      headers: { "next-action": actionId, "content-type": "text/plain;charset=UTF-8", Origin: BASE },
      data: JSON.stringify(args),
    });
    assert.match(await (await postStatus([orderId, "draft", 2])).text(), /"error":"frozen"/);
    assert.match(await (await postStatus([orderId, "confirmed", 2])).text(), /"error":"confirmation"/);
    assert.match(await (await postStatus([orderId, "confirmed"])).text(), /"error":"confirmation"/);
    assert.match(await (await postStatus([otherOrder, "confirmed", 1, "reopen"])).text(), /"error":"not-found"/);
    assert.equal((await sql.query("SELECT status FROM orders WHERE id=$1", [otherOrder])).rows[0].status, "shipped");
    await page.goto(`${url}/edit`);
    await page.waitForURL(url);
    assert.equal(await page.getByRole("link", { name: "Edit", exact: true }).count(), 0, "editing still requires an explicit reopen");

    // Legacy shipped orders with an invalid MOQ still need to be recoverable.
    await sql.query("UPDATE order_items SET moq_snapshot=20 WHERE order_id=$1", [orderId]);
    const before = await commercial();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("order-actions").click();
    const sheet = page.getByTestId("order-actions-sheet");
    await sheet.getByTestId("reopen-shipped-order").click();
    await dialog.waitFor();
    await page.screenshot({ path: "artifacts/order-status/reopen-mobile.png" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal((await state()).status, "shipped");
    await sheet.getByTestId("reopen-shipped-order").click();
    await page.route(url, (route) => route.request().method() === "POST" ? route.abort() : route.continue());
    await dialog.getByTestId("confirm-order-status").click();
    await dialog.getByRole("alert").waitFor();
    assert.match(await dialog.getByRole("alert").innerText(), /Could not change/);
    await page.unroute(url);
    assert.equal((await state()).status, "shipped");

    const other = await context.newPage();
    other.on("pageerror", (error) => errors.push(error.message));
    await other.goto(url);
    await other.getByTestId("reopen-shipped-order").click();
    const otherDialog = other.getByTestId("order-status-dialog");
    // Failing the history write must roll back the status update too.
    await sql.query(`CREATE FUNCTION order_status_qa_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id = ${Number(orderId)} AND NEW.kind = 'status' THEN RAISE EXCEPTION 'status QA failure'; END IF; RETURN NEW; END $$`);
    await sql.query("CREATE TRIGGER order_status_qa_reject BEFORE INSERT ON order_events FOR EACH ROW EXECUTE FUNCTION order_status_qa_reject()");
    await otherDialog.getByTestId("confirm-order-status").click();
    await otherDialog.getByRole("alert").waitFor();
    assert.deepEqual(await state(), { status: "shipped", version: 2, updated_by: user.id });
    assert.equal((await history()).length, 1);
    await sql.query("DROP TRIGGER order_status_qa_reject ON order_events");
    await sql.query("DROP FUNCTION order_status_qa_reject()");
    await otherDialog.getByTestId("confirm-order-status").click();
    await otherDialog.waitFor({ state: "hidden" });
    await other.getByRole("link", { name: "Edit", exact: true }).waitFor();
    assert.deepEqual(await state(), { status: "confirmed", version: 3, updated_by: user.id });
    assert.deepEqual(await commercial(), before, "reopening keeps every stored price, party, rate, document and payment");
    assert.deepEqual((await history()).map((row) => ({ user: row.user_id, ...JSON.parse(row.payload) })), [
      { user: user.id, from: "confirmed", to: "shipped" }, { user: user.id, from: "shipped", to: "confirmed" },
    ]);
    await dialog.getByTestId("confirm-order-status").click();
    await dialog.getByTestId("status-conflict").waitFor();
    assert.equal((await history()).length, 2, "stale tab neither overwrites nor duplicates history");
    assert.equal((await state()).version, 3);

    await other.goto(`${url}/edit`);
    await other.getByTestId(`step-up-${stamp}`).click();
    await other.getByTestId("save-changes").click();
    await other.waitForURL(url);
    const saved = (await sql.query("SELECT quantity,unit_price_snapshot,sell_price_snapshot,line_total FROM order_items WHERE order_id=$1", [orderId])).rows[0];
    assert.deepEqual(saved, { quantity: 20, unit_price_snapshot: "37.0800", sell_price_snapshot: "50.0000", line_total: "741.60" });
    const after = await commercial();
    assert.deepEqual(after.order, before.order, "ordinary editing also preserves parties and rates");
    assert.deepEqual(after.documents, before.documents);
    assert.deepEqual(after.payments, before.payments);
    await other.getByTestId("mark-shipped").click();
    await other.getByTestId("confirm-order-status").click();
    await other.getByTestId("order-status-dialog").waitFor({ state: "hidden" });
    assert.equal((await state()).status, "shipped", "the corrected order can ship again");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await sql.query("DROP TRIGGER IF EXISTS order_status_qa_reject ON order_events");
    await sql.query("DROP FUNCTION IF EXISTS order_status_qa_reject()");
    if (orderId) await sql.query("DELETE FROM orders WHERE id=$1", [orderId]);
    if (productId) await sql.query("DELETE FROM products WHERE id=$1", [productId]);
    if (clientId) await sql.query("DELETE FROM contacts WHERE id=$1", [clientId]);
    if (categoryId) await sql.query("DELETE FROM categories WHERE id=$1", [categoryId]);
    if (otherOrder) await sql.query("DELETE FROM orders WHERE id=$1", [otherOrder]);
    if (otherClient) await sql.query("DELETE FROM contacts WHERE id=$1", [otherClient]);
    if (otherCompany) await sql.query("DELETE FROM companies WHERE id=$1", [otherCompany]);
    await sql.end();
  }
});
