import test from "node:test";
import assert from "node:assert/strict";
import { productSchema } from "./validators";
import { draftExportFields } from "./customs";
import { shippingRateSchema } from "./shipping-rate-schema";

const product = { nameEn: "Sample", categoryId: 1, price: 10, currency: "USD", moq: 1, qtyPerBox: 10 };

test("unknown product duties stay null through form validation; explicit zero survives", () => {
  for (const unknown of [undefined, null, "", "  "]) {
    const saved = productSchema.parse({ ...product, importDutyPctBr: unknown, importDutyPctPy: unknown });
    assert.equal(saved.importDutyPctBr, null);
    assert.equal(saved.importDutyPctPy, null);
  }
  assert.equal(productSchema.parse({ ...product, importDutyPctBr: "0" }).importDutyPctBr, 0);
  assert.equal(productSchema.parse({ ...product, importDutyPctBr: "16,5" }).importDutyPctBr, 16.5);
  for (const invalid of ["bad", "-1", "201", Infinity]) {
    assert.equal(productSchema.safeParse({ ...product, importDutyPctBr: invalid }).success, false);
  }
});

test("classification accepts HS/NCM formatting but rejects malformed and mixed-text codes", () => {
  assert.equal(productSchema.parse({ ...product, hsCode: "4202.22.00" }).hsCode, "42022200");
  assert.equal(productSchema.parse({ ...product, hsCode: "420222" }).hsCode, "420222");
  for (const hsCode of ["4202220", "420222000", "4202220000", "HS42022200"]) {
    assert.equal(productSchema.safeParse({ ...product, hsCode }).success, false);
  }
});

test("draft review preserves destination, cleared code, unknown duty and explicit zero", () => {
  assert.deepEqual(draftExportFields({ hsCode: "", exportDestination: "PY", importDutyPctBr: "", importDutyPctPy: "0" }, "42022200"), {
    hsCode: "", exportDestination: "PY", importDutyPctBr: null, importDutyPctPy: 0,
  });
  assert.deepEqual(draftExportFields({}, "42022200"), {
    hsCode: "42022200", exportDestination: "", importDutyPctBr: null, importDutyPctPy: null,
  });
});

test("shipping quotes reject impossible dates and values that cannot be stored", () => {
  const quote = { destination: "BR", mode: "fcl", basis: "per_40hq", amount: "6800,50", currency: "usd", usableCbm: "68,5", effectiveFrom: "2026-09-17" };
  assert.equal(shippingRateSchema.parse(quote).amount, 6800.5);
  assert.equal(shippingRateSchema.parse(quote).usableCbm, 68.5);
  for (const effectiveFrom of ["2026-02-30", "2026-13-01", "garbage"]) {
    assert.equal(shippingRateSchema.safeParse({ ...quote, effectiveFrom }).success, false);
  }
  for (const amount of ["", "0", "-1", "1000000000000", "NaN"]) {
    assert.equal(shippingRateSchema.safeParse({ ...quote, amount }).success, false);
  }
});
