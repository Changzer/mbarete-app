import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { emptyRequired, localProblem, readErrorKey, REQUIRED_FIELDS, saveErrorKey } from "./submit-checks";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

test("a save the server would refuse is caught first, in the order it gets fixed", () => {
  assert.equal(localProblem(form({ supplierVatPct: "13", hsCode: "3923.90.00", cnHsCode: "3923900000" }), ["18", ""]), null);
  assert.equal(localProblem(form({}), []), null, "an empty export group is fine");
  assert.deepEqual(localProblem(form({ supplierVatPct: "101" }), []), {
    error: "invalid-supplier-vat",
    focusId: "supplierVatPct",
    openExport: false,
  });
  assert.deepEqual(localProblem(form({ supplierVatPct: "-1", hsCode: "12" }), []), {
    error: "invalid-supplier-vat",
    focusId: "supplierVatPct",
    openExport: false,
  }, "VAT first: it sits above the folded export group");
  assert.deepEqual(localProblem(form({ hsCode: "12", cnHsCode: "1" }), ["abc"]), {
    error: "invalid-hs-code",
    focusId: "hsCode",
    openExport: true,
  });
  assert.equal(localProblem(form({ cnHsCode: "39239000" }), [])?.error, "invalid-cn-hs-code", "China's code has ten digits");
  assert.deepEqual(localProblem(form({}), ["", "250"]), { error: "invalid-duty", focusId: "importDuty", openExport: true });
});

test("a refused save points at what is empty; one name of either language is enough", () => {
  assert.deepEqual([...emptyRequired(form({ nameEn: "", nameZh: " ", moq: "1", qtyPerBox: "10" }))], ["nameEn", "nameZh"]);
  assert.deepEqual([...emptyRequired(form({ nameZh: "发夹", moq: "", qtyPerBox: " " }))], ["moq", "qtyPerBox"]);
  assert.equal(emptyRequired(form({ nameEn: "Clip", moq: "1", qtyPerBox: "1" })).size, 0);
  assert.deepEqual([...REQUIRED_FIELDS], ["nameEn", "nameZh", "moq", "qtyPerBox"]);
});

test("every outcome names a message that exists in both languages", () => {
  const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8")).catalog;
  const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8")).catalog;
  const keys = [
    ...["invalid-hs-code", "invalid-cn-hs-code", "invalid-supplier-vat", "invalid-duty", "duplicate-sku", "image-error", "limit-products", "invalid", "anything"].map(saveErrorKey),
    ...(["no-photos", "limit", "failed", "none"] as const).map(readErrorKey),
  ];
  assert.equal(saveErrorKey("invalid"), "errorRequiredFields");
  assert.equal(saveErrorKey("something new"), "errorRequiredFields", "an unknown code still says something");
  assert.equal(readErrorKey("none"), "suggestNcmNone");
  for (const key of keys) {
    assert.equal(typeof en[key], "string", `en ${key}`);
    assert.equal(typeof zh[key], "string", `zh ${key}`);
  }
});
