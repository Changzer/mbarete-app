import test from "node:test";
import assert from "node:assert/strict";
import {
  DOSSIER_ITEMS,
  CUSTOMS_NO,
  addMonths,
  computeDeadlines,
  computeDossierStatus,
  dossierFileName,
  dossierFolderName,
  type DossierDocument,
} from "./dossier";

const doc = (kind: string, fapiaoType: string | null = null, id = 1): DossierDocument => ({
  id,
  kind,
  fapiaoType,
  originalName: `${kind}.pdf`,
  path: `/uploads/c1/doc-${id}.pdf`,
  sizeBytes: 10,
});
const status = (regime: "undecided" | "rebate" | "exempt", docs: DossierDocument[], exportDate: string | null = null) =>
  computeDossierStatus({ taxRegime: regime, exportDate, hasLines: true }, docs);
const item6 = (s: ReturnType<typeof status>) => s.items.find((i) => i.n === 6)!;

test("the accountant's nineteen rows, numbered and keyed once", () => {
  assert.equal(DOSSIER_ITEMS.length, 19);
  assert.deepEqual(DOSSIER_ITEMS.map((i) => i.n), Array.from({ length: 19 }, (_, k) => k + 1));
  assert.equal(new Set(DOSSIER_ITEMS.map((i) => i.key)).size, 19);
  assert.deepEqual(DOSSIER_ITEMS.filter((i) => i.optional).map((i) => i.n), [18, 19]);
  assert.deepEqual(DOSSIER_ITEMS.filter((i) => i.auto).map((i) => i.n), [8]);
  assert.deepEqual(DOSSIER_ITEMS.filter((i) => i.video).map((i) => i.n), [19]);
});

test("item 6 under a rebate: special invoices pass, a 3% one with a cap note, ordinary or none is a risk", () => {
  assert.deepEqual(item6(status("rebate", [doc("supplier_invoice", "special")])), {
    n: 6, key: "supplier_invoice", status: "uploaded", files: [doc("supplier_invoice", "special")],
  });
  assert.equal(item6(status("rebate", [doc("supplier_invoice", "special_3")])).warning, "special_3_cap");
  assert.equal(item6(status("rebate", [doc("supplier_invoice", "special_3", 1), doc("supplier_invoice", "special", 2)])).warning, undefined);
  const ordinary = item6(status("rebate", [doc("supplier_invoice", "ordinary_exempt")]));
  assert.equal(ordinary.status, "risk");
  assert.equal(ordinary.warning, "rebate_needs_special");
  const none = item6(status("rebate", [doc("supplier_invoice", "none")]));
  assert.equal(none.status, "risk");
  assert.equal(none.warning, "no_fapiao_deemed_domestic");
  assert.equal(item6(status("rebate", [])).status, "missing");
});

test("item 6 under an exemption: an ordinary invoice passes, a special one passes with a note, none is a risk", () => {
  assert.equal(item6(status("exempt", [doc("supplier_invoice", "ordinary_exempt")])).status, "uploaded");
  const special = item6(status("exempt", [doc("supplier_invoice", "special")]));
  assert.equal(special.status, "uploaded");
  assert.equal(special.warning, "exempt_but_special");
  const none = item6(status("exempt", [doc("supplier_invoice", "none")]));
  assert.equal(none.status, "risk");
  assert.equal(none.warning, "no_fapiao_deemed_domestic");
  assert.equal(item6(status("exempt", [])).status, "missing");
});

test("undecided never completes and warns once the export date is set", () => {
  const all = DOSSIER_ITEMS.map((i, k) => doc(i.key, i.key === "supplier_invoice" ? "special" : null, k + 1));
  const s = status("undecided", all);
  assert.equal(s.complete, false);
  assert.equal(s.outstanding, 0);
  assert.equal(s.undecidedWithExportDate, false);
  assert.equal(status("undecided", all, "2026-03-01").undecidedWithExportDate, true);
  assert.equal(item6(status("undecided", [doc("supplier_invoice", "none")])).status, "risk");
});

test("the proforma is automatic, the optional items never block, and complete means every required item is in", () => {
  const empty = status("rebate", []);
  assert.equal(empty.items.find((i) => i.n === 8)!.status, "auto");
  assert.equal(empty.items.find((i) => i.n === 18)!.status, "not_applicable");
  assert.equal(empty.items.find((i) => i.n === 19)!.status, "not_applicable");
  assert.equal(empty.required, 17);
  assert.equal(empty.uploaded, 1);
  assert.equal(empty.outstanding, 16);
  assert.equal(empty.complete, false);
  const requiredDocs = DOSSIER_ITEMS.filter((i) => !i.optional && !i.auto).map((i, k) =>
    doc(i.key, i.key === "supplier_invoice" ? "special" : null, k + 1),
  );
  const full = status("rebate", requiredDocs);
  assert.equal(full.outstanding, 0);
  assert.equal(full.complete, true);
  assert.equal(full.uploaded, 17);
  // The same files under an exemption fail only on item 6's fapiao type.
  const asExempt = status("exempt", requiredDocs);
  assert.equal(asExempt.complete, true);
  assert.equal(item6(asExempt).warning, "exempt_but_special");
  // No lines yet: the proforma cannot be generated, so it is missing.
  const noLines = computeDossierStatus({ taxRegime: "rebate", exportDate: null, hasLines: false }, []);
  assert.equal(noLines.items.find((i) => i.n === 8)!.status, "missing");
});

test("deadlines run from the export date, month arithmetic clamps to real days", () => {
  assert.equal(addMonths("2026-03-15", 36), "2029-03-15");
  assert.equal(addMonths("2028-02-29", 36), "2031-02-28");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2027-11-30", 3), "2028-02-29");
  assert.equal(addMonths("31/03/2026", 1), null);
  const d = computeDeadlines("2026-06-10");
  assert.equal(d.fxDeadline, "2027-04-30");
  assert.equal(d.declareDeadline, "2029-06-10");
  assert.equal(d.retentionYears, 10);
  assert.equal(d.filingDays, 15);
  assert.deepEqual(computeDeadlines(null), { fxDeadline: null, declareDeadline: null, retentionYears: 10, filingDays: 15 });
});

test("the declaration number is eighteen digits; the folder falls back to the order number", () => {
  assert.equal(CUSTOMS_NO.test("310120261234567890"), true);
  assert.equal(CUSTOMS_NO.test("31012026123456789"), false);
  assert.equal(CUSTOMS_NO.test("3101202612345678a0"), false);
  assert.equal(dossierFolderName("310120261234567890", "ORD-1"), "310120261234567890");
  assert.equal(dossierFolderName("", "ORD-20260907-755343"), "order_ORD-20260907-755343");
  assert.equal(dossierFolderName(null, "ORD 1/2"), "order_ORD_1_2");
});

test("dossier file names carry the item number and Chinese label, and shed any path", () => {
  const bl = DOSSIER_ITEMS[3];
  assert.equal(dossierFileName(bl, "../../etc/passwd"), "04_提单_passwd");
  assert.equal(dossierFileName(bl, "C:\\\\scans\\\\BL 001.pdf"), "04_提单_BL 001.pdf");
  assert.equal(dossierFileName(bl, ""), "04_提单_file");
});
