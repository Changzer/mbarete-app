/** Run against the disposable CI database and production server, after seeding. */
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

async function select(page, testId, label) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

test("freight estimates stay honest and optional through capture, saving and review", { timeout: 120_000 }, async () => {
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  const stamp = `cost-qa-${Date.now()}`;
  const { rows: [account] } = await sql.query("SELECT id, company_id FROM users WHERE email=$1", [EMAIL]);
  const companyId = account.company_id;
  const { rows: [oldProfile] } = await sql.query("SELECT functional_currency FROM company_profile WHERE company_id=$1", [companyId]);
  const pageErrors = [];
  try {
    await sql.query("INSERT INTO company_profile (company_id,functional_currency) VALUES ($1,'USD') ON CONFLICT (company_id) DO UPDATE SET functional_currency='USD'", [companyId]);
    for (const [mode, basis, amount, date] of [["lcl", "per_cbm", 120, "2020-01-01"], ["fcl", "per_40hq", 6800, "2020-01-01"], ["lcl", "per_cbm", 9000, "2099-01-01"]]) {
      await sql.query("INSERT INTO shipping_rates (company_id,destination,mode,basis,amount,currency,usable_cbm,effective_from,note,created_by) VALUES ($1,'BR',$2,$3,$4,'USD',68,$5,$6,$7)", [companyId, mode, basis, amount, date, stamp, account.id]);
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/, { timeout: 30_000 });

    // Scheduled quotes are visible in history but do not affect today's rate.
    await page.goto(`${BASE}/en/settings`);
    assert.match(await page.getByTestId("shipping-current-BR-lcl").textContent(), /120\.00/);
    assert.ok(await page.getByText("Scheduled", { exact: true }).isVisible());
    // An action that returns an error must retain the quote, not reset it.
    await sql.query("CREATE FUNCTION landed_cost_qa_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.note LIKE 'cost-qa-%-failure' THEN RAISE EXCEPTION 'quote QA failure'; END IF; RETURN NEW; END $$");
    await sql.query("CREATE TRIGGER landed_cost_qa_reject BEFORE INSERT ON shipping_rates FOR EACH ROW EXECUTE FUNCTION landed_cost_qa_reject()");
    await select(page, "ship-destination", "Paraguay");
    await page.getByTestId("ship-amount").fill("140,5");
    await page.locator("#ship-note").fill(`${stamp}-failure`);
    await page.getByTestId("ship-save").click();
    await page.getByRole("alert").filter({ hasText: "Could not save the quote" }).waitFor();
    assert.equal(await page.getByTestId("ship-amount").inputValue(), "140,5");
    assert.equal(await page.locator("#ship-note").inputValue(), `${stamp}-failure`);
    await sql.query("DROP TRIGGER landed_cost_qa_reject ON shipping_rates");
    await sql.query("DROP FUNCTION landed_cost_qa_reject()");
    await page.getByTestId("ship-save").click();
    await page.getByRole("status").filter({ hasText: "Estimate recorded" }).waitFor();
    assert.equal((await sql.query("SELECT amount FROM shipping_rates WHERE note=$1", [`${stamp}-failure`])).rows[0].amount, "140.5000");

    await page.goto(`${BASE}/en/catalog/new`);
    assert.equal(await page.getByTestId("export-details").getAttribute("open"), null, "export does not interrupt capture");
    await page.fill('input[name="nameEn"]', stamp);
    await page.fill('input[name="price"]', "10");
    await page.fill('input[name="qtyPerBox"]', "100");
    await page.getByTestId("dimensions-disclosure").click();
    await page.fill("#cbmOverride", "0.05");
    await page.getByTestId("dimensions-disclosure").click();
    assert.equal(await page.locator("#cbmOverride").inputValue(), "0.05", "folding dimensions preserves submitted measurements");
    await page.getByTestId("export-disclosure").click();
    await select(page, "export-destination", "Brazil");
    assert.equal(await page.getByTestId("landed-total-lcl").textContent(), "—", "no total with unknown duty");
    assert.equal(await page.getByTestId("landed-cheaper").count(), 0);
    await page.getByTestId("import-duty").fill("0");
    assert.equal(await page.getByTestId("landed-total-lcl").textContent(), "10.06 USD");
    assert.equal(await page.getByTestId("landed-total-fcl").textContent(), "10.05 USD");
    assert.match(await page.getByTestId("landed-fcl-assumption").textContent(), /68 m³/);
    assert.match(await page.getByTestId("landed-scope").textContent(), /not the full landed cost/);

    // The live freight share must use the same piece estimate that saving uses.
    await page.getByTestId("dimensions-disclosure").click();
    await page.getByRole("button", { name: "I only have the product size", exact: true }).click();
    for (const dimension of ["pieceLengthCm", "pieceWidthCm", "pieceHeightCm"]) await page.locator(`#${dimension}`).fill("10");
    await page.locator("#packingAllowancePct").fill("15");
    assert.equal(await page.getByTestId("landed-shipping-lcl").textContent(), "0.138 USD");
    await page.getByTestId("dimensions-disclosure").click();

    await mkdir("artifacts/landed-cost", { recursive: true });
    await page.getByTestId("export-details").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/landed-cost/desktop.png", caret: "initial" });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByTestId("export-details").scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}px`);
      await page.screenshot({ path: `artifacts/landed-cost/mobile-${width}.png`, caret: "initial" });
    }
    await select(page, "export-destination", "Paraguay");
    await page.getByTestId("import-duty").fill("0");
    assert.equal(await page.getByTestId("landed-total-fcl").textContent(), "—", "missing FCL rate has no total");
    assert.equal(await page.getByTestId("landed-cheaper").count(), 0);
    await page.getByTestId("import-duty").fill("");
    await page.getByTestId("export-disclosure").click();
    await page.getByTestId("save-product").click();
    await page.waitForURL(/\/catalog(\?|$)/, { timeout: 30_000 });
    const { rows: [saved] } = await sql.query("SELECT id, import_duty_pct_br, import_duty_pct_py, export_destination, cbm FROM products WHERE company_id=$1 AND name_en=$2", [companyId, stamp]);
    assert.equal(Number(saved.import_duty_pct_br), 0);
    assert.equal(saved.import_duty_pct_py, null);
    assert.equal(saved.export_destination, "PY");
    assert.equal(Number(saved.cbm), 0.115);

    // Offline-form captures keep a zero rate and the chosen destination on review.
    const delivery = await context.request.post(`${BASE}/api/drafts`, { multipart: {
      clientId: `${stamp}-draft`, kind: "product", capturedAt: new Date().toISOString(),
      fields: JSON.stringify({ nameEn: `${stamp}-draft`, exportDestination: "PY", importDutyPctBr: "", importDutyPctPy: "0" }),
    } });
    assert.equal(delivery.status(), 201);
    const { draftId } = await delivery.json();
    await page.goto(`${BASE}/en/catalog/new?draft=${draftId}`);
    assert.equal(await page.locator('input[name="exportDestination"]').inputValue(), "PY");
    assert.equal(await page.locator('input[name="importDutyPctPy"]').inputValue(), "0");
    assert.equal(await page.locator('input[name="importDutyPctBr"]').inputValue(), "");

    // A second product at the booth must never inherit the first one's duty.
    await page.goto(`${BASE}/en/catalog/new`);
    await page.fill('input[name="nameEn"]', `${stamp}-offline`);
    await page.fill('input[name="price"]', "99");
    await page.getByTestId("export-disclosure").click();
    await select(page, "export-destination", "Brazil");
    await page.getByTestId("import-duty").fill("25");
    await context.setOffline(true);
    await page.getByTestId("save-and-add-another").click();
    await page.getByTestId("saved-offline").waitFor();
    assert.equal(await page.locator('input[name="importDutyPctBr"]').inputValue(), "");
    assert.equal(await page.getByTestId("export-details").getAttribute("open"), null);
    await page.getByTestId("export-disclosure").click();
    assert.equal(await page.getByTestId("landed-total-lcl").textContent(), "—");
    await context.setOffline(false);

    // Chinese uses the same optional flow; verify the actual mobile rendering.
    await page.goto(`${BASE}/zh/catalog/${saved.id}/edit`);
    await page.getByTestId("export-disclosure").click();
    await page.getByTestId("export-details").scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: "artifacts/landed-cost/mobile-zh.png", caret: "initial" });
    assert.deepEqual(pageErrors, []);
  } finally {
    await sql.query("DROP TRIGGER IF EXISTS landed_cost_qa_reject ON shipping_rates");
    await sql.query("DROP FUNCTION IF EXISTS landed_cost_qa_reject()");
    await sql.query("DELETE FROM shipping_rates WHERE company_id=$1 AND note LIKE $2", [companyId, `${stamp}%`]);
    if (oldProfile) await sql.query("UPDATE company_profile SET functional_currency=$2 WHERE company_id=$1", [companyId, oldProfile.functional_currency]);
    else await sql.query("DELETE FROM company_profile WHERE company_id=$1", [companyId]);
    await sql.end();
    await browser.close();
  }
});
