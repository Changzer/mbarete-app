import { test } from "node:test";
import assert from "node:assert/strict";
import { waitlistSchema } from "./waitlist-schema";

const base = { name: "Li Wei", companyName: "Sunrise Trading", email: "li@example.com" };

test("a signup with no preferred contact at all is valid", () => {
  const r = waitlistSchema.safeParse(base);
  assert.equal(r.success, true);
  assert.equal(r.data?.preferredContact, null);
});

test("an empty, blank or absent contact field all mean none given", () => {
  for (const preferredContact of ["", "   ", null, undefined]) {
    const r = waitlistSchema.safeParse({ ...base, preferredContact });
    assert.equal(r.success, true, `rejected ${JSON.stringify(preferredContact)}`);
    assert.equal(r.data?.preferredContact, null);
  }
});

// The point of the field: the page is written for teams inside and outside
// China, so every handle a sourcing buyer actually answers on has to fit.
test("every handle a buyer might answer on is accepted", () => {
  for (const handle of [
    "wxid_liwei88",
    "+55 11 98888 7777",
    "+86 138 0013 8000",
    "+1 415 555 0132",
    "微信同号 13800138000",
  ]) {
    const r = waitlistSchema.safeParse({ ...base, preferredContact: handle });
    assert.equal(r.success, true, `rejected ${handle}`);
    assert.equal(r.data?.preferredContact, handle);
  }
});

test("email is trimmed and lower-cased so the unique index sees one address", () => {
  const r = waitlistSchema.safeParse({ ...base, email: "  LIWEI@Example.COM " });
  assert.equal(r.data?.email, "liwei@example.com");
});

test("name, company and a well-formed email are still required", () => {
  for (const bad of [
    { ...base, name: "" },
    { ...base, companyName: "  " },
    { ...base, email: "not-an-email" },
    { ...base, preferredContact: "x".repeat(201) },
  ]) {
    assert.equal(waitlistSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});
