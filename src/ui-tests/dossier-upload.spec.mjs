/** Real multipart requests against the built app and disposable CI database. */
import assert from "node:assert/strict";
import test from "node:test";
import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { chromium, request } from "playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.UI_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.UI_TEST_PASSWORD ?? "change-me";
const MAX = 100 * 1024 * 1024;
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

// A valid one-page PDF, padded with a comment before its cross-reference
// table. Its exact byte size tests the upload boundary without a binary fixture.
function pdfBytes(size) {
  let prefix = "%PDF-1.4\n";
  const offsets = [];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(prefix));
    prefix += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const footer = (offset) => `xref\n0 5\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${String(offset).padStart(10, "0")}\n%%EOF\n`;
  const xrefOffset = size - Buffer.byteLength(footer(0));
  const bytes = Buffer.alloc(size, 32);
  bytes.write(`${prefix}%`);
  bytes[xrefOffset - 1] = 10;
  bytes.write(footer(xrefOffset), xrefOffset);
  return bytes;
}

test("dossier accepts a 100 MiB PDF intact and preserves file/invoice choices through failed uploads", { timeout: 180_000 }, async () => {
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const sql = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await sql.connect();
  const scratch = await mkdtemp(path.join(os.tmpdir(), "dossier-e2e-"));
  const anonymous = await request.newContext();
  let orderId, clientId, account, initialStatus;
  const pageErrors = [];
  try {
    account = (await sql.query("SELECT id, company_id FROM users WHERE email=$1", [EMAIL])).rows[0];
    initialStatus = (await sql.query("SELECT status FROM companies WHERE id=$1", [account.company_id])).rows[0].status;
    const stamp = `dossier-qa-${Date.now()}`;
    clientId = (await sql.query("INSERT INTO contacts(company_id,type,company_name) VALUES ($1,'client',$2) RETURNING id", [account.company_id, stamp])).rows[0].id;
    orderId = (await sql.query("INSERT INTO orders(company_id,order_number,client_id,created_by) VALUES ($1,$2,$3,$4) RETURNING id", [account.company_id, stamp, clientId, account.id])).rows[0].id;
    const endpoint = `${BASE}/api/orders/${orderId}/dossier-document`;
    assert.equal((await anonymous.post(endpoint)).status(), 401);
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${BASE}/en/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/catalog/, { timeout: 30_000 });
    await page.goto(`${BASE}/en/orders/${orderId}`);
    await page.getByTestId("dossier-card").waitFor();
    assert.match(await page.getByTestId("dossier-card").innerText(), /100 MB per document/);

    const tiny = { name: "scan.pdf", mimeType: "application/pdf", buffer: pdfBytes(1024) };
    assert.equal((await context.request.post(endpoint, { headers: { Origin: "https://different.example" }, multipart: { kind: "packing_list", file: tiny } })).status(), 403);
    assert.equal((await context.request.post(`${BASE}/api/orders/2147483647/dossier-document`, { multipart: { kind: "packing_list", file: tiny } })).status(), 404);
    for (const status of ["pending", "suspended"]) {
      await sql.query("UPDATE companies SET status=$1 WHERE id=$2", [status, account.company_id]);
      assert.equal((await context.request.post(endpoint, { multipart: { kind: "packing_list", file: tiny } })).status(), 403);
    }
    await sql.query("UPDATE companies SET status=$1 WHERE id=$2", [initialStatus, account.company_id]);
    for (const kind of ["loading_video", "unknown", "supplier_invoice"]) {
      assert.equal((await context.request.post(endpoint, { multipart: { kind, file: tiny } })).status(), 400);
    }

    const invoice = page.getByTestId("dossier-upload-supplier_invoice");
    await invoice.getByTestId("fapiao-type").click();
    await page.getByRole("option", { name: /^3% VAT/ }).click();
    await invoice.locator('input[type="file"]').setInputFiles(tiny);
    const companyDir = path.join(process.env.UPLOADS_DIR ?? "uploads", `c${account.company_id}`);
    const beforeFiles = await readdir(companyDir).catch(() => []);
    // Fail AFTER document insertion to verify the row, history and disk cleanup.
    await sql.query(`CREATE FUNCTION dossier_upload_qa_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id = ${Number(orderId)} AND NEW.kind = 'document_added' THEN RAISE EXCEPTION 'upload QA failure'; END IF; RETURN NEW; END $$`);
    await sql.query("CREATE TRIGGER dossier_upload_qa_reject BEFORE INSERT ON order_events FOR EACH ROW EXECUTE FUNCTION dossier_upload_qa_reject()");
    const post = () => page.waitForResponse((response) => response.url() === endpoint && response.request().method() === "POST");
    let response = post();
    await invoice.getByRole("button", { name: "Upload", exact: true }).click();
    assert.equal((await response).status(), 500);
    await invoice.getByRole("alert").waitFor();
    assert.equal(await invoice.locator('input[type="file"]').evaluate((input) => input.files.length), 1);
    assert.match(await invoice.getByTestId("fapiao-type").innerText(), /^3%/);
    assert.equal((await sql.query("SELECT id FROM order_documents WHERE order_id=$1", [orderId])).rowCount, 0);
    assert.deepEqual((await readdir(companyDir)).sort(), beforeFiles.sort(), "a failed transaction leaves no orphan file");
    await sql.query("DROP TRIGGER dossier_upload_qa_reject ON order_events");
    await sql.query("DROP FUNCTION dossier_upload_qa_reject()");
    response = post();
    await invoice.getByRole("button", { name: "Upload", exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.getByTestId("dossier-item-6").getByRole("link", { name: "scan.pdf" }).waitFor();
    assert.equal(await invoice.locator('input[type="file"]').evaluate((input) => input.files.length), 0);
    const savedInvoice = (await sql.query("SELECT fapiao_type FROM order_documents WHERE order_id=$1", [orderId])).rows[0];
    assert.equal(savedInvoice.fapiao_type, "special_3");

    const packing = page.getByTestId("dossier-upload-packing_list");
    const picker = packing.locator('input[type="file"]');
    const upload = packing.getByRole("button", { name: "Upload", exact: true });
    await picker.setInputFiles(tiny);
    for (const status of [413, 500, 200, "network"]) {
      await page.route(endpoint, (route) => status === "network" ? route.abort() : route.fulfill({ status, contentType: "text/html", body: "upstream response" }));
      await upload.click();
      await packing.getByRole("alert").waitFor();
      assert.equal(await picker.evaluate((input) => input.files.length), 1, `file retained after ${status}`);
      assert.equal(await upload.isEnabled(), true);
      await page.unroute(endpoint);
    }

    const largeFile = path.join(scratch, "large-scan.pdf");
    const bytes = pdfBytes(MAX);
    const expectedHash = createHash("sha256").update(bytes).digest("hex");
    await writeFile(largeFile, bytes);
    await picker.setInputFiles(largeFile);
    response = post();
    await upload.click();
    assert.equal((await response).status(), 200, "100 MiB bypasses the old 25/40 MB limits");
    await page.getByTestId("dossier-item-7").getByRole("link", { name: "large-scan.pdf" }).waitFor();
    const saved = (await sql.query("SELECT path, size_bytes FROM order_documents WHERE order_id=$1 AND kind='packing_list'", [orderId])).rows[0];
    assert.equal(Number(saved.size_bytes), MAX);
    assert.equal(await picker.evaluate((input) => input.files.length), 0);
    const downloaded = await context.request.get(`${BASE}${saved.path}`);
    assert.equal(downloaded.status(), 200);
    assert.equal(createHash("sha256").update(await downloaded.body()).digest("hex"), expectedHash);
    assert.equal((await anonymous.get(`${BASE}${saved.path}`)).status(), 401, "large PDFs remain private");

    // One byte above the file limit: browser refuses it without a request,
    // and a direct API caller cannot bypass the same per-file cap.
    await appendFile(largeFile, " ");
    let requests = 0;
    page.on("request", (req) => { if (req.url() === endpoint) requests++; });
    await picker.setInputFiles(largeFile);
    await upload.click();
    assert.match(await packing.getByRole("alert").innerText(), /100 MB/);
    assert.equal(requests, 0);
    const oversized = await context.request.post(endpoint, { multipart: { kind: "packing_list", file: createReadStream(largeFile) } });
    assert.equal(oversized.status(), 413);
    assert.equal((await oversized.json()).maxMb, 100);
    assert.equal((await sql.query("SELECT id FROM order_documents WHERE order_id=$1", [orderId])).rowCount, 2);
    assert.deepEqual(pageErrors, []);
  } finally {
    await sql.query("DROP TRIGGER IF EXISTS dossier_upload_qa_reject ON order_events");
    await sql.query("DROP FUNCTION IF EXISTS dossier_upload_qa_reject()");
    if (account) await sql.query("UPDATE companies SET status=$1 WHERE id=$2", [initialStatus, account.company_id]);
    if (orderId) {
      const files = (await sql.query("SELECT path FROM order_documents WHERE order_id=$1", [orderId])).rows;
      for (const file of files) await unlink(path.join(process.env.UPLOADS_DIR ?? "uploads", file.path.slice("/uploads/".length))).catch(() => {});
      await sql.query("DELETE FROM order_documents WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM order_events WHERE order_id=$1", [orderId]);
      await sql.query("DELETE FROM orders WHERE id=$1", [orderId]);
    }
    if (clientId) await sql.query("DELETE FROM contacts WHERE id=$1", [clientId]);
    await anonymous.dispose();
    await browser.close();
    await sql.end();
    await rm(scratch, { recursive: true, force: true });
  }
});
