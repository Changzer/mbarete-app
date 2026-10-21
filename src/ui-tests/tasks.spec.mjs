/** The task bell against the real app and a disposable database: one person hands work to another. */
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
const SHOTS = "artifacts/tasks";

const utcDate = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

test("a step and a checklist item given to the assistant ring their bell, once", { timeout: 180_000 }, async () => {
  assert.ok(process.env.DATABASE_ADMIN_URL, "explicit disposable test database required");
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  const q = async (text, values) => (await sql.query(text, values)).rows;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const created = { orders: [], products: [], contacts: [], users: [], categories: [] };
  const errors = [];
  try {
    const [admin] = await q("SELECT id, company_id, name, password_hash FROM users WHERE email=$1", [EMAIL]);
    const company = admin.company_id;
    const stamp = `bell-${Date.now()}`;
    await mkdir(SHOTS, { recursive: true });
    // The assistant signs in with the admin's password: same hash, own account.
    const liEmail = `${stamp}-li@example.com`;
    const [li] = await q(
      "INSERT INTO users(company_id,email,password_hash,name,active,role) VALUES ($1,$2,$3,'Li 小李',true,'collaborator') RETURNING id",
      [company, liEmail, admin.password_hash],
    );
    created.users.push(li.id);
    const [category] = await q("INSERT INTO categories(company_id,name_en,name_zh) VALUES ($1,$2,'铃') RETURNING id", [company, stamp]);
    created.categories.push(category.id);
    const [client] = await q("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client',$2) RETURNING id", [company, `Client ${stamp}`]);
    const [angel] = await q(
      "INSERT INTO contacts(company_id,type,company_name,company_name_zh) VALUES ($1,'supplier','Angel Packing Company','义乌天使化妆品包装') RETURNING id",
      [company],
    );
    created.contacts.push(client.id, angel.id);
    const [bottle] = await q(
      "INSERT INTO products(company_id,sku,name_en,name_zh,category_id,price,currency,moq,qty_per_box) VALUES ($1,$2,'50ml Foam Pump Bottle','50毫升泡沫泵瓶',$3,1.5,'CNY',1,600) RETURNING id",
      [company, stamp, category.id],
    );
    created.products.push(bottle.id);
    const [order] = await q(
      "INSERT INTO orders(company_id,order_number,client_id,status,rates_snapshot,created_by) VALUES ($1,$2,$3,'confirmed','{\"USD\":1,\"CNY\":0.14}',$4) RETURNING id, order_number",
      [company, stamp, client.id, admin.id],
    );
    created.orders.push(order.id);
    await q(
      `INSERT INTO order_items(company_id,order_id,product_id,quantity,unit_price_snapshot,sell_price_snapshot,currency_snapshot,moq_snapshot,line_total,line_cbm,line_weight_kg,cartons_snapshot,sku_snapshot,name_en_snapshot,name_zh_snapshot,qty_per_box_snapshot,carton_cbm_snapshot,carton_weight_snapshot,sell_currency_snapshot,supplier_id_snapshot,supplier_name_en_snapshot,supplier_name_zh_snapshot)
       VALUES ($1,$2,$3,3000,1.5,0.8,'CNY',3000,4500,0.01,1,5,$4,'50ml Foam Pump Bottle','50毫升泡沫泵瓶',600,0.01,1,'USD',$5,'Angel Packing Company','义乌天使化妆品包装')`,
      [company, order.id, bottle.id, stamp, angel.id],
    );

    const signIn = async (email) => {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${BASE}/en/login`);
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForURL(/catalog/);
      return page;
    };
    const openBell = async (page) => {
      await page.getByTestId("task-bell").click();
      const panel = page.getByTestId("task-panel");
      await panel.waitFor();
      return panel;
    };

    // Abel opens the board: the factory's card is his, as the order's maker — on his list, not new.
    const abel = await signIn(EMAIL);
    await abel.goto(`${BASE}/en/followup?order=${order.id}`);
    await abel.getByTestId("followup-board").waitFor();
    const [card] = await q("SELECT id FROM followup_cards WHERE order_id=$1 AND kind='supplier'", [order.id]);
    let panel = await openBell(abel);
    const abelRow = panel.locator(`[data-testid="task-row"][data-key="step:${card.id}"]`);
    await abelRow.waitFor();
    assert.match(await abelRow.innerText(), /Pay the deposit[\s\S]*义乌天使化妆品包装[\s\S]*50ml Foam Pump Bottle/);
    assert.equal(await abelRow.getAttribute("data-new"), "false", "your own card does not announce itself");
    await abel.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });

    // He hands the next step to Li with yesterday's date, and gives her a checklist item.
    await abel.locator(`[data-testid="followup-card"][data-card="${card.id}"]`).click();
    const cardPanel = abel.getByTestId("followup-panel");
    await cardPanel.getByTestId("followup-next-text").fill("Ask the factory for carton photos");
    await cardPanel.getByTestId("followup-next-due").fill(utcDate(-1));
    await cardPanel.getByTestId("followup-next-owner").selectOption(String(li.id));
    await cardPanel.getByTestId("followup-next-save").click();
    await cardPanel.locator('[data-testid="followup-entry"][data-kind="next_step"]').waitFor();
    await cardPanel.getByTestId("followup-check-input").fill("Send the carton marks to the factory");
    await cardPanel.getByTestId("followup-check-owner").selectOption(String(li.id));
    await cardPanel.getByTestId("followup-check-add").click();
    await cardPanel.getByTestId("followup-check-item").filter({ hasText: "Send the carton marks" }).waitFor();
    const [item] = await q("SELECT id, assigned_by FROM followup_checklist_items WHERE card_id=$1", [card.id]);
    assert.equal(item.assigned_by, admin.id);
    assert.equal((await q("SELECT next_assigned_by FROM followup_cards WHERE id=$1", [card.id]))[0].next_assigned_by, admin.id);
    // It has left his list.
    await abel.goto(`${BASE}/en/catalog`);
    panel = await openBell(abel);
    await panel.locator('[data-testid="task-row"], [data-testid="task-empty"]').first().waitFor();
    assert.equal(await panel.locator(`[data-key="step:${card.id}"]`).count(), 0);

    // Li's bell: two new tasks, the step overdue.
    const liPage = await signIn(liEmail);
    const badge = liPage.getByTestId("task-bell-count");
    await badge.waitFor();
    assert.equal(await badge.innerText(), "2");
    await liPage.screenshot({ path: `${SHOTS}/bell-badge.png`, clip: { x: 900, y: 0, width: 540, height: 64 } });
    panel = await openBell(liPage);
    const step = panel.locator(`[data-testid="task-row"][data-key="step:${card.id}"]`);
    const check = panel.locator(`[data-testid="task-row"][data-key="check:${item.id}"]`);
    await step.waitFor();
    assert.deepEqual(
      (await panel.getByTestId("task-row").evaluateAll((rows) => rows.map((r) => r.dataset.key))).sort(),
      [`check:${item.id}`, `step:${card.id}`],
    );
    assert.equal(await panel.getByTestId("task-row").count(), 2, "only what was handed to her");
    assert.match(await step.innerText(), /Ask the factory for carton photos/);
    assert.match(await step.innerText(), new RegExp(`New · From ${admin.name}`));
    assert.equal(await step.locator('[data-testid="task-due"][data-state="overdue"]').count(), 1);
    assert.match(await check.innerText(), /Send the carton marks to the factory/);
    assert.equal(await check.getAttribute("data-new"), "true");
    // Opening the bell is reading it: the count drops to what is still overdue, the marks stay while it is open.
    await liPage.waitForFunction(() => document.querySelector('[data-testid="task-bell-count"]')?.textContent === "1");
    assert.equal(await step.getAttribute("data-new"), "true");
    await liPage.screenshot({ path: `${SHOTS}/bell-open-en.png`, animations: "disabled" });
    for (let i = 0; i < 20 && !(await q("SELECT tasks_seen_at FROM users WHERE id=$1", [li.id]))[0].tasks_seen_at; i++) {
      await liPage.waitForTimeout(250);
    }
    assert.ok((await q("SELECT tasks_seen_at FROM users WHERE id=$1", [li.id]))[0].tasks_seen_at);

    // A task opens its card on the board — also from the board itself.
    await liPage.goto(`${BASE}/en/followup`);
    await liPage.getByTestId("followup-board").waitFor();
    panel = await openBell(liPage);
    const seenStep = panel.locator(`[data-testid="task-row"][data-key="step:${card.id}"]`);
    await seenStep.waitFor();
    assert.equal(await seenStep.getAttribute("data-new"), "false", "seen stays seen");
    await seenStep.click();
    await panel.waitFor({ state: "hidden" });
    await liPage.waitForURL(new RegExp(`card=${card.id}`));
    const liCard = liPage.getByTestId("followup-panel");
    await liCard.getByTestId("followup-check-item").first().waitFor();
    assert.match(await liCard.innerText(), /义乌天使化妆品包装/);

    // Li ticks her item: it leaves her bell without anything to dismiss.
    await liCard.getByTestId("followup-check-item").filter({ hasText: "Send the carton marks" }).getByTestId("followup-check-toggle").click();
    await liCard.locator('[data-testid="followup-check-item"][data-done="true"]').waitFor();
    await liPage.getByTestId("followup-panel-close").click();

    // Abel moves the card on: a new stage is a new step for its holder.
    await abel.goto(`${BASE}/en/followup?card=${card.id}`);
    await abel.getByTestId("followup-panel").getByTestId("followup-move-next").click();
    await abel.getByTestId("followup-panel").locator('[data-testid="followup-entry"][data-kind="stage"]').waitFor();
    await liPage.goto(`${BASE}/zh/catalog`);
    await liPage.getByTestId("task-bell-count").waitFor();
    panel = await openBell(liPage);
    const moved = panel.locator(`[data-testid="task-row"][data-key="step:${card.id}"]`);
    await moved.waitFor();
    assert.equal(await panel.getByTestId("task-row").count(), 1, "the ticked item is gone");
    assert.match(await panel.innerText(), /我的任务/);
    assert.match(await moved.innerText(), /跟进生产/);
    assert.match(await moved.innerText(), new RegExp(`新 · 来自 ${admin.name}`));
    await liPage.screenshot({ path: `${SHOTS}/bell-open-zh.png`, animations: "disabled" });

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    try {
      if (created.orders.length) await q("DELETE FROM orders WHERE id = ANY($1)", [created.orders]);
      if (created.products.length) await q("DELETE FROM products WHERE id = ANY($1)", [created.products]);
      if (created.contacts.length) await q("DELETE FROM contacts WHERE id = ANY($1)", [created.contacts]);
      if (created.categories.length) await q("DELETE FROM categories WHERE id = ANY($1)", [created.categories]);
      if (created.users.length) {
        // Signing in leaves a day of activity behind; it goes with the account.
        await q("DELETE FROM user_activity_days WHERE user_id = ANY($1)", [created.users]);
        await q("DELETE FROM entity_events WHERE user_id = ANY($1)", [created.users]);
        await q("DELETE FROM users WHERE id = ANY($1)", [created.users]);
      }
    } finally {
      await sql.end();
    }
  }
});
