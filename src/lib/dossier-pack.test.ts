import test from "node:test";
import assert from "node:assert/strict";
import { buildDossierReadme, catalogRows, dossierDigest } from "./dossier-pack";
import { computeDeadlines, computeDossierStatus } from "./dossier";

test("the digest covers numbered document files only and is order-independent", () => {
  const a = dossierDigest([
    { path: "310120261234567890/01_报关单_a.pdf", sha256: "aa" },
    { path: "310120261234567890/README.txt", sha256: "r1" },
    { path: "310120261234567890/manifest.json", sha256: "m1" },
    { path: "310120261234567890/00_单证目录.xlsx", sha256: "x1" },
  ]);
  const b = dossierDigest([
    { path: "310120261234567890/00_单证目录.xlsx", sha256: "x2" },
    { path: "310120261234567890/01_报关单_a.pdf", sha256: "aa" },
    { path: "310120261234567890/README.txt", sha256: "r2" },
  ]);
  assert.equal(a, b);
  assert.notEqual(a, dossierDigest([{ path: "310120261234567890/01_报关单_a.pdf", sha256: "ab" }]));
});

test("the catalog reads like the accountant's sheet: number, label, tick, note", () => {
  const status = computeDossierStatus({ taxRegime: "rebate", exportDate: null, hasLines: true }, [
    { id: 1, kind: "customs_declaration", fapiaoType: null, originalName: "a.pdf", path: "/uploads/c1/a.pdf", sizeBytes: 1 },
  ]);
  const rows = catalogRows(status, new Map([[1, ["01_报关单_a.pdf"]]]));
  assert.equal(rows.length, 19);
  assert.equal(rows[0].check, "✓");
  assert.equal(rows[0].files, "01_报关单_a.pdf");
  assert.equal(rows[7].check, "✓");
  assert.equal(rows[7].status, "auto");
  assert.equal(rows[1].check, "✗");
  assert.match(rows[5].note, /13%\/3%增值税专用发票/);
});

test("the README states the regime, the ten-year retention and the deadlines", () => {
  const text = buildDossierReadme({
    companyName: "Mbarete",
    orderNumber: "ORD-1",
    customsDeclarationNo: "310120261234567890",
    regime: "exempt",
    deadlines: computeDeadlines("2026-06-10"),
    exportDate: "2026-06-10",
    generatedAt: "2026-09-10T00:00:00Z",
    digest: "abc",
  });
  assert.match(text, /310120261234567890/);
  assert.match(text, /出口免税/);
  assert.match(text, /10年/);
  assert.match(text, /2026年第5号/);
  assert.match(text, /2027-04-30/);
  assert.match(text, /2029-06-10/);
  assert.match(text, /转入成本/);
});
