import { test } from "node:test";
import assert from "node:assert/strict";
import { enquirySchema } from "./enquiry-schema";

const base = {
  name: "Ana Souza",
  companyName: "Souza Import",
  email: "ana@souza.com.br",
  message: "500 mochilas escolares para o Brasil",
};

test("a complete enquiry with no contact handle is valid", () => {
  const r = enquirySchema.safeParse(base);
  assert.equal(r.success, true);
  assert.equal(r.data?.preferredContact, null);
});

test("an empty, blank or absent handle all mean none given", () => {
  for (const preferredContact of ["", "   ", null, undefined]) {
    const r = enquirySchema.safeParse({ ...base, preferredContact });
    assert.equal(r.success, true, `rejected ${JSON.stringify(preferredContact)}`);
    assert.equal(r.data?.preferredContact, null);
  }
});

// The buyers are spread across Latin America and the team answers from China,
// so every handle either side actually uses has to fit.
test("handles from either end of the trade are accepted", () => {
  for (const handle of [
    "+55 11 98888 7777",
    "+52 1 55 1234 5678",
    "+595 981 123456",
    "wxid_liwei88",
    "+86 138 0013 8000",
  ]) {
    const r = enquirySchema.safeParse({ ...base, preferredContact: handle });
    assert.equal(r.success, true, `rejected ${handle}`);
    assert.equal(r.data?.preferredContact, handle);
  }
});

test("email is trimmed and lower-cased", () => {
  const r = enquirySchema.safeParse({ ...base, email: "  ANA@Souza.COM.BR " });
  assert.equal(r.data?.email, "ana@souza.com.br");
});

// An enquiry with no message is a row nobody can act on.
test("the message is required and survives a long brief", () => {
  assert.equal(enquirySchema.safeParse({ ...base, message: "" }).success, false);
  assert.equal(enquirySchema.safeParse({ ...base, message: "   " }).success, false);
  const noMessage = { name: base.name, companyName: base.companyName, email: base.email };
  assert.equal(enquirySchema.safeParse(noMessage).success, false);
  assert.equal(
    enquirySchema.safeParse({ ...base, message: "x".repeat(4000) }).success,
    true,
  );
  assert.equal(
    enquirySchema.safeParse({ ...base, message: "x".repeat(4001) }).success,
    false,
  );
});

test("quantity, destination and target price are optional free text", () => {
  const r = enquirySchema.safeParse(base);
  assert.equal(r.success, true);
  assert.equal(r.data?.quantity, null);
  assert.equal(r.data?.destination, null);
  assert.equal(r.data?.targetPrice, null);

  // Whatever unit the trade uses, in whatever language.
  for (const quantity of ["500 pcs", "1x40HQ", "um contêiner", "2 000 unidades"]) {
    const q = enquirySchema.safeParse({ ...base, quantity });
    assert.equal(q.success, true, `rejected ${quantity}`);
    assert.equal(q.data?.quantity, quantity);
  }
  const full = enquirySchema.safeParse({
    ...base,
    quantity: "  1x40HQ  ",
    destination: "Santos, BR",
    targetPrice: "USD 3.50/pc",
  });
  assert.equal(full.data?.quantity, "1x40HQ");
  assert.equal(full.data?.destination, "Santos, BR");
  assert.equal(full.data?.targetPrice, "USD 3.50/pc");

  // Blank means not given, not empty string.
  assert.equal(enquirySchema.safeParse({ ...base, destination: "   " }).data?.destination, null);
  // And they are bounded.
  assert.equal(enquirySchema.safeParse({ ...base, quantity: "x".repeat(201) }).success, false);
});

test("name, company and a well-formed email are still required", () => {
  for (const bad of [
    { ...base, name: "" },
    { ...base, companyName: "  " },
    { ...base, email: "not-an-email" },
  ]) {
    assert.equal(enquirySchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});
