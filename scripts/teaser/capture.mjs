/**
 * Captures the app screens used by the teaser video (docs/teaser).
 *
 * Drives the REAL golden path against a locally seeded dev server: signs in,
 * walks the catalog, uploads the bottle photo on /catalog/new, lets the AI
 * transcription fill the form (point MOONSHOT_BASE_URL at a stub — see
 * scripts/e2e/vision-stub.mjs — so no key is needed), saves, and screenshots
 * every beat at teaser resolution.
 *
 *   BASE_URL      server (default http://localhost:3000)
 *   SHOT_DIR      output directory (default ./teaser-shots)
 *   BOTTLE_PHOTO  path to the product photo the phone "takes"
 *   UI_TEST_EMAIL / UI_TEST_PASSWORD  login
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const EXECUTABLE =
  process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOT_DIR ?? "./teaser-shots";
const EMAIL = process.env.UI_TEST_EMAIL ?? "demo@mbarete.local";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "Demo-Mbarete-2026";
const PHOTO = process.env.BOTTLE_PHOTO;

const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

async function settle(page) {
  // Serialization-safe (resolve to undefined) and bounded: a single stalled
  // image must not hang the whole capture.
  await page.evaluate(() =>
    Promise.race([
      Promise.all([
        document.fonts.ready.then(() => undefined),
        ...Array.from(document.images, (i) =>
          i.complete ? undefined : new Promise((r) => { i.onload = i.onerror = () => r(); }),
        ),
      ]),
      new Promise((r) => setTimeout(r, 8000)),
    ]).then(() => undefined),
  );
  await page.waitForTimeout(400);
}

async function shot(page, name, opts = {}) {
  await settle(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log(`  ✓ ${name}`);
}

async function login(context) {
  context.setDefaultTimeout(45_000);
  const page = await context.newPage();
  await page.goto(`${BASE}/en/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/catalog/, { timeout: 60_000 });
  return page;
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});

// ---- Mobile: the capture story ---------------------------------------------
if (!process.env.SKIP_MOBILE) {
  const context = await browser.newContext(MOBILE);
  const page = await login(context);

  await page.goto(`${BASE}/en/catalog`);
  await page.waitForSelector('[data-testid="catalog-rows"]');
  await shot(page, "m1-catalog-before");

  await page.goto(`${BASE}/en/catalog/new`);
  await page.waitForSelector('[data-testid="take-photo"]');
  await shot(page, "m2-form-empty");

  if (PHOTO) {
    // The PhotoPicker has three file inputs; the one with `capture` is the
    // "Take photo" camera input (the submitted mirror input must NOT be used).
    await page.setInputFiles('input[type="file"][capture="environment"]', PHOTO);
    await page.waitForSelector('[data-testid="picked-photos"] img');
    // The AI read auto-fires 1.5s after the photo lands; catch the pending state.
    await page.waitForSelector('text=Reading photos…', { timeout: 20_000 });
    await shot(page, "m3-reading");
    await page.waitForSelector('[data-testid="ai-verify-hint"]', { timeout: 60_000 });
    await shot(page, "m4-ai-filled");
    await shot(page, "m4-ai-filled-full", { fullPage: true });

    await page.click('[data-testid="save-product"]');
    await page.waitForURL(/catalog(?!\/new)/, { timeout: 60_000 });
    await page.waitForSelector('[data-testid="catalog-rows"]');
    await shot(page, "m5-catalog-after");
  }

  await page.goto(`${BASE}/zh/catalog`);
  await page.waitForSelector('[data-testid="catalog-rows"]');
  await shot(page, "m6-catalog-zh");
  await context.close();
}

// ---- Desktop: the catalog on the big screen --------------------------------
{
  const context = await browser.newContext(DESKTOP);
  const page = await login(context);
  await page.evaluate(() => localStorage.setItem("mb-catalog-view", "gallery"));

  await page.goto(`${BASE}/en/catalog`);
  await page.waitForSelector('[data-testid="catalog-gallery"]');
  await shot(page, "d1-catalog-gallery-en");

  await page.goto(`${BASE}/zh/catalog`);
  await page.waitForSelector('[data-testid="catalog-gallery"]');
  await shot(page, "d2-catalog-gallery-zh");

  // Product detail dialog on the freshly captured highlighter set.
  const captured = page.locator('[data-testid="catalog-gallery"] button', { hasText: "荧光笔6色装" }).first();
  if (await captured.count()) {
    await captured.click();
    await page.waitForSelector('[role="dialog"] img');
    await shot(page, "d3-detail-dialog-zh");
  }
  await context.close();
}

await browser.close();
console.log("done");
