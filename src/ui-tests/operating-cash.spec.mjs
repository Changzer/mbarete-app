import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";

test("only the two Tailong cash accounts reconcile expenses and bank checks", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch();
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  let accountId, xtransferId;
  try {
    const account = (await sql.query("SELECT id,company_id FROM users WHERE email=$1", [EMAIL])).rows[0];
    accountId = (await sql.query(
      "SELECT id FROM bank_accounts WHERE company_id=$1 AND label='Tailong RMB' AND currency='CNY' AND track_balance=true",
      [account.company_id],
    )).rows[0].id;
    assert.ok(accountId, "Tailong RMB is provisioned automatically");
    const usd = (await sql.query(
      "SELECT id FROM bank_accounts WHERE company_id=$1 AND label='Tailong USD' AND currency='USD' AND track_balance=true",
      [account.company_id],
    )).rows[0];
    assert.ok(usd, "Tailong USD is provisioned automatically");
    xtransferId = (await sql.query(
      "INSERT INTO bank_accounts(company_id,label,currency) VALUES ($1,'XTransfer QA','USD') RETURNING id",
      [account.company_id],
    )).rows[0].id;
    const page = await browser.newPage();
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/, { timeout: 30_000 });
    await page.goto(`${BASE}/en/finance`);

    const cash = page.getByTestId("operating-cash");
    await page.getByTestId(`cash-account-${accountId}`).waitFor();
    await page.getByTestId(`cash-account-${usd.id}`).waitFor();
    assert.equal(await cash.locator('[data-testid^="cash-account-"]').count(), 2);
    assert.equal(await cash.getByText("XTransfer QA", { exact: false }).count(), 0);
    assert.deepEqual(
      await cash.locator('[data-testid^="cash-account-"] h3').allTextContents(),
      ["Tailong RMB · CNY", "Tailong USD · USD"],
    );

    await page.getByTestId(`opening-balance-${accountId}`).fill("100000");
    await page.getByTestId(`opening-date-${accountId}`).fill("2026-01-01");
    await page.getByTestId(`opening-form-${accountId}`).getByRole("button", { name: "Save opening" }).click();
    await page.waitForFunction((id) => {
      const select = document.querySelector('[data-testid="operating-account"]');
      return select instanceof HTMLSelectElement && [...select.options].some((option) => option.value === id);
    }, String(accountId));

    await page.getByTestId("operating-category").selectOption("rent");
    await page.getByTestId("operating-amount").fill("5000");
    await page.getByTestId("operating-currency").fill("CNY");
    await page.getByTestId("operating-account").selectOption(String(accountId));
    await page.getByTestId("operating-vendor").fill("QA Landlord");
    await page.getByTestId("operating-note").fill("January rent");
    await page.getByTestId("operating-expense-save").click();
    await page.getByText("95,000.00 CNY", { exact: false }).first().waitFor({ timeout: 15_000 });

    await page.getByTestId(`actual-balance-${accountId}`).fill("95000");
    await page.getByTestId(`check-form-${accountId}`).getByRole("button", { name: "Record balance check" }).click();
    await page.getByText("Difference: 0.00 CNY", { exact: false }).waitFor({ timeout: 15_000 });

    await page.getByTestId("cash-kind").selectOption("other_income");
    await page.getByTestId("cash-amount").fill("1000");
    await page.getByTestId("cash-currency").fill("CNY");
    await page.getByTestId("cash-account").selectOption(String(accountId));
    await page.getByTestId("cash-transaction-save").click();
    await page.getByText("96,000.00 CNY", { exact: false }).first().waitFor({ timeout: 15_000 });

    assert.equal((await sql.query("SELECT category,amount,vendor FROM operating_expenses WHERE account_id=$1", [accountId])).rows[0].category, "rent");
    assert.equal(Number((await sql.query("SELECT amount FROM cash_balance_checks WHERE account_id=$1", [accountId])).rows[0].amount), 95000);
    assert.equal((await sql.query("SELECT kind,amount FROM cash_transactions WHERE account_id=$1", [accountId])).rows[0].kind, "other_income");
  } finally {
    if (accountId) {
      await sql.query("DELETE FROM operating_expenses WHERE account_id=$1", [accountId]);
      await sql.query("DELETE FROM cash_transactions WHERE account_id=$1 OR destination_account_id=$1", [accountId]);
      await sql.query("DELETE FROM cash_balance_checks WHERE account_id=$1", [accountId]);
      await sql.query("UPDATE bank_accounts SET opening_balance=0,opening_date='' WHERE id=$1", [accountId]);
    }
    if (xtransferId) await sql.query("DELETE FROM bank_accounts WHERE id=$1", [xtransferId]);
    await browser.close();
    await sql.end();
  }
});
