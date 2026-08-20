import { test } from "node:test";
import assert from "node:assert/strict";
import { findSimilarContact, phoneDigits, type MatchCandidate } from "./contact-match";

const CANDIDATES: MatchCandidate[] = [
  {
    id: 1,
    companyName: "YaoYao Accessories",
    companyNameZh: "瑶瑶饰品",
    phone: "189 6795 5270 / 13646896166",
  },
  { id: 2, companyName: "Scooter King", companyNameZh: "", phone: "+86 139 0000 1111" },
  { id: 3, companyName: "", companyNameZh: "小商品公司", phone: "" },
];

test("phoneDigits splits multi-number fields and drops fragments", () => {
  assert.deepEqual(phoneDigits("189 6795 5270 / 13646896166"), [
    "18967955270",
    "13646896166",
  ]);
  assert.deepEqual(phoneDigits("ext. 42"), []);
});

test("matches on any shared phone, ignoring formatting", () => {
  const hit = findSimilarContact(CANDIDATES, { phone: "13646896166" });
  assert.equal(hit?.id, 1);
});

test("matches when one side carries a country code", () => {
  const hit = findSimilarContact(CANDIDATES, { phone: "13900001111" });
  assert.equal(hit?.id, 2);
});

test("matches on company name in either language, case-insensitively", () => {
  assert.equal(findSimilarContact(CANDIDATES, { companyName: "yaoyao accessories" })?.id, 1);
  assert.equal(findSimilarContact(CANDIDATES, { companyNameZh: "小商品公司" })?.id, 3);
});

test("no match for a genuinely new vendor", () => {
  const hit = findSimilarContact(CANDIDATES, {
    companyName: "Brand New Trading",
    phone: "15812345678",
  });
  assert.equal(hit, undefined);
});

test("an empty draft never matches", () => {
  assert.equal(findSimilarContact(CANDIDATES, {}), undefined);
});
