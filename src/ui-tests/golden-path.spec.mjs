/**
 * The golden path, walked end to end in a real browser: an offline capture
 * lands as a draft, the AI read (a stubbed vision API — scripts/e2e/
 * vision-stub.mjs) fills it in, the draft is promoted to a product, the
 * product goes onto an order, and the order exports as a price quote that
 * becomes a proforma invoice on confirmation. Every link is unit-tested
 * elsewhere; this is the one test that proves the chain holds — the whole
 * promise of the product is that the booth photo becomes the invoice.
 *
 * Run with `npm run test:ui` against a server on BASE_URL whose
 * MOONSHOT_BASE_URL points at the vision stub. Kept out of `npm test`,
 * which is the pure-logic suite and needs no server.
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";
import ExcelJS from "exceljs";

const EXECUTABLE =
  process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const launch = () => chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";

// What the vision stub reads off every photo (scripts/e2e/vision-stub.mjs).
const STUB = {
  name: "Quilted PU Leather Handbag 24cm",
  supplierCode: "AA012604240",
  price: 13.08,
  moq: 24,
};

/**
 * A 100×100 red PNG, generated once with sharp — a real decodable image so
 * the thumbnail crop has pixels to cut, without a binary fixture in git.
 */
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkAQMAAABKLAcXAAAABlBMVEX/AAD///9BHTQRAAAAFElEQVR4AWOgOxgFo2AUjIJRMHQAAAZUAAGyx1LGAAAAAElFTkSuQmCC",
  "base64",
);

async function signedIn(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/en/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/catalog/, { timeout: 30_000 });
  return { context, page };
}

/** Fetch one export with the page's cookies and hand back parsed XLSX text. */
async function exportedSheet(context, orderId) {
  const response = await context.request.get(
    `${BASE}/api/orders/${orderId}/export?format=xlsx&locale=en`,
  );
  assert.equal(response.status(), 200, "export answered");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.body());
  const sheet = workbook.worksheets[0];
  const texts = [];
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const value = cell.value;
      if (typeof value === "string") texts.push(value);
      else if (typeof value === "number") texts.push(value.toFixed(2));
      else if (value && typeof value === "object" && "richText" in value)
        texts.push(value.richText.map((part) => part.text).join(""));
    });
  });
  return { sheet, text: texts.join("\n") };
}

test("a booth capture becomes a product, an order, a quote and an invoice", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);

    // ── 1. The phone delivers an offline capture ─────────────────────────
    const captureId = `e2e-${Date.now()}`;
    const delivered = await context.request.post(`${BASE}/api/drafts`, {
      multipart: {
        clientId: captureId,
        capturedAt: new Date().toISOString(),
        kind: "product",
        fields: JSON.stringify({}),
        images: { name: "booth.png", mimeType: "image/png", buffer: PHOTO },
      },
    });
    assert.equal(delivered.status(), 201, "capture stored");
    const { draftId } = await delivered.json();
    assert.ok(draftId > 0, "draft id minted");

    // A replay of the same capture must be told "already have it", not doubled.
    const replay = await context.request.post(`${BASE}/api/drafts`, {
      multipart: {
        clientId: captureId,
        capturedAt: new Date().toISOString(),
        kind: "product",
        fields: JSON.stringify({}),
        images: { name: "booth.png", mimeType: "image/png", buffer: PHOTO },
      },
    });
    assert.equal(replay.status(), 200, "replay deduplicated");
    assert.equal((await replay.json()).draftId, draftId);

    // ── 2. The AI read lands on the draft ────────────────────────────────
    // readDraft runs detached from the delivery; poll the drafts page until
    // the stub's reading shows on the card.
    await page.goto(`${BASE}/en/catalog/drafts`);
    const card = page.locator('[data-testid="draft-card"]', { hasText: STUB.name }).first();
    for (let i = 0; i < 20 && !(await card.isVisible()); i++) {
      await page.waitForTimeout(500);
      await page.reload();
    }
    assert.ok(await card.isVisible(), "draft shows the AI reading");

    // ── 3. Promote the draft to a product ────────────────────────────────
    await card.locator('[data-testid="open-draft"]').click();
    await page.waitForURL(/catalog\/new\?draft=/);
    assert.equal(
      await page.locator('input[name="nameEn"]').inputValue(),
      STUB.name,
      "the reading pre-fills the form",
    );

    // The offline read also carried the factory style number and the
    // cropped thumbnail into the review form.
    assert.equal(
      await page.locator('[data-testid="supplier-code"]').inputValue(),
      STUB.supplierCode,
      "factory style number read off the photo",
    );
    const thumbPath = await page.locator('input[name="thumbPath"]').inputValue();
    assert.match(thumbPath, /thumb-/, "the crop produced a thumbnail file");

    await page.click('[data-testid="save-product"]');
    await page.waitForURL(/\/en\/catalog(\?|$)/, { timeout: 30_000 });

    // ── 4. The product is really in the catalog ──────────────────────────
    // Both the phone and desktop layouts render the row; assert on whichever
    // one this viewport actually shows.
    await page
      .getByText(STUB.name)
      .filter({ visible: true })
      .first()
      .waitFor({ timeout: 15_000 })
      .catch((cause) => assert.fail(`product row visible in catalog — at ${page.url()}: ${cause}`));

    // ── 5. Build an order: new client, pick the product ──────────────────
    await page.goto(`${BASE}/en/orders/new`);
    await page.getByRole("button", { name: "+ New client" }).click();
    await page.fill('input[name="companyName"]', "Golden Path Client");
    await page
      .locator('div[role="dialog"] button[type="submit"]')
      .click();
    await page
      .locator('div[role="dialog"]')
      .waitFor({ state: "hidden", timeout: 15_000 });

    await page.click('[data-testid="open-picker"]');
    await page.getByText(STUB.name).filter({ visible: true }).first().click();
    await page.click('[data-testid="picker-add"]');

    // Added at its minimum full-carton quantity = MOQ 24 at 24/ctn.
    const line = page.locator('[data-testid^="line-"]', { hasText: STUB.name });
    await line.waitFor();
    assert.equal(
      await line.locator('[data-testid^="qty-"] span span').first().textContent(),
      String(STUB.moq),
      "line added at MOQ",
    );

    await page.getByRole("button", { name: "Save as Draft" }).click();
    await page.waitForURL(/\/en\/orders\/\d+/, { timeout: 30_000 });
    const orderId = Number(page.url().match(/orders\/(\d+)/)[1]);

    // ── 6. A draft exports as a price quote ──────────────────────────────
    const quote = await exportedSheet(context, orderId);
    assert.match(quote.text, /Price quote/, "draft export is titled as a quote");
    assert.doesNotMatch(quote.text, /Proforma invoice/i);
    assert.doesNotMatch(quote.text, /Bill to/i, "no BILL TO while negotiating");
    assert.doesNotMatch(quote.text, /\bTerms\b/i, "no TERMS while negotiating");
    assert.match(quote.text, new RegExp(STUB.supplierCode), "factory code on the line");
    assert.ok(quote.sheet.getImages().length >= 1, "line thumbnail embedded");
    // 24 pcs × $13.08 — the booth price arrived on the sheet untouched.
    const subtotal = (STUB.moq * STUB.price).toFixed(2);
    assert.match(quote.text.replace(/[,\s]/g, ""), new RegExp(subtotal.replace(".", "\\.")));

    // ── 7. Confirming turns the same order into a proforma invoice ───────
    await page.getByRole("button", { name: "Confirm Order" }).click();
    await page.getByText("Confirmed").first().waitFor({ timeout: 15_000 });

    const invoice = await exportedSheet(context, orderId);
    assert.match(invoice.text, /Proforma invoice/, "confirmed export is an invoice");
    assert.doesNotMatch(invoice.text, /Price quote/i);
    assert.match(invoice.text, /Bill to/i, "BILL TO returns on the invoice");
    assert.match(invoice.text, /Golden Path Client/, "billed to the order's client");

    await context.close();
  } finally {
    await browser.close();
  }
});
