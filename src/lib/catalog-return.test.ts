import test from "node:test";
import assert from "node:assert/strict";
import { catalogReturnHref, catalogReturnQuery } from "./catalog-return";

test("the catalog's own view keys survive the round trip, nothing else", () => {
  assert.equal(catalogReturnQuery("?category=3&supplier=12&sort=price-asc&q=light&open=66"), "category=3&supplier=12&sort=price-asc&q=light&open=66");
  assert.equal(catalogReturnQuery("category=3&saved=1&redirect=https%3A%2F%2Fevil.example"), "category=3");
  assert.equal(catalogReturnQuery(""), "");
  assert.equal(catalogReturnQuery(null), "");
  assert.equal(catalogReturnQuery(42), "");
});

test("ids must be numeric, the sort must be a known one, and text is capped", () => {
  assert.equal(catalogReturnQuery("category=abc&supplier=-1&open=1e3&sort=name"), "");
  assert.equal(catalogReturnQuery("sort=price-asc"), "sort=price-asc");
  assert.equal(catalogReturnQuery(`q=${"x".repeat(500)}`), `q=${"x".repeat(200)}`);
});

test("the return href always lands on the catalog with the saved toast", () => {
  assert.equal(catalogReturnHref("q=light&category=3"), "/catalog?category=3&q=light&saved=1");
  assert.equal(catalogReturnHref(""), "/catalog?saved=1");
  assert.equal(catalogReturnHref("//evil.example/x"), "/catalog?saved=1");
});
