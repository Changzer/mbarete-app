/**
 * Browser tests for the things only a browser can tell you: whether a thumb
 * can actually hit the controls, and whether the offline surfaces appear —
 * with the right words — when the server goes away.
 *
 * Run with `npm run test:ui` against a server on BASE_URL (default :3000).
 * Kept out of `npm test`, which is the pure-logic suite and needs no server.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

/**
 * Some environments ship a Chromium rather than letting Playwright download
 * its own; point at it when it is there and fall back to the managed one.
 */
const EXECUTABLE =
  process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const launch = () => chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";

/** The smallest phone the design is verified at. */
const VIEWPORT = { width: 360, height: 780 };
const MIN_TARGET = 44;

async function signedIn(browser, options = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, ...options });
  const page = await context.newPage();
  await page.goto(`${BASE}/en/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/catalog/, { timeout: 30_000 });
  return { context, page };
}

/** Every box a finger is meant to land on, measured as rendered. */
async function assertTargets(page, selector, label) {
  const targets = page.locator(selector);
  const count = await targets.count();
  assert.ok(count > 0, `${label}: expected at least one target`);
  for (let i = 0; i < count; i++) {
    const target = targets.nth(i);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    if (!box) continue;
    assert.ok(
      box.height >= MIN_TARGET,
      `${label}: target ${i} is ${box.height.toFixed(1)}px tall, under ${MIN_TARGET}`,
    );
    assert.ok(
      box.width >= MIN_TARGET,
      `${label}: target ${i} is ${box.width.toFixed(1)}px wide, under ${MIN_TARGET}`,
    );
  }
}

test("the tab bar and the capture FAB are thumb-sized at 360px", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    await assertTargets(page, '[data-testid="mobile-nav"] a', "tab bar");
    await assertTargets(page, '[data-testid="capture-fab"]', "capture FAB");

    // Five tabs, not six: Users and Settings live behind More.
    assert.equal(await page.locator('[data-testid="mobile-nav"] a').count(), 5);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("every control on the capture form is thumb-sized at 360px", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    await page.goto(`${BASE}/en/catalog/new`);
    // `data-touch-target` marks the bordered field, which is what a thumb
    // aims at — the bare <input> inside a suffixed field is 2px smaller.
    await assertTargets(page, "form [data-touch-target]:visible", "capture fields");
    await assertTargets(page, "form button:visible", "capture buttons");
    await context.close();
  } finally {
    await browser.close();
  }
});

test("the dimension fields fold away, and open when asked", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    await page.goto(`${BASE}/en/catalog/new`);

    const disclosure = page.locator('[data-testid="dimensions-disclosure"]');
    await assert.doesNotReject(disclosure.waitFor({ state: "visible" }));
    assert.equal(await disclosure.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#lengthCm").count(), 0);

    await disclosure.click();
    assert.equal(await disclosure.getAttribute("aria-expanded"), "true");
    await assert.doesNotReject(page.locator("#lengthCm").waitFor({ state: "visible" }));
    await context.close();
  } finally {
    await browser.close();
  }
});

test("a saved capture stays on the phone and says so, never 'failed'", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    await page.goto(`${BASE}/en/catalog/new`);
    await page.fill("#nameEn", "Offline Test Product");
    await page.fill("#price", "12.50");

    // The server goes away between filling the form and pressing save — the
    // exact moment this whole feature exists for.
    await context.setOffline(true);
    await page.click('[data-testid="save-product"]');

    const saved = page.locator('[data-testid="saved-offline"]');
    await saved.waitFor({ state: "visible", timeout: 15_000 });
    const message = (await saved.innerText()).toLowerCase();
    assert.ok(!message.includes("error"), `local save must not say "error": ${message}`);
    assert.ok(!message.includes("failed"), `local save must not say "failed": ${message}`);

    // And the header says so, counted, on the rung that carries a count.
    const chip = page.locator('[data-testid="header-sync-chip"] [data-testid="sync-chip"]');
    await chip.waitFor({ state: "visible", timeout: 15_000 });
    const step = await chip.getAttribute("data-sync-step");
    assert.ok(
      step === "waiting" || step === "syncing",
      `expected a waiting/syncing rung while offline, got ${step}`,
    );
    assert.match(await chip.innerText(), /\d/, "the chip must carry the count");

    await context.close();
  } finally {
    await browser.close();
  }
});

test("the queue sheet opens from the status and lists what is owed", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    await page.goto(`${BASE}/en/catalog/new`);
    await page.fill("#nameEn", "Queued Product");
    await page.fill("#price", "8.00");
    await context.setOffline(true);
    await page.click('[data-testid="save-product"]');

    await page.locator('[data-testid="header-sync-chip"]').waitFor({ state: "visible", timeout: 15_000 });
    await page.click('[data-testid="header-sync-chip"]');

    const sheet = page.getByRole("dialog");
    await sheet.waitFor({ state: "visible" });
    assert.match(await sheet.innerText(), /Queued Product/);

    // A sheet is anchored to the bottom edge, which is the whole point of it —
    // measured after the 250ms slide, or the transform is still in the number.
    await page.waitForFunction(
      () => document.getAnimations().every((a) => a.playState !== "running"),
      null,
      { timeout: 5_000 },
    );
    const box = await sheet.boundingBox();
    assert.ok(box, "the queue sheet must be laid out");
    assert.ok(
      Math.abs(box.y + box.height - VIEWPORT.height) <= 2,
      `the queue sheet must sit on the bottom edge, ended at ${(box.y + box.height).toFixed(1)} of ${VIEWPORT.height}`,
    );
    await context.close();
  } finally {
    await browser.close();
  }
});

test("the catalog offers the phone's own copy while the server is away", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    // One connected visit is what puts a copy on the phone.
    await page.goto(`${BASE}/en/catalog`);
    await page.locator('[data-testid="catalog-rows"]').waitFor({ state: "visible" });

    await context.setOffline(true);
    await page.locator('[data-testid="offline-strip"]').waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.click('[data-testid="open-offline-catalog"]');
    const copy = page.getByRole("dialog");
    await copy.waitFor({ state: "visible" });
    assert.match(await copy.innerText(), /MB-034/, "the copy lists the phone's own rows");
    await context.close();
  } finally {
    await browser.close();
  }
});

test("search narrows the catalog and names the query when nothing matches", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    const before = await page.locator('[data-testid="product-row"]').count();
    assert.ok(before > 0, "expected a seeded catalog to search");

    await page.fill('[data-testid="search-input"]', "zzzz-no-such-product");
    await page.locator('[data-testid="catalog-no-results"]').waitFor({ state: "visible" });
    assert.match(
      await page.locator('[data-testid="catalog-no-results"]').innerText(),
      /zzzz-no-such-product/,
    );

    await page.click('[data-testid="search-clear"]');
    assert.equal(await page.locator('[data-testid="product-row"]').count(), before);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("the appearance choice survives a reload", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser, { colorScheme: "light" });
    await page.goto(`${BASE}/en/more`);
    await page.click('[data-testid="theme-dark"]');
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");

    await page.reload();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "dark",
      "the boot script must restore the choice before paint",
    );
    await context.close();
  } finally {
    await browser.close();
  }
});
