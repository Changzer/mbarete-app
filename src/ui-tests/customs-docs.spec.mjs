/** Goods origin from suppliers, shipping marks and carton labels, against the real app and a disposable database. */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const SHOTS = "artifacts/customs";

test("each line declares its supplier's place, the marks print everywhere, one label per carton", { timeout: 180_000 }, async () => {
  assert.ok(process.env.DATABASE_ADMIN_URL, "explicit disposable test database required");
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  const q = async (text, values) => (await sql.query(text, values)).rows;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const created = { orders: [], products: [], contacts: [], categories: [] };
  const errors = [];
  try {
    await mkdir(SHOTS, { recursive: true });
    const [admin] = await q("SELECT id, company_id FROM users WHERE email=$1", [EMAIL]);
    const company = admin.company_id;
    const stamp = `cd-${Date.now()}`;

    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/);

    // Two suppliers through the form: one in Shenzhen, one known only by its Yiwu booth.
    const addSupplier = async (name, fill) => {
      await page.goto(`${BASE}/en/contacts`);
      await page.getByRole("button", { name: "Add Supplier" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("#companyName").fill(name);
      await fill(dialog);
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      let row;
      for (let i = 0; i < 40 && !row; i++) {
        [row] = await q("SELECT id, province, city FROM contacts WHERE company_id=$1 AND company_name=$2", [company, name]);
        if (!row) await page.waitForTimeout(250);
      }
      assert.ok(row, `${name} saved`);
      created.contacts.push(row.id);
      return row;
    };
    const weixu = await addSupplier(`Wei Xu Electronics ${stamp}`, async (dialog) => {
      await dialog.getByTestId("contact-province").selectOption("广东省");
      await dialog.getByTestId("contact-city").fill("深圳市");
      await dialog.screenshot({ path: `${SHOTS}/supplier-form.png` });
    });
    assert.deepEqual([weixu.province, weixu.city], ["广东省", "深圳市"]);
    const angel = await addSupplier(`Angel Packing ${stamp}`, async (dialog) => {
      await dialog.locator("#boothLocation").fill("No.4642, Yiwu International Trade City (义乌国际商贸城一区2楼C区9街4642店)");
    });
    assert.deepEqual([angel.province, angel.city], ["浙江省", "义乌市"], "a Yiwu booth with no place given is Yiwu");

    // A confirmed order: four cartons of bottles from Yiwu, two of cameras from Shenzhen.
    const [cat] = await q("INSERT INTO categories(company_id,name_en,name_zh) VALUES ($1,$2,'报关') RETURNING id", [company, stamp]);
    created.categories.push(cat.id);
    const [client] = await q("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client',$2) RETURNING id", [company, `Client ${stamp}`]);
    created.contacts.push(client.id);
    const product = async (en, zh, code) => {
      const [row] = await q(
        "INSERT INTO products(company_id,sku,name_en,name_zh,category_id,price,currency,moq,qty_per_box,cn_hs_code,declaration_elements) VALUES ($1,$2,$3,$4,$5,1,'CNY',1,1,$6,'无品牌') RETURNING id",
        [company, `${stamp}-${created.products.length}`, en, zh, cat.id, code],
      );
      created.products.push(row.id);
      return row.id;
    };
    const bottle = await product("50ml Foam Pump Bottle", "50毫升泡沫泵瓶", "3923300000");
    const camera = await product("Mini Thumb Digital Camera", "迷你数码相机", "8525890000");
    const [order] = await q(
      "INSERT INTO orders(company_id,order_number,client_id,status,rates_snapshot,created_by) VALUES ($1,$2,$3,'confirmed','{\"USD\":1,\"CNY\":0.14}',$4) RETURNING id",
      [company, stamp, client.id, admin.id],
    );
    created.orders.push(order.id);
    const line = (productId, en, zh, qty, perCarton, cartons, sell, supplier) =>
      q(
        `INSERT INTO order_items(company_id,order_id,product_id,quantity,unit_price_snapshot,sell_price_snapshot,currency_snapshot,moq_snapshot,line_total,line_cbm,line_weight_kg,cartons_snapshot,sku_snapshot,name_en_snapshot,name_zh_snapshot,qty_per_box_snapshot,carton_cbm_snapshot,carton_weight_snapshot,sell_currency_snapshot,supplier_id_snapshot,supplier_name_en_snapshot)
         VALUES ($1,$2,$3,$4,1,$5,'CNY',1,$12,0.1,10,$6,'',$7,$8,$9,0.05,5,'USD',$10,$11)`,
        [company, order.id, productId, qty, sell, cartons, en, zh, perCarton, supplier.id, supplier.name, qty],
      );
    await line(bottle, "50ml Foam Pump Bottle", "50毫升泡沫泵瓶", 1995, 600, 4, 0.8, { id: angel.id, name: `Angel Packing ${stamp}` });
    await line(camera, "Mini Thumb Digital Camera", "迷你数码相机", 400, 200, 2, 1, { id: weixu.id, name: `Wei Xu Electronics ${stamp}` });

    // The dossier says where the declaration's origin comes from; the marks are typed once.
    await page.goto(`${BASE}/en/orders/${order.id}`);
    const dossier = page.getByTestId("dossier-card");
    await dossier.waitFor();
    assert.match(await dossier.innerText(), /From the suppliers: 浙江省义乌市\.[\s\S]*Lines from elsewhere declare their own: 广东省深圳市\./);
    await page.getByTestId("shippingMarks").fill("BLG-88\nPARAGUAY");
    await page.getByTestId("destinationCountry").click();
    await page.getByRole("option", { name: "Paraguay", exact: true }).click();
    await page.getByTestId("dossier-save").click();
    await page.getByTestId("dossier-save-msg").waitFor();
    assert.equal((await q("SELECT shipping_marks FROM orders WHERE id=$1", [order.id]))[0].shipping_marks, "BLG-88\nPARAGUAY");
    await dossier.screenshot({ path: `${SHOTS}/dossier.png` });

    // The pack: the header names the main origin, each line its own, the marks replace N/M.
    const pack = await context.request.get(`${BASE}/api/orders/${order.id}/export?format=xlsx&doc=customs&locale=en`);
    assert.equal(pack.status(), 200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await pack.body());
    assert.deepEqual(book.worksheets.map((w) => w.name), ["出货清单", "inv", "pck", "合同", "报关单", "委托书"]);
    const decl = book.getWorksheet("报关单");
    assert.equal(decl.getCell("O11").value, "浙江省义乌市");
    const origins = {};
    for (const r of [22, 23]) origins[decl.getCell(`D${r}`).value] = decl.getCell(`H${r}`).value;
    assert.deepEqual(origins, { "50毫升泡沫泵瓶": "浙江省义乌市", "迷你数码相机": "广东省深圳市" });
    assert.equal(decl.getCell("A19").value, "BLG-88  PARAGUAY");
    assert.equal(book.getWorksheet("inv").getCell("A19").value, "BLG-88");
    const attorney = [];
    book.getWorksheet("委托书").eachRow((row) => row.eachCell((c) => attorney.push(String(c.value ?? ""))));
    assert.ok(attorney.join(" ").includes("代理报关委托书") && attorney.join(" ").includes("浙江省义乌市"));

    // Carton labels: six cartons, two to a sheet.
    // The button downloads (headless Chrome names a navigated PDF "download", so the name is read off the response).
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-labels").click()]);
    const pdf = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks));
    const labels = await context.request.get(`${BASE}/api/orders/${order.id}/export?format=pdf&doc=labels&locale=en`);
    assert.match(labels.headers()["content-disposition"] ?? "", /_carton-labels\.pdf"/);
    await writeFile(`${SHOTS}/labels.pdf`, pdf);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length, 3, "six labels on three sheets");

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    try {
      if (created.orders.length) await q("DELETE FROM orders WHERE id = ANY($1)", [created.orders]);
      if (created.products.length) await q("DELETE FROM product_suppliers WHERE product_id = ANY($1)", [created.products]);
      if (created.products.length) await q("DELETE FROM products WHERE id = ANY($1)", [created.products]);
      if (created.contacts.length) await q("DELETE FROM contact_images WHERE contact_id = ANY($1)", [created.contacts]);
      if (created.contacts.length) await q("DELETE FROM entity_events WHERE entity='contact' AND entity_id = ANY($1)", [created.contacts]);
      if (created.contacts.length) await q("DELETE FROM contacts WHERE id = ANY($1)", [created.contacts]);
      if (created.categories.length) await q("DELETE FROM categories WHERE id = ANY($1)", [created.categories]);
    } finally {
      await sql.end();
    }
  }
});
