/** Public-page regressions against the real Next server and PostgreSQL in CI. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PHOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABUElEQVR4nO3XwQmAUBDE0Om/6djCv0gILLwCwrAqju3wNsIttfdbubF2Y+2Pd8td1m6s3WXN/XDfY7gba3dZu8dwlV8Iv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4AOv4COD54t6yshm4MnAAAAAElFTkSuQmCC", "base64");
const copy = JSON.parse(await readFile("messages/en.json", "utf8")).landing.form;
const photo = (name = "product.png") => ({ name, mimeType: "image/png", buffer: PHOTO });

async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal overflow");
}

// Eight localized layouts + a short desktop + reduced motion. Screenshots are
// review artifacts; assertions cover layout, loaded images, legal links and CTA.
test("the service page stays readable in four languages and motion modes", async () => {
  const browser = await chromium.launch();
  await mkdir("artifacts/landing", { recursive: true });
  try {
    for (const locale of ["en", "pt-BR", "es", "zh"]) {
      for (const [mode, viewport, reducedMotion] of [
        ["desktop", { width: 1440, height: 1000 }, "no-preference"],
        ["mobile", { width: 390, height: 844 }, "reduce"],
      ]) {
        const context = await browser.newContext({ viewport, reducedMotion });
        const page = await context.newPage();
        const errors = [];
        let phase = "landing";
        page.on("pageerror", (error) => errors.push(`${locale}/${mode}/${phase} ${page.url()}: ${error.stack ?? error.message}`));
        await page.goto(`${BASE}/${locale}`);
        await page.locator("h1").waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll("figure img")].some((img) => img.complete && img.naturalWidth > 0));
        await noOverflow(page);
        await page.screenshot({ caret: "initial", path: `artifacts/landing/${locale}-${mode}-hero.png` });
        if (mode === "desktop") {
          assert.equal(await page.locator("#how article").count(), 3);
          for (const [index, progress] of [[0, 0.3], [1, 0.56], [2, 0.75]]) {
            await page.evaluate((progress) => {
              const story = document.querySelector("#how article").parentElement.parentElement;
              const top = story.getBoundingClientRect().top + scrollY;
              scrollTo(0, top - innerHeight + progress * (story.offsetHeight + innerHeight));
            }, progress);
            await page.waitForFunction((index) => {
              const article = document.querySelectorAll("#how article")[index];
              return Number(getComputedStyle(article).opacity) > 0.98;
            }, index);
            const chapter = page.locator("#how article").nth(index);
            const inner = chapter.locator(":scope > div");
            const box = await inner.boundingBox();
            assert.ok(box && box.y >= -1 && box.y + box.height <= viewport.height + 1, `chapter ${index + 1} fits screen`);
            await page.screenshot({ caret: "initial", path: `artifacts/landing/${locale}-chapter-${index + 1}.png` });
          }
        } else {
          // In normal flow no chapter is covered by the next one.
          const boxes = await page.locator("#how article").evaluateAll((articles) => articles.map((a) => ({ top: a.offsetTop, height: a.offsetHeight })));
          assert.ok(boxes[1].top >= boxes[0].top + boxes[0].height);
          assert.ok(boxes[2].top >= boxes[1].top + boxes[1].height);
          for (const article of await page.locator("#how article").all()) await article.scrollIntoViewIfNeeded();
        }
        await page.locator('section[aria-labelledby="landing-title"] a[href="#contact"]').click();
        await page.locator("#eq-message").waitFor({ state: "visible" });
        await noOverflow(page);
        await page.locator("#contact").screenshot({ caret: "initial", path: `artifacts/landing/${locale}-${mode}-enquiry.png` });
        for (const route of ["privacy", "terms"]) {
          phase = route;
          const link = page.locator(`footer a[href="/${locale}/${route}"]`);
          assert.equal(await link.count(), 1, `public ${route} link`);
          await link.click();
          await page.waitForURL(new RegExp(`/${locale}/${route}$`));
          assert.equal(await page.locator("h1").count(), 1);
          await noOverflow(page);
          if (locale === "pt-BR") assert.match(await page.locator("h1").innerText(), route === "privacy" ? /privacidade/ : /Termos/);
          if (locale === "es") assert.match(await page.locator("h1").innerText(), route === "privacy" ? /privacidad/ : /Términos/);
          await page.getByRole("link", { name: /Back to Mbarete|Voltar à Mbarete|Volver a Mbarete|返回 Mbarete/ }).click();
          await page.waitForURL(new RegExp(`/${locale}$`));
        }
        phase = "signup redirect";
        const retired = await page.request.get(`${BASE}/${locale}/signup?ref=OLDREF`, { maxRedirects: 0 });
        assert.equal(retired.status(), 307, "retired signup redirects before HTML streaming");
        assert.equal(new URL(retired.headers().location, BASE).pathname, `/${locale}/login`);
        await page.goto(`${BASE}/${locale}/signup?ref=OLDREF`);
        await page.waitForURL(new RegExp(`/${locale}/login$`));
        assert.equal(await page.locator('a[href*="/signup"]').count(), 0);
        assert.deepEqual(errors, [], "no client runtime errors");
        await context.close();
      }
    }
    for (const [height, motion] of [[700, "no-preference"], [1000, "reduce"]]) {
      const page = await browser.newPage({ viewport: { width: 1280, height }, reducedMotion: motion });
      await page.goto(`${BASE}/pt-BR`);
      const boxes = await page.locator("#how article").evaluateAll((articles) => articles.map((a) => ({ top: a.offsetTop, height: a.offsetHeight })));
      assert.equal(boxes.length, 3);
      assert.ok(boxes[1].top >= boxes[0].top + boxes[0].height, "short/reduced-motion desktop uses document flow");
      await noOverflow(page);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("enquiries persist photos, keep drafts after failures, and clean up rejected files", async () => {
  assert.ok(process.env.DATABASE_ADMIN_URL, "explicit test database required");
  assert.ok(process.env.UPLOADS_DIR, "explicit test uploads folder required");
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const posts = [];
  page.on("response", async (response) => {
    if (response.request().method() === "POST") posts.push({ status: response.status(), body: await response.text().then((t) => t.slice(-1500)).catch(() => "unavailable") });
  });
  const email = `landing-${Date.now()}@example.com`;
  const failedEmail = `failed-${email}`;
  const uploads = async () => (await readdir(process.env.UPLOADS_DIR)).filter((p) => p.startsWith("enq-")).sort();
  const fill = async (email) => {
    await page.goto(`${BASE}/en#contact`);
    // Navigating to the same hash keeps the successful form's React state.
    // A fresh buyer visit needs a new document, not another fragment jump.
    await page.reload();
    await page.locator("#eq-message").fill("Please source an insulated bottle for our store.");
    await page.locator("#eq-name").fill("Landing QA");
    await page.locator("#eq-email").fill(email);
  };
  const submit = () => page.locator('form button[type="submit"]').click();
  try {
    await fill(email);
    const files = page.locator('input[type="file"]');
    await files.setInputFiles(photo());
    await page.getByRole("img", { name: "product.png", exact: true }).waitFor();
    await files.setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
    assert.equal(await page.getByRole("img", { name: "product.png", exact: true }).count(), 1, "rejected selection preserves accepted photo");
    assert.equal(await page.getByRole("img", { name: "too-large.png", exact: true }).count(), 0);
    await submit();
    await page.getByText(copy.thanksTitle, { exact: true }).waitFor({ timeout: 10000 }).catch(async (error) => {
      await page.screenshot({ caret: "initial", path: "artifacts/landing/enquiry-failure.png", fullPage: true });
      throw new Error(`${error.message}\nResponses: ${JSON.stringify(posts)}\nForm state: ${await page.locator("form").innerText()}\nFields: ${JSON.stringify(await page.locator("form input, form textarea").evaluateAll((fields) => fields.map((f) => ({ name: f.name, value: f.type === "file" ? "file" : f.value, valid: f.validity.valid }))))}`);
    });
    const { rows } = await sql.query("SELECT * FROM service_enquiries WHERE email=$1", [email]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].company_name, "", "company is optional end to end");
    assert.equal(rows[0].locale, "en");
    const images = (await sql.query("SELECT path FROM service_enquiry_images WHERE enquiry_id=$1", [rows[0].id])).rows;
    assert.equal(images.length, 1);
    const stored = await readFile(`${process.env.UPLOADS_DIR}/${images[0].path.split("/").pop()}`);
    assert.equal(stored.subarray(8, 12).toString(), "WEBP", "saved image was decoded and re-encoded");
    const denied = await page.request.get(`${BASE}${images[0].path}`, { maxRedirects: 0 });
    assert.ok([401, 403, 404].includes(denied.status()), "enquiry photo not public");

    // A valid first photo followed by a fake second one must clean up the
    // already-written first file, and retain the buyer's brief and attachments.
    await fill(failedEmail);
    const beforeFiles = await uploads();
    await files.setInputFiles([photo("valid.png"), { name: "corrupt.png", mimeType: "image/png", buffer: Buffer.from("not an image") }]);
    await submit();
    await page.getByText(copy.errorPhotos, { exact: true }).waitFor();
    assert.equal(await page.locator("#eq-name").inputValue(), "Landing QA");
    assert.equal(await page.locator("#eq-email").inputValue(), failedEmail);
    assert.match(await page.locator("#eq-message").inputValue(), /insulated bottle/);
    assert.deepEqual(await uploads(), beforeFiles, "decode failure removes prior written image");
    assert.equal((await sql.query("SELECT id FROM service_enquiries WHERE email=$1", [failedEmail])).rowCount, 0);
    await page.getByRole("button", { name: copy.photosRemove.replace("{name}", "corrupt.png") }).click();
    assert.equal(await page.getByRole("img", { name: "valid.png", exact: true }).count(), 1);

    // Reject only this test enquiry at the real DB boundary. No application
    // test hooks: the same transaction/cleanup path handles a production error.
    await sql.query(`CREATE FUNCTION landing_qa_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.email LIKE 'failed-landing-%@example.com' THEN RAISE EXCEPTION 'landing QA failure'; END IF; RETURN NEW; END $$`);
    await sql.query("CREATE TRIGGER landing_qa_reject BEFORE INSERT ON service_enquiries FOR EACH ROW EXECUTE FUNCTION landing_qa_reject()");
    await submit();
    await page.getByText(copy.errorFailed, { exact: true }).waitFor();
    assert.equal(await page.locator("#eq-email").inputValue(), failedEmail);
    assert.equal(await page.getByRole("img", { name: "valid.png", exact: true }).count(), 1);
    assert.deepEqual(await uploads(), beforeFiles, "DB failure leaves no orphan image");
    await sql.query("DROP TRIGGER landing_qa_reject ON service_enquiries");
    await sql.query("DROP FUNCTION landing_qa_reject()");
    await submit();
    await page.getByText(copy.thanksTitle, { exact: true }).waitFor({ timeout: 10000 }).catch(async (error) => {
      await page.screenshot({ caret: "initial", path: "artifacts/landing/enquiry-failure.png", fullPage: true });
      throw new Error(`${error.message}\nResponses: ${JSON.stringify(posts)}\nForm state: ${await page.locator("form").innerText()}\nFields: ${JSON.stringify(await page.locator("form input, form textarea").evaluateAll((fields) => fields.map((f) => ({ name: f.name, value: f.type === "file" ? "file" : f.value, valid: f.validity.valid }))))}`);
    });
    assert.equal((await sql.query("SELECT id FROM service_enquiries WHERE email=$1", [failedEmail])).rowCount, 1);
    assert.equal((await uploads()).length, beforeFiles.length + 1, "retry creates only accepted attachment");
  } finally {
    await sql.query("DROP TRIGGER IF EXISTS landing_qa_reject ON service_enquiries");
    await sql.query("DROP FUNCTION IF EXISTS landing_qa_reject()");
    await sql.end();
    await browser.close();
  }
});
