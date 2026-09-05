/**
 * Continuous field capture, walked in a real browser against a running
 * server (BASE_URL) whose MOONSHOT_BASE_URL points at scripts/e2e/
 * vision-stub.mjs. Each test is one of the brief's scenarios; the ones a
 * browser cannot honestly prove (native camera return, WeChat switching,
 * iOS memory pressure) are in docs/FIELD-CAPTURE.md as device checks.
 *
 *   BASE_URL=http://localhost:3100 ADMIN_EMAIL=… ADMIN_PASSWORD=… \
 *   DATABASE_ADMIN_URL=postgres://… node --test src/ui-tests/capture.spec.mjs
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me";
const EXECUTABLE =
  process.env.CHROMIUM_PATH ??
  process.env.PLAYWRIGHT_CHROMIUM ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const DB_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const VIEWPORT = { width: 390, height: 844 };

// A 1×1 PNG. Below the compressor's threshold, so it is stored as-is —
// the timings measured here are persistence, not encoding.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const photo = (name) => ({ name, mimeType: "image/png", buffer: PNG });

const launch = () => chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});

async function signedIn(browser, options = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, ...options });
  const page = await context.newPage();
  await page.goto(`${BASE}/en/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 15_000 });
  return { context, page };
}

async function query(text, params = []) {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}

async function until(fn, { timeout = 20_000, every = 400, label = "condition" } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

async function openCapture(page) {
  await page.goto(`${BASE}/en/catalog/capture`);
  await page.locator('[data-testid="capture-screen"][data-ready="1"]').waitFor({ timeout: 15_000 });
}

const visitOf = (page) => page.locator('[data-testid="supplier-bar"]').getAttribute("data-visit");
const captureIdOf = (page) => page.locator('[data-testid="capture-id"]').innerText();

/** "Change supplier", waited for: the new visit id. */
async function newBooth(page) {
  const before = await visitOf(page);
  await page.click('[data-testid="change-supplier"]');
  return until(async () => {
    const v = await visitOf(page);
    return v && v !== before ? v : null;
  }, { label: "a new visit" });
}

/** "Next product", waited for: the product counter reads n. */
async function nextProduct(page, n) {
  await page.click('[data-testid="next-product"]');
  await until(async () => (await page.locator('[data-testid="product-index"]').innerText()) === `PRODUCT ${n} AT THIS BOOTH`, {
    label: `product ${n}`,
  });
}

async function takePhotos(page, n, prefix = "p") {
  for (let i = 0; i < n; i++) {
    await page.locator('[data-testid="camera-input"]').setInputFiles(photo(`${prefix}${i}.png`));
  }
}

async function allSaved(page, n) {
  await until(async () => (await page.locator('[data-testid="tile-saved"]').count()) === n, {
    label: `${n} saved tiles`,
  });
  assert.equal(await page.locator('[data-testid="tile-saving"]').count(), 0);
  assert.equal(await page.locator('[data-testid="tile-failed"]').count(), 0);
}

// ---------------------------------------------------------------------------

test("photos persist one by one, next product carries the booth, a reload resumes unfinished work", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    await openCapture(page);
    const visit = await visitOf(page);
    assert.match(visit, /^vis-/);
    assert.equal(await page.locator('[data-testid="product-index"]').innerText(), "PRODUCT 1 AT THIS BOOTH");

    // Several photographs for one product. Each tile says Saved only once
    // its own write committed; "Next product" is disabled until all have.
    const capture1 = await captureIdOf(page);
    await takePhotos(page, 3);
    await allSaved(page, 3);
    const timing = await page.locator('[data-testid="timing"]').innerText();
    assert.match(timing, /saved in \d+ ms/);
    console.log("  timing:", timing);
    await page.locator('[data-testid="capture-note"]').fill("320/ctn, 15 days");
    await page.locator('[data-testid="capture-note"]').blur();

    await page.click('[data-testid="next-product"]');
    await until(async () => (await page.locator('[data-testid="product-index"]').innerText()) === "PRODUCT 2 AT THIS BOOTH", {
      label: "product 2",
    });
    assert.equal(await visitOf(page), visit, "next product keeps the visit");
    assert.equal(await page.locator('[data-testid="tile-saved"]').count(), 0);

    // Second product, then leave WITHOUT pressing Next: a reload must bring
    // it back, under the same booth, with its photo.
    await takePhotos(page, 1, "q");
    await allSaved(page, 1);
    const capture2 = await captureIdOf(page);
    await page.reload();
    await page.locator('[data-testid="resumed-banner"]').waitFor({ timeout: 10_000 });
    assert.equal(await page.locator('[data-testid="tile-saved"]').count(), 1);
    assert.equal(await captureIdOf(page), capture2, "the open capture is the one left behind");
    assert.equal(await visitOf(page), visit, "its booth context is shown again");
    await page.click('[data-testid="next-product"]');

    // The first product reached the server as a draft under the visit, with
    // three photos and the note; the second follows.
    const rows = await until(
      async () => {
        const r = await query(
          `select d.client_id, d.visit_id, d.fields, (select count(*) from capture_draft_images i where i.draft_id = d.id) as photos
           from capture_drafts d where d.visit_id = $1 order by d.captured_at`,
          [visit],
        );
        return r.length === 2 ? r : null;
      },
      { label: "two drafts on the server" },
    );
    assert.ok(rows.some((r) => r.client_id.startsWith(capture1) && Number(r.photos) === 3));
    assert.equal(JSON.parse(rows[0].fields).notes, "320/ctn, 15 days");
    const [v] = await query("select client_visit_id from capture_visits where client_visit_id = $1", [visit]);
    assert.ok(v, "the visit row was created by the first arrival");
    await context.close();
  } finally {
    await browser.close();
  }
});

test("a card photographed late attaches to the visit, and change supplier starts a new booth", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    await openCapture(page);
    const visit = await newBooth(page);
    await takePhotos(page, 1, "a");
    await allSaved(page, 1);
    await nextProduct(page, 2);
    await takePhotos(page, 1, "b");
    await allSaved(page, 1);
    await page.click('[data-testid="next-product"]');

    // The card, after two products.
    await page.locator('[data-testid="card-input"]').setInputFiles(photo("card.png"));
    await page.locator('[data-testid="card-banner"]').waitFor();
    assert.equal(await page.locator('[data-testid="supplier-label"]').innerText(), "Card photographed");

    const rows = await until(
      async () => {
        const r = await query("select kind from capture_drafts where visit_id = $1 order by captured_at", [visit]);
        return r.length === 3 ? r : null;
      },
      { label: "two products and a card on the server" },
    );
    assert.deepEqual(rows.map((r) => r.kind), ["product", "product", "contact"]);

    // Change supplier: a fresh visit id, product count back to 1, and the
    // previous booth's captures untouched.
    await page.click('[data-testid="change-supplier"]');
    const next = await until(async () => {
      const v = await visitOf(page);
      return v && v !== visit ? v : null;
    });
    assert.notEqual(next, visit);
    assert.equal(await page.locator('[data-testid="product-index"]').innerText(), "PRODUCT 1 AT THIS BOOTH");
    assert.equal(await page.locator('[data-testid="supplier-label"]').innerText(), "Supplier not set");
    const still = await query("select count(*)::int as n from capture_drafts where visit_id = $1", [visit]);
    assert.equal(still[0].n, 3);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("a visit's supplier, approved before all captures arrive, resolves late arrivals too — except explicit overrides", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    const visit = `vis-e2e-${Date.now().toString(36)}`;
    const post = (clientId) =>
      context.request.post(`${BASE}/api/drafts`, {
        multipart: {
          clientId,
          capturedAt: new Date().toISOString(),
          kind: "product",
          fields: "{}",
          visitId: visit,
          images: photo("x.png"),
        },
      });
    // Two of five reach the server.
    for (const id of ["cap-e2e-1", "cap-e2e-2"]) assert.equal((await post(`${id}-${visit}`)).status(), 201);

    // The reviewer approves the visit's supplier.
    const [supplier] = await query(
      "select id, company_name from contacts where company_id = 1 and type = 'supplier' and active order by id limit 1",
    );
    await page.goto(`${BASE}/en/catalog/drafts`);
    const header = page.locator(`[data-testid="visit-${visit}"] [data-testid="visit-supplier-select"]`);
    await header.selectOption(String(supplier.id));
    await until(async () => {
      const [row] = await query("select supplier_id from capture_visits where client_visit_id = $1", [visit]);
      return row?.supplier_id === supplier.id;
    }, { label: "visit supplier saved" });

    // Three arrive later, with no supplier of their own.
    for (const id of ["cap-e2e-3", "cap-e2e-4", "cap-e2e-5"]) assert.equal((await post(`${id}-${visit}`)).status(), 201);

    // All five resolve to the approved supplier through the visit.
    const resolved = await query(
      `select d.client_id, coalesce(d.supplier_id, v.supplier_id) as effective, d.supplier_id as own
       from capture_drafts d join capture_visits v on v.company_id = d.company_id and v.client_visit_id = d.visit_id
       where d.visit_id = $1 order by d.client_id`,
      [visit],
    );
    assert.equal(resolved.length, 5);
    assert.ok(resolved.every((r) => r.effective === supplier.id && r.own === null));

    // The review page says so on every card.
    await page.reload();
    const cards = page.locator(`[data-testid="visit-${visit}"] [data-testid="draft-card"]`);
    assert.equal(await cards.count(), 5);
    assert.equal(await cards.locator('[data-testid="draft-effective-supplier"]').count(), 5);

    // An explicit override on one capture wins over the visit.
    const [other] = await query(
      "select id from contacts where company_id = 1 and type = 'supplier' and active and id <> $1 order by id limit 1",
      [supplier.id],
    );
    if (other) {
      await cards.first().locator('[data-testid="draft-supplier-select"]').selectOption(String(other.id));
      await until(async () => {
        const r = await query(
          `select coalesce(d.supplier_id, v.supplier_id) as effective from capture_drafts d
           join capture_visits v on v.company_id = d.company_id and v.client_visit_id = d.visit_id
           where d.visit_id = $1 and d.supplier_id = $2`,
          [visit, other.id],
        );
        return r.length === 1 && r[0].effective === other.id;
      }, { label: "override saved" });
    }

    // A mistaken visit assignment is corrected by clearing it: the four that
    // follow the visit go back to unresolved, the override stays.
    await header.selectOption("");
    await until(async () => {
      const r = await query(
        `select count(*)::int as n from capture_drafts d join capture_visits v on v.company_id = d.company_id and v.client_visit_id = d.visit_id
         where d.visit_id = $1 and coalesce(d.supplier_id, v.supplier_id) is null`,
        [visit],
      );
      return r[0].n === (other ? 4 : 5);
    }, { label: "visit cleared" });
    await context.close();
  } finally {
    await browser.close();
  }
});

test("a response lost after the server committed is retried without a duplicate", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    await openCapture(page);
    await newBooth(page);
    await takePhotos(page, 1, "lost");
    await allSaved(page, 1);
    const captureId = await captureIdOf(page);

    // The first delivery reaches the server (route.fetch performs it) and
    // the browser is then told the connection died.
    let dropped = false;
    await page.route("**/api/drafts", async (route) => {
      if (route.request().method() === "POST" && !dropped) {
        dropped = true;
        await route.fetch();
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });
    await page.click('[data-testid="next-product"]');
    await until(() => dropped, { label: "the dropped delivery" });
    await until(
      async () => (await page.locator('[data-testid="previous-state"]').innerText()).includes("waiting"),
      { label: "the phone still owes it" },
    );

    // The retry replays the same id and is told "already have it".
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await until(
      async () => (await page.locator('[data-testid="previous-state"]').innerText()).includes("uploaded"),
      { label: "the retry to land", timeout: 30_000 },
    );
    const rows = await query("select id from capture_drafts where client_id like $1", [`${captureId}%`]);
    assert.equal(rows.length, 1, "exactly one draft for the capture");
    await context.close();
  } finally {
    await browser.close();
  }
});

test("evidence added to the previous product travels as an addendum, offline and after delivery", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    await openCapture(page);
    await newBooth(page);

    await context.setOffline(true);
    await takePhotos(page, 1, "off");
    await allSaved(page, 1);
    const captureId = await captureIdOf(page);
    await nextProduct(page, 2);
    // "Add photo to previous" is offered only once the seal has committed;
    // the test uses the hidden input, so it waits for the chip like a thumb would.
    await page.locator('[data-testid="previous-state"]').waitFor();
    // Before delivery: the addendum is stored beside the capture and waits.
    await page.locator('[data-testid="addendum-input"]').setInputFiles(photo("more1.png"));
    await page.locator('[data-testid="addendum-banner"]').waitFor();
    assert.match(await page.locator('[data-testid="status-line"]').innerText(), /waiting to upload|Offline/);
    assert.equal((await query("select count(*)::int as n from capture_drafts where client_id like $1", [`${captureId}%`]))[0].n, 0);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const delivered = await until(
      async () => {
        const r = await query(
          `select d.id, (select count(*) from capture_draft_images i where i.draft_id = d.id) as photos,
                  (select count(*) from capture_draft_images i where i.draft_id = d.id and i.client_addendum_id is not null) as addenda
           from capture_drafts d where d.client_id like $1`,
          [`${captureId}%`],
        );
        return r.length === 1 && Number(r[0].photos) === 2 ? r[0] : null;
      },
      { label: "capture and its addendum on the server", timeout: 30_000 },
    );
    assert.equal(Number(delivered.addenda), 1);

    // After delivery: another addendum lands on the same draft.
    await until(
      async () => (await page.locator('[data-testid="previous-state"]').innerText()).includes("uploaded"),
      { label: "previous marked uploaded" },
    );
    await page.locator('[data-testid="addendum-input"]').setInputFiles(photo("more2.png"));
    await until(
      async () =>
        Number((await query("select count(*) as n from capture_draft_images where draft_id = $1", [delivered.id]))[0].n) === 3,
      { label: "the second addendum", timeout: 30_000 },
    );
    // A replay of the same addendum is answered as a duplicate, not stored twice.
    const [row] = await query("select client_addendum_id from capture_draft_images where draft_id = $1 and client_addendum_id is not null limit 1", [delivered.id]);
    const replay = await context.request.post(`${BASE}/api/drafts/photos`, {
      multipart: { addendumId: row.client_addendum_id, captureClientId: captureId + "-x", images: photo("dup.png") },
    });
    assert.equal(replay.status(), 200);
    assert.equal((await replay.json()).duplicate, true);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("a legacy queued draft still delivers after the store upgrade, and another account's captures never do", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    await openCapture(page);
    const [{ id: userId, company_id: companyId }] = await query("select id, company_id from users where email = $1", [EMAIL]);
    const scope = `${companyId}:${userId}`;
    const legacyId = `cap-legacy-${Date.now().toString(36)}`;
    const foreignId = `cap-foreign-${Date.now().toString(36)}`;

    await page.evaluate(
      async ({ scope, legacyId, foreignId, png }) => {
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0)).buffer;
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open("mbarete-outbox");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        // A v2 row exactly as the old form's queue wrote it.
        await new Promise((resolve, reject) => {
          const tx = db.transaction(["scoped-drafts", "captures", "photos"], "readwrite");
          tx.objectStore("scoped-drafts").put({
            scope,
            clientId: legacyId,
            kind: "product",
            capturedAt: new Date().toISOString(),
            fields: { nameEn: "Legacy queue item" },
            images: [{ field: "images", name: "legacy.png", type: "image/png", bytes }],
            status: "pending",
            attempts: 0,
          });
          // A v3 capture that belongs to another account on this phone.
          const other = "999:999";
          tx.objectStore("captures").put({
            scope: other,
            captureId: foreignId,
            visitId: "vis-foreign",
            kind: "product",
            status: "pending",
            startedAt: new Date().toISOString(),
            note: "",
            photoCount: 1,
            attempts: 0,
          });
          tx.objectStore("photos").put({
            scope: other,
            captureId: foreignId,
            seq: 0,
            name: "f.png",
            type: "image/png",
            bytes,
            addedAt: new Date().toISOString(),
          });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { scope, legacyId, foreignId, png: PNG.toString("base64") },
    );
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await until(
      async () => (await query("select id from capture_drafts where client_id = $1", [legacyId])).length === 1,
      { label: "the legacy draft to deliver", timeout: 30_000 },
    );
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal((await query("select count(*)::int as n from capture_drafts where client_id = $1", [foreignId]))[0].n, 0);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("identifying a supplier from a capture photo attaches the approved supplier to the visit", async () => {
  const browser = await launch();
  try {
    const { context, page } = await signedIn(browser);
    const visit = `vis-id-${Date.now().toString(36)}`;
    const res = await context.request.post(`${BASE}/api/drafts`, {
      multipart: {
        clientId: `cap-id-${visit}`,
        capturedAt: new Date().toISOString(),
        kind: "product",
        fields: "{}",
        visitId: visit,
        images: photo("combined.png"),
      },
    });
    assert.equal(res.status(), 201);
    await page.goto(`${BASE}/en/catalog/drafts`);
    const group = page.locator(`[data-testid="visit-${visit}"]`);
    await group.locator('[data-testid="identify-supplier"]').click();
    await group.locator('[data-testid^="identify-image-"]').first().click();
    await group.locator('[data-testid="supplier-reading"]').waitFor({ timeout: 30_000 });
    const before = (await query("select count(*)::int as n from contacts where company_id = 1 and type = 'supplier'"))[0].n;
    await group.locator('[data-testid="create-supplier-from-reading"]').click();
    await until(async () => {
      const [row] = await query("select supplier_id from capture_visits where client_visit_id = $1", [visit]);
      return row?.supplier_id ? row : null;
    }, { label: "the visit to get its supplier" });
    const after = (await query("select count(*)::int as n from contacts where company_id = 1 and type = 'supplier'"))[0].n;
    assert.equal(after, before + 1, "one supplier created from the reading");
    // The evidence photo is still the draft's own photo — nothing was copied.
    const [img] = await query("select count(*)::int as n from capture_draft_images i join capture_drafts d on d.id = i.draft_id where d.visit_id = $1", [visit]);
    assert.equal(img.n, 1);
    await context.close();
  } finally {
    await browser.close();
  }
});
