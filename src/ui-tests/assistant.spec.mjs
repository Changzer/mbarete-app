/**
 * A chat assistant on the company's behalf, against the real app and a
 * disposable database: the admin adds it on the Team page and copies its key
 * once; with that key it reads an order, moves a card and posts an update
 * under its own name — and is refused everything it was not allowed, other
 * companies' data, bank details, deletions, and its old key after a new one.
 */
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
const SHOTS = "artifacts/assistant";
const API = `${BASE}/api/assistant/v1`;

function call(key, path, { method = "GET", body } = {}) {
  return fetch(`${API}${path}`, {
    method,
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
}

test("an assistant with a key does what it was allowed, under its own name, and nothing else", { timeout: 180_000 }, async () => {
  assert.ok(process.env.DATABASE_ADMIN_URL, "explicit disposable test database required");
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  const q = async (text, values) => (await sql.query(text, values)).rows;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const created = { orders: [], products: [], contacts: [], categories: [], companies: [] };
  const errors = [];
  let assistantId = null;
  try {
    const [admin] = await q("SELECT id, company_id, name FROM users WHERE email=$1", [EMAIL]);
    const company = admin.company_id;
    const stamp = `bot-${Date.now()}`;
    await mkdir(SHOTS, { recursive: true });

    const [category] = await q("INSERT INTO categories(company_id,name_en,name_zh) VALUES ($1,$2,'助手') RETURNING id", [company, stamp]);
    created.categories.push(category.id);
    const [client] = await q("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client',$2) RETURNING id", [company, `Loja ${stamp}`]);
    const [supplier] = await q(
      "INSERT INTO contacts(company_id,type,company_name,company_name_zh,bank_info) VALUES ($1,'supplier','Angel Packing','义乌天使包装','ICBC 6222 0000 1111 2222') RETURNING id",
      [company],
    );
    created.contacts.push(client.id, supplier.id);
    const [product] = await q(
      "INSERT INTO products(company_id,sku,name_en,name_zh,category_id,price,currency,moq,qty_per_box,supplier_id) VALUES ($1,$2,'Foam Pump Bottle','泡沫泵瓶',$3,1.37,'CNY',1,600,$4) RETURNING id",
      [company, stamp, category.id, supplier.id],
    );
    created.products.push(product.id);
    const [order] = await q(
      "INSERT INTO orders(company_id,order_number,client_id,status,rates_snapshot,created_by) VALUES ($1,$2,$3,'confirmed','{\"USD\":1,\"CNY\":0.14}',$4) RETURNING id, order_number",
      [company, `ORD-${stamp}`, client.id, admin.id],
    );
    created.orders.push(order.id);
    await q(
      `INSERT INTO order_items(company_id,order_id,product_id,quantity,unit_price_snapshot,sell_price_snapshot,currency_snapshot,moq_snapshot,line_total,line_cbm,line_weight_kg,cartons_snapshot,sku_snapshot,name_en_snapshot,name_zh_snapshot,qty_per_box_snapshot,carton_cbm_snapshot,carton_weight_snapshot,sell_currency_snapshot,supplier_id_snapshot,supplier_name_en_snapshot,supplier_name_zh_snapshot)
       VALUES ($1,$2,$3,3000,1.37,0.29,'CNY',3000,4110,0.01,1,5,$4,'Foam Pump Bottle','泡沫泵瓶',600,0.01,1,'USD',$5,'Angel Packing','义乌天使包装')`,
      [company, order.id, product.id, stamp, supplier.id],
    );
    // Another company's order, which no key of this company may ever see.
    const [other] = await q("INSERT INTO companies(name) VALUES ($1) RETURNING id", [`Other ${stamp}`]);
    created.companies.push(other.id);
    const [otherPerson] = await q(
      "INSERT INTO users(company_id,email,password_hash,name,role) VALUES ($1,$2,'!','Other admin','admin') RETURNING id",
      [other.id, `${stamp}-other@example.com`],
    );
    const [otherClient] = await q("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client','Elsewhere') RETURNING id", [other.id]);
    const [otherOrder] = await q(
      "INSERT INTO orders(company_id,order_number,client_id,status,rates_snapshot,created_by) VALUES ($1,$2,$3,'confirmed','{}',$4) RETURNING id",
      [other.id, `ORD-${stamp}-B`, otherClient.id, otherPerson.id],
    );

    // --- the admin adds the assistant and copies its key ---------------------
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/);
    await page.goto(`${BASE}/en/users`);
    const section = page.getByTestId("assistants");
    await section.getByTestId("assistant-add").click();
    await section.locator("#assistant-name").fill(`OpenClaw ${stamp}`);
    assert.equal(await section.getByTestId("assistant-new-followup").isChecked(), true, "the board is the usual job");
    assert.equal(await section.getByTestId("assistant-new-prices").isChecked(), false, "money stays home unless ticked");
    await section.getByTestId("assistant-create").click();
    const keyText = section.getByTestId("assistant-key");
    await keyText.waitFor();
    const key = (await keyText.innerText()).trim();
    assert.match(key, /^mbk_\d+_[A-Za-z0-9_-]{43}$/);
    await page.screenshot({ path: `${SHOTS}/assistant-key-en.png`, fullPage: true });
    const [account] = await q("SELECT id, kind, role, platform_admin, password_hash, active FROM users WHERE name=$1", [`OpenClaw ${stamp}`]);
    assistantId = account.id;
    assert.deepEqual(
      { kind: account.kind, role: account.role, platform: account.platform_admin, hash: account.password_hash },
      { kind: "assistant", role: "collaborator", platform: false, hash: "!" },
    );
    const [stored] = await q("SELECT token_hash, scopes FROM assistant_keys WHERE user_id=$1", [assistantId]);
    assert.equal(stored.scopes, "followup");
    assert.ok(!key.includes(stored.token_hash), "only the hash is kept");
    // The skill file comes with this app's address and no key.
    const skill = await (await fetch(`${BASE}/api/assistant/skill`)).text();
    assert.ok(skill.includes(`${new URL(BASE).origin}/api/assistant/v1`));
    assert.doesNotMatch(skill, /mbk_\d/);

    // --- no key, a wrong key, another company ---------------------------------
    assert.equal((await call(null, "")).status, 401);
    assert.equal((await call(key.slice(0, -2) + "xx", "")).status, 401);
    assert.equal((await call(key.replace(/^mbk_\d+_/, `mbk_${admin.id}_`), "")).status, 401, "a person's id is no assistant");
    const me = await call(key, "");
    assert.equal(me.status, 200);
    assert.equal(me.json.assistant, `OpenClaw ${stamp}`);
    assert.deepEqual(me.json.allowed, ["read", "followup"]);
    assert.ok(!me.json.endpoints.some((e) => e.startsWith("POST /api/assistant/v1/contacts")), "it is not offered what it may not do");
    assert.equal((await call(key, `/orders/${otherOrder.id}`)).status, 404);
    assert.equal((await call(key, `/orders?q=${stamp}-B`)).json.orders.length, 0);
    assert.equal((await call(key, "/settings")).status, 404);

    // --- reading: the order and its card, no money ----------------------------
    const found = await call(key, `/orders?q=${stamp}`);
    assert.deepEqual(found.json.orders.map((o) => o.number), [order.order_number]);
    const detail = await call(key, `/orders/${order.order_number}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.order.lines[0].supplier, "Angel Packing");
    assert.equal(detail.json.order.totals.cartons, 5);
    const text = JSON.stringify(detail.json);
    assert.ok(!text.includes("1.37") && !text.includes("4110") && !("cost" in detail.json.order.lines[0]), "no prices without the tick");
    const card = detail.json.order.followup.find((c) => c.type === "supplier");
    assert.equal(card.stage, "deposit");
    assert.deepEqual(card.stageName, { en: "Deposit due", zh: "待付定金" });
    const zh = await call(key, `/followup?order=${stamp}&lang=zh`);
    assert.equal(zh.json.cards[0].supplier.name, "义乌天使包装");
    const contact = await call(key, `/contacts/${supplier.id}`);
    assert.equal(contact.json.contact.nameZh, "义乌天使包装");
    assert.ok(!JSON.stringify(contact.json).includes("6222"), "bank details never leave");
    const team = await call(key, "/team");
    assert.ok(team.json.people.some((p) => p.id === admin.id));
    assert.ok(!team.json.people.some((p) => p.id === assistantId), "it is not on the team");

    // --- "the deposit is paid": move the card, say so --------------------------
    const stale = await call(key, `/followup/${card.id}/stage`, { method: "POST", body: { stage: "production", version: card.version + 5 } });
    assert.equal(stale.status, 409);
    assert.match(stale.json.message, /Read it again/);
    const moved = await call(key, `/followup/${card.id}/stage`, { method: "POST", body: { stage: "production", version: card.version } });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal(moved.json.card.stage, "production");
    for (let i = 0; i < 2; i++) {
      const posted = await call(key, `/followup/${card.id}/updates`, { method: "POST", body: { text: "Deposit paid by bank transfer", key: `dep-${stamp}` } });
      assert.equal(posted.status, 200);
    }
    const toSelf = await call(key, `/followup/${card.id}/next-step`, {
      method: "POST",
      body: { text: "Check samples", ownerId: assistantId, version: moved.json.card.version },
    });
    assert.equal(toSelf.status, 400, "an assistant never holds work");
    const handed = await call(key, `/followup/${card.id}/next-step`, {
      method: "POST",
      body: { text: "Check samples", due: "2026-11-05", ownerId: admin.id, version: moved.json.card.version },
    });
    assert.equal(handed.status, 200, JSON.stringify(handed.json));
    assert.deepEqual(handed.json.card.nextOwner, { id: admin.id, name: admin.name });
    const entries = await q("SELECT kind, user_id FROM followup_entries WHERE card_id=$1 ORDER BY id", [card.id]);
    assert.deepEqual(
      entries.map((e) => [e.kind, e.user_id === assistantId]),
      [["stage", true], ["comment", true], ["next_step", true]],
      "one update for two sends, every change in its own name",
    );

    // --- what it may not do -----------------------------------------------------
    const addContact = await call(key, "/contacts", { method: "POST", body: { type: "supplier", name: "Sneaky" } });
    assert.equal(addContact.status, 403);
    assert.match(addContact.json.message, /Team page/);
    const del = await fetch(`${API}/followup/${card.id}`, { method: "DELETE", headers: { authorization: `Bearer ${key}` } });
    assert.equal(del.status, 405, "there is no delete");
    const form = await fetch(`${API}/followup/${card.id}/updates`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
      body: "text=x",
    });
    assert.equal(form.status, 415, "JSON only");

    // --- the board shows its name; "who" never offers it ---------------------------
    await page.goto(`${BASE}/en/followup?order=${order.id}&card=${card.id}`);
    const panel = page.getByTestId("followup-panel");
    await panel.locator('[data-testid="followup-entry"][data-kind="comment"]').waitFor();
    assert.match(await panel.locator('[data-testid="followup-entry"][data-kind="comment"]').innerText(), new RegExp(`OpenClaw ${stamp}[\\s\\S]*Deposit paid by bank transfer`));
    const ownerOptions = await panel.getByTestId("followup-next-owner").locator("option").allInnerTexts();
    assert.ok(!ownerOptions.includes(`OpenClaw ${stamp}`), ownerOptions.join(", "));
    await page.screenshot({ path: `${SHOTS}/assistant-on-card-en.png` });

    // --- the admin allows contacts and prices ------------------------------------
    await page.goto(`${BASE}/en/users`);
    const item = page.getByTestId(`assistant-${assistantId}`);
    await item.getByTestId(`assistant-${assistantId}-edit`).click();
    await item.getByTestId(`assistant-${assistantId}-scope-contacts`).check();
    await item.getByTestId(`assistant-${assistantId}-scope-prices`).check();
    await item.getByTestId(`assistant-${assistantId}-save`).click();
    await item.getByTestId(`assistant-${assistantId}-edit`).waitFor();
    assert.equal((await q("SELECT scopes FROM assistant_keys WHERE user_id=$1", [assistantId]))[0].scopes, "followup,contacts,prices");
    const priced = await call(key, `/orders/${order.id}`);
    assert.equal(priced.json.order.lines[0].cost, 1.37);
    const added = await call(key, "/contacts", { method: "POST", body: { type: "supplier", nameZh: `新供应商 ${stamp}`, booth: "F1-12345", bankInfo: "steal" } });
    assert.equal(added.status, 200, JSON.stringify(added.json));
    created.contacts.push(added.json.contact.id);
    const patched = await call(key, `/contacts/${supplier.id}`, { method: "PATCH", body: { wechat: "angel_pack", bankInfo: "ATTACKER 9999" } });
    assert.equal(patched.status, 200);
    const [bank] = await q("SELECT bank_info, wechat FROM contacts WHERE id=$1", [supplier.id]);
    assert.deepEqual(bank, { bank_info: "ICBC 6222 0000 1111 2222", wechat: "angel_pack" }, "bank details untouched");

    // --- a new key retires the old; switched off, nothing works ----------------------
    await item.getByTestId(`assistant-${assistantId}-newkey`).click();
    await page.waitForFunction((old) => {
      const el = document.querySelector('[data-testid="assistant-key"]');
      return el && el.textContent.trim() !== old;
    }, key);
    const newKey = (await page.getByTestId("assistant-key").innerText()).trim();
    assert.equal((await call(key, "")).status, 401, "the old key stops at once");
    assert.equal((await call(newKey, "")).status, 200);
    await item.getByTestId(`assistant-${assistantId}-off`).click();
    await item.getByTestId(`assistant-${assistantId}-on`).waitFor();
    assert.equal((await call(newKey, "")).status, 401);
    const trail = await page.getByTestId("admin-activity").innerText();
    assert.match(trail, new RegExp(`added the assistant OpenClaw ${stamp}`));
    assert.match(trail, new RegExp(`switched off the assistant OpenClaw ${stamp}`));
    await page.screenshot({ path: `${SHOTS}/assistants-section-en.png`, fullPage: true });

    // --- the team list and sign-in never see it ---------------------------------------
    assert.equal(await page.locator(`[data-testid^="user-row-"]`).filter({ hasText: `OpenClaw ${stamp}` }).count(), 0);
    await page.goto(`${BASE}/zh/users`);
    await page.getByTestId("assistants").waitFor();
    await page.screenshot({ path: `${SHOTS}/assistants-section-zh.png`, fullPage: true });

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    try {
      if (created.orders.length) await q("DELETE FROM orders WHERE id = ANY($1)", [created.orders]);
      await q("DELETE FROM orders WHERE company_id = ANY($1)", [created.companies]);
      if (created.products.length) await q("DELETE FROM products WHERE id = ANY($1)", [created.products]);
      await q("DELETE FROM contacts WHERE company_id = ANY($1)", [created.companies]);
      if (created.contacts.length) await q("DELETE FROM contacts WHERE id = ANY($1)", [created.contacts]);
      if (created.categories.length) await q("DELETE FROM categories WHERE id = ANY($1)", [created.categories]);
      if (assistantId !== null) {
        await q("DELETE FROM assistant_keys WHERE user_id = $1", [assistantId]);
        await q("DELETE FROM admin_events WHERE target_user_id = $1", [assistantId]);
        await q("DELETE FROM entity_events WHERE user_id = $1", [assistantId]);
        await q("DELETE FROM user_activity_days WHERE user_id = $1", [assistantId]);
        await q("DELETE FROM users WHERE id = $1", [assistantId]);
      }
      await q("DELETE FROM users WHERE company_id = ANY($1)", [created.companies]);
      if (created.companies.length) await q("DELETE FROM companies WHERE id = ANY($1)", [created.companies]);
    } finally {
      await sql.end();
    }
  }
});
