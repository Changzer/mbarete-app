/** The follow-up board against the real app and a disposable database. */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";
const UPLOADS = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const SHOTS = "artifacts/followup";

// A 1×1 PNG: the smallest real photo an update can carry.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const utcDate = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

test("supplier cards move, carry the next step and who, and shipped orders track their paperwork", { timeout: 240_000 }, async () => {
  assert.ok(process.env.DATABASE_ADMIN_URL, "explicit disposable test database required");
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  const q = async (text, values) => (await sql.query(text, values)).rows;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const created = { orders: [], products: [], contacts: [], users: [], categories: [] };
  const errors = [];
  try {
    const [admin] = await q("SELECT id, company_id FROM users WHERE email=$1", [EMAIL]);
    const company = admin.company_id;
    const stamp = `fu-${Date.now()}`;
    const [li] = await q(
      "INSERT INTO users(company_id,email,password_hash,name,active,role) VALUES ($1,$2,'unused-test-account','Li 小李',true,'collaborator') RETURNING id",
      [company, `${stamp}-li@example.com`],
    );
    created.users.push(li.id);
    const [category] = await q("INSERT INTO categories(company_id,name_en,name_zh) VALUES ($1,$2,'跟单') RETURNING id", [company, stamp]);
    created.categories.push(category.id);
    const contact = async (type, en, zh) => {
      const [row] = await q("INSERT INTO contacts(company_id,type,company_name,company_name_zh) VALUES ($1,$2,$3,$4) RETURNING id", [company, type, en, zh]);
      created.contacts.push(row.id);
      return row.id;
    };
    const client = await contact("client", `Asunción client ${stamp}`, "");
    const jingmi = await contact("supplier", "Yongkang Jingmi Vehicle", "永康金米车业");
    const hongda = await contact("supplier", "Yiwu Hongda Bags", "义乌宏达箱包");
    const product = async (en, zh) => {
      const [row] = await q(
        "INSERT INTO products(company_id,sku,name_en,name_zh,category_id,price,currency,moq,qty_per_box) VALUES ($1,$2,$3,$4,$5,10,'CNY',1,10) RETURNING id",
        [company, `${stamp}-${created.products.length}`, en, zh, category.id],
      );
      created.products.push(row.id);
      return row.id;
    };
    const order = async (status) => {
      const [row] = await q(
        "INSERT INTO orders(company_id,order_number,client_id,status,rates_snapshot,created_by) VALUES ($1,$2,$3,$4,'{\"USD\":1,\"CNY\":0.14}',$5) RETURNING id, order_number",
        [company, `${stamp}-${created.orders.length}`, client, status, admin.id],
      );
      created.orders.push(row.id);
      return row;
    };
    const line = (orderId, productId, en, zh, qty, cost, supplier) =>
      q(
        `INSERT INTO order_items(company_id,order_id,product_id,quantity,unit_price_snapshot,sell_price_snapshot,currency_snapshot,moq_snapshot,line_total,line_cbm,line_weight_kg,cartons_snapshot,sku_snapshot,name_en_snapshot,name_zh_snapshot,qty_per_box_snapshot,carton_cbm_snapshot,carton_weight_snapshot,sell_currency_snapshot,supplier_id_snapshot,supplier_name_en_snapshot,supplier_name_zh_snapshot)
         VALUES ($1,$2,$3,$4,$5,0,'CNY',1,$6,0.01,1,1,'',$7,$8,10,0.01,1,'CNY',$9,$10,$11)`,
        [company, orderId, productId, qty, cost, cost * qty, en, zh, supplier?.id ?? null, supplier?.en ?? "", supplier?.zh ?? ""],
      );
    const J = { id: jingmi, en: "Yongkang Jingmi Vehicle", zh: "永康金米车业" };
    const H = { id: hongda, en: "Yiwu Hongda Bags", zh: "义乌宏达箱包" };
    const trike = await product("Electric Drift Trike Scooter 8inch", "电动漂移三轮车8寸");
    const charger = await product("Electric Scooter Charger", "电动滑板车充电器");
    const handbag = await product("Quilted PU leather handbag", "绗缝PU皮手提包");
    const organiser = await product("Travel organiser set", "旅行收纳套装");

    const open = await order("confirmed");
    await line(open.id, charger, "Electric Scooter Charger", "电动滑板车充电器", 50, 15, J);
    await line(open.id, trike, "Electric Drift Trike Scooter 8inch", "电动漂移三轮车8寸", 400, 360, J);
    await line(open.id, handbag, "Quilted PU leather handbag", "绗缝PU皮手提包", 800, 45, H);
    await line(open.id, organiser, "Travel organiser set", "旅行收纳套装", 200, 12, null);
    const draft = await order("draft");
    await line(draft.id, trike, "Electric Drift Trike Scooter 8inch", "", 5, 360, J);
    const shipped = await order("shipped");
    await line(shipped.id, trike, "Electric Drift Trike Scooter 8inch", "电动漂移三轮车8寸", 100, 360, J);
    await q("INSERT INTO order_events(company_id,order_id,user_id,kind,payload) VALUES ($1,$2,$3,'status','{\"from\":\"confirmed\",\"to\":\"shipped\"}')", [company, shipped.id, admin.id]);
    for (const kind of ["customs_declaration", "packing_list"]) {
      await q("INSERT INTO order_documents(company_id,order_id,kind,path,original_name,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)", [
        company, shipped.id, kind, `/uploads/c${company}/doc-${stamp}-${kind}.pdf`, `${kind}.pdf`, admin.id,
      ]);
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/);

    // The order page leads to its cards; the board makes them on first open.
    await page.goto(`${BASE}/en/orders/${open.id}`);
    await page.getByTestId("order-followup-link").click();
    await page.waitForURL(new RegExp(`/en/followup\\?order=${open.id}`));
    const board = page.getByTestId("followup-board");
    await board.waitFor();
    const cards = await q("SELECT id, kind, supplier_id, stage, next_owner_id FROM followup_cards WHERE order_id=$1 ORDER BY id", [open.id]);
    assert.equal(cards.length, 3, "one card per supplier plus one for the lines with no supplier");
    assert.equal((await q("SELECT count(*)::int AS n FROM followup_cards WHERE order_id=$1", [draft.id]))[0].n, 0, "a draft is not on the board");
    const jCard = cards.find((c) => c.supplier_id === jingmi);
    const hCard = cards.find((c) => c.supplier_id === hongda);
    const noneCard = cards.find((c) => c.kind === "unassigned");
    assert.ok(jCard && hCard && noneCard);
    assert.equal(jCard.next_owner_id, admin.id, "the next step starts with whoever made the order");

    const tile = (id) => page.locator(`[data-testid="followup-card"][data-card="${id}"]`);
    const deposit = page.getByTestId("followup-column-deposit");
    assert.equal(await deposit.getByTestId("followup-card").count(), 3);
    assert.equal(await tile(jCard.id).getByTestId("followup-card-supplier").innerText(), "永康金米车业");
    assert.equal(
      await tile(jCard.id).getByTestId("followup-card-product").innerText(),
      "Electric Drift Trike Scooter 8inch",
      "the card leads with the line the most money goes to",
    );
    assert.match(await tile(jCard.id).innerText(), /\+1 more · 450 pcs · ¥144,750/);
    assert.match(await tile(jCard.id).getByTestId("followup-next").innerText(), /Pay the deposit/);
    assert.match(await tile(noneCard.id).innerText(), /No supplier recorded/);
    assert.equal(await tile(noneCard.id).getAttribute("draggable"), "false");
    await page.getByTestId("followup-filter-attention").click();
    assert.equal(await board.getByTestId("followup-card").count(), 1, "lines with no supplier need attention");
    await page.getByTestId("followup-filter-all").click();
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/board-en.png`, fullPage: true, animations: "disabled" });

    // Open the scooter factory's card and move it on.
    await tile(jCard.id).click();
    const panel = page.getByTestId("followup-panel");
    await panel.getByTestId("followup-move-next").waitFor();
    await panel.getByTestId("followup-move-next").click();
    await panel.locator('[data-testid="followup-entry"][data-kind="stage"]').waitFor();
    assert.equal((await q("SELECT stage, version FROM followup_cards WHERE id=$1", [jCard.id]))[0].stage, "production");
    await page.getByTestId("followup-column-production").locator(`[data-card="${jCard.id}"]`).waitFor();

    // The next step, a date that has already passed, and the assistant as owner.
    await panel.getByTestId("followup-next-text").fill("Confirm the new finish date in writing");
    await panel.getByTestId("followup-next-due").fill(utcDate(-1));
    await panel.getByTestId("followup-next-owner").selectOption(String(li.id));
    await panel.getByTestId("followup-next-save").click();
    await panel.locator('[data-testid="followup-entry"][data-kind="next_step"]').waitFor();
    const afterNext = (await q("SELECT next_step, next_due, next_owner_id FROM followup_cards WHERE id=$1", [jCard.id]))[0];
    assert.deepEqual(afterNext, { next_step: "Confirm the new finish date in writing", next_due: utcDate(-1), next_owner_id: li.id });
    await tile(jCard.id).locator('[data-testid="followup-due"][data-state="overdue"]').waitFor();
    assert.match(await tile(jCard.id).getByTestId("followup-due").innerText(), /Overdue 1 day/);
    assert.equal(await tile(jCard.id).locator(`[data-testid="followup-avatar"][data-user="${li.id}"]`).count(), 1);

    // A checklist item for the owner, ticked; a set, so a retry cannot untick it.
    await panel.getByTestId("followup-check-input").fill("Book the QC inspection");
    await panel.getByTestId("followup-check-owner").selectOption(String(admin.id));
    await panel.getByTestId("followup-check-add").click();
    const item = panel.getByTestId("followup-check-item").filter({ hasText: "Book the QC inspection" });
    await item.waitFor();
    await item.getByTestId("followup-check-toggle").click();
    await panel.locator('[data-testid="followup-check-item"][data-done="true"]').waitFor();
    assert.deepEqual(
      await q("SELECT text, done, owner_id, done_by FROM followup_checklist_items WHERE card_id=$1", [jCard.id]),
      [{ text: "Book the QC inspection", done: true, owner_id: admin.id, done_by: admin.id }],
    );

    // An update in Chinese with a photo.
    await panel.getByTestId("followup-update-body").fill("工厂说控制器缺货，需要多等5天。");
    await panel.getByTestId("followup-update-files").setInputFiles({ name: "frames.png", mimeType: "image/png", buffer: PNG });
    await panel.getByTestId("followup-files-chosen").waitFor();
    await panel.getByTestId("followup-update-post").click();
    await panel.getByTestId("followup-entry-body").filter({ hasText: "控制器缺货" }).waitFor();
    await panel.getByTestId("followup-attachment").waitFor();
    const [posted] = await q("SELECT e.id, e.body, e.user_id, a.path FROM followup_entries e JOIN followup_attachments a ON a.entry_id=e.id WHERE e.card_id=$1 AND e.kind='comment'", [jCard.id]);
    assert.equal(posted.body, "工厂说控制器缺货，需要多等5天。");
    assert.match(posted.path, new RegExp(`^/uploads/c${company}/doc-[0-9a-f-]+\\.png$`), "photos are stored as gated company documents");
    assert.ok(existsSync(path.join(UPLOADS, posted.path.replace(/^\/uploads\//, ""))));
    assert.equal(await panel.getByTestId("followup-update-body").inputValue(), "", "the composer clears after a post");
    const anon = await browser.newContext();
    assert.notEqual((await anon.request.get(`${BASE}${posted.path}`)).status(), 200, "a follow-up photo is not on the open path");
    await anon.close();

    // A flagged problem shows on the tile and puts the card on Needs attention.
    await panel.getByTestId("followup-problem-input").fill("Controllers 5 days late");
    await panel.getByTestId("followup-problem-save").click();
    await panel.getByTestId("followup-problem").waitFor();
    await tile(jCard.id).getByTestId("followup-problem-chip").waitFor();
    await page.screenshot({ path: `${SHOTS}/panel-en.png`, animations: "disabled" });

    // A colleague saved first: this panel's stale save is refused and it shows theirs.
    await q("UPDATE followup_cards SET next_step='Colleague: factory confirmed Friday', version=version+1 WHERE id=$1", [jCard.id]);
    await panel.getByTestId("followup-next-text").fill("My stale edit");
    await panel.getByTestId("followup-next-save").click();
    await panel.getByTestId("followup-error").waitFor();
    assert.match(await panel.getByTestId("followup-error").innerText(), /Someone changed this card/);
    // The panel re-reads the card after the refusal and shows the colleague's words.
    await page.waitForFunction(
      () => document.querySelector('[data-testid="followup-next-text"]')?.value === "Colleague: factory confirmed Friday",
    );
    assert.equal((await q("SELECT next_step FROM followup_cards WHERE id=$1", [jCard.id]))[0].next_step, "Colleague: factory confirmed Friday");

    await panel.getByTestId("followup-panel-close").click();
    await panel.waitFor({ state: "hidden" });

    // Waiting on Li: the card whose next step is theirs, and only that.
    await page.getByTestId(`followup-filter-user-${li.id}`).click();
    assert.deepEqual(await board.getByTestId("followup-card").evaluateAll((els) => els.map((e) => Number(e.dataset.card))), [jCard.id]);
    await page.getByTestId("followup-filter-all").click();

    // Drag the bag factory straight to quality check.
    await tile(hCard.id).dragTo(page.getByTestId("followup-column-qc"));
    await page.getByTestId("followup-column-qc").locator(`[data-card="${hCard.id}"]`).waitFor();
    for (let i = 0; i < 20 && (await q("SELECT stage FROM followup_cards WHERE id=$1", [hCard.id]))[0].stage !== "qc"; i++) {
      await page.waitForTimeout(250);
    }
    assert.equal((await q("SELECT stage FROM followup_cards WHERE id=$1", [hCard.id]))[0].stage, "qc");

    // The by-order view puts the order's suppliers side by side.
    await page.getByTestId("followup-view-orders").click();
    const orderBlock = page.getByTestId("followup-order");
    await orderBlock.waitFor();
    assert.equal(await orderBlock.getByTestId("followup-mini").count(), 3);
    assert.match(await orderBlock.innerText(), /0\/3 at warehouse/);
    await page.getByTestId("followup-view-board").click();

    // The Chinese board reads in Chinese and keeps the English beside it.
    await page.goto(`${BASE}/zh/followup?order=${open.id}`);
    await page.getByTestId("followup-column-deposit").waitFor();
    assert.match(await page.getByTestId("followup-column-deposit").innerText(), /待付定金[\s\S]*deposit due/i);
    assert.match(await tile(jCard.id).getByTestId("followup-card-product").innerText(), /电动漂移三轮车8寸/);
    assert.match(await tile(jCard.id).getByTestId("followup-due").innerText(), /逾期 1 天/);
    await page.screenshot({ path: `${SHOTS}/board-zh.png`, fullPage: true, animations: "disabled" });

    // Shipped: one card for the order and its paperwork, no supplier cards.
    await page.goto(`${BASE}/en/followup?order=${shipped.id}`);
    const shipment = page.getByTestId("followup-shipment");
    await shipment.waitFor();
    assert.equal(await board.getByTestId("followup-card").count(), 0, "supplier cards leave the board once the order ships");
    // Two uploads plus the proforma the app makes itself; 17 required items.
    assert.equal(await shipment.getByTestId("followup-docs").innerText(), "3/17");
    assert.match(await shipment.getByTestId("followup-missing").innerText(), /Forwarder 货代 ×5/);
    await shipment.click();
    await panel.getByTestId("followup-dossier").waitFor();
    assert.equal(await panel.getByTestId("followup-dossier-item").count(), 19);
    assert.equal(await panel.locator('[data-testid="followup-dossier-item"][data-status="uploaded"]').count(), 2);
    assert.equal(await panel.locator('[data-testid="followup-dossier-item"][data-status="auto"]').count(), 1);
    assert.equal(await panel.getByTestId("followup-dossier-open").getAttribute("href"), `/en/orders/${shipped.id}#dossier`);
    assert.equal(await panel.getByTestId("followup-move-next").count(), 0, "a shipment has no production stages");
    await page.screenshot({ path: `${SHOTS}/shipment-en.png`, animations: "disabled" });

    // A card link opens the card, and a card from another company does not exist.
    await page.goto(`${BASE}/en/followup?card=${jCard.id}`);
    await page.getByTestId("followup-panel").getByTestId("followup-problem").waitFor();
    const [other] = await q("INSERT INTO companies(name) VALUES ($1) RETURNING id", [`${stamp}-other`]);
    try {
      const [otherUser] = await q("INSERT INTO users(company_id,email,password_hash,name,active) VALUES ($1,$2,'unused-test-account','Other',false) RETURNING id", [other.id, `${stamp}-other@example.com`]);
      const [otherClient] = await q("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client','Other client') RETURNING id", [other.id]);
      const [otherOrder] = await q("INSERT INTO orders(company_id,order_number,client_id,status,created_by) VALUES ($1,$2,$3,'confirmed',$4) RETURNING id", [other.id, `${stamp}-x`, otherClient.id, otherUser.id]);
      const [foreign] = await q("INSERT INTO followup_cards(company_id,order_id,kind) VALUES ($1,$2,'unassigned') RETURNING id", [other.id, otherOrder.id]);
      await page.goto(`${BASE}/en/followup?card=${foreign.id}`);
      await page.getByTestId("followup-panel").getByTestId("followup-missing-card").waitFor();
    } finally {
      await q("DELETE FROM followup_cards WHERE company_id=$1", [other.id]);
      await q("DELETE FROM orders WHERE company_id=$1", [other.id]);
      await q("DELETE FROM contacts WHERE company_id=$1", [other.id]);
      await q("DELETE FROM users WHERE company_id=$1", [other.id]);
      await q("DELETE FROM companies WHERE id=$1", [other.id]);
    }

    assert.deepEqual(errors, [], "no client-side errors");
  } finally {
    await browser.close();
    const files = created.orders.length
      ? await q(
          "SELECT a.path FROM followup_attachments a JOIN followup_entries e ON e.id=a.entry_id JOIN followup_cards c ON c.id=e.card_id WHERE c.order_id = ANY($1)",
          [created.orders],
        )
      : [];
    for (const f of files) await rm(path.join(UPLOADS, f.path.replace(/^\/uploads\//, "")), { force: true });
    if (created.orders.length) await q("DELETE FROM orders WHERE id = ANY($1)", [created.orders]);
    if (created.products.length) await q("DELETE FROM products WHERE id = ANY($1)", [created.products]);
    if (created.contacts.length) await q("DELETE FROM contacts WHERE id = ANY($1)", [created.contacts]);
    if (created.categories.length) await q("DELETE FROM categories WHERE id = ANY($1)", [created.categories]);
    if (created.users.length) await q("DELETE FROM users WHERE id = ANY($1)", [created.users]);
    await sql.end();
  }
});
