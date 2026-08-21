import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rankOffers,
  pickPrimaryOffer,
  offerSpread,
  isStaleQuote,
  type Offer,
} from "./offers";

const RATES = { USD: 1, RMB: 0.14, CNY: 0.14 };
const ctx = (orderedSupplierIds?: number[]) => ({
  basis: "RMB",
  rates: RATES,
  orderedSupplierIds: orderedSupplierIds ? new Set(orderedSupplierIds) : undefined,
});

const offer = (over: Partial<Offer> & { id: number }): Offer => ({
  supplierId: over.id,
  price: 10,
  currency: "RMB",
  moq: 100,
  leadTimeDays: 0,
  quotedOn: "2026-08-01",
  active: true,
  ...over,
});

test("offers: cheapest leads", () => {
  const list = [offer({ id: 1, price: 10.2 }), offer({ id: 2, price: 9.8 })];
  assert.equal(pickPrimaryOffer(list, ctx())?.id, 2);
});

test("offers: a tie goes to a supplier we have ordered from", () => {
  const stranger = offer({ id: 1, supplierId: 11, price: 10, quotedOn: "2026-08-10" });
  const known = offer({ id: 2, supplierId: 22, price: 10, quotedOn: "2026-01-01" });
  // The stranger has the fresher quote and still loses: proven beats fresh.
  assert.equal(pickPrimaryOffer([stranger, known], ctx([22]))?.id, 2);
});

test("offers: with no history, the freshest quote wins the tie", () => {
  const old = offer({ id: 1, supplierId: 11, price: 10, quotedOn: "2025-02-01" });
  const fresh = offer({ id: 2, supplierId: 22, price: 10, quotedOn: "2026-08-01" });
  assert.equal(pickPrimaryOffer([old, fresh], ctx())?.id, 2);
});

test("offers: same price and same quote date falls back to the newest offer", () => {
  const a = offer({ id: 7, supplierId: 11 });
  const b = offer({ id: 9, supplierId: 22 });
  assert.equal(pickPrimaryOffer([a, b], ctx())?.id, 9);
});

test("offers: inactive offers never lead, and never count", () => {
  const dead = offer({ id: 1, price: 1, active: false });
  const live = offer({ id: 2, price: 10 });
  assert.equal(pickPrimaryOffer([dead, live], ctx())?.id, 2);
  assert.equal(offerSpread([dead, live], ctx())!.count, 1);
});

test("offers: a product with no active offers has no primary and no spread", () => {
  assert.equal(pickPrimaryOffer([offer({ id: 1, active: false })], ctx()), undefined);
  assert.equal(offerSpread([], ctx()), null);
});

test("offers: mixed currencies are ranked after conversion, not on raw numbers", () => {
  // 1.42 USD is 10.14 RMB — dearer than a 9.80 RMB quote, though its raw
  // number is far smaller.
  const usd = offer({ id: 1, price: 1.42, currency: "USD" });
  const rmb = offer({ id: 2, price: 9.8, currency: "RMB" });
  assert.equal(pickPrimaryOffer([usd, rmb], ctx())?.id, 2);
});

test("offers: an unknown currency still ranks instead of disappearing", () => {
  const odd = offer({ id: 1, price: 5, currency: "KRW" });
  const rmb = offer({ id: 2, price: 9.8, currency: "RMB" });
  const ranked = rankOffers([odd, rmb], ctx());
  assert.equal(ranked.length, 2);
});

test("offers: spread reports the range and how much the best actually saves", () => {
  const s = offerSpread(
    [
      offer({ id: 1, price: 10 }),
      offer({ id: 2, price: 9.4 }),
      offer({ id: 3, price: 12 }),
    ],
    ctx(),
  )!;
  assert.equal(s.count, 3);
  // Basis is RMB and these quotes are RMB, so they compare at face value.
  assert.ok(Math.abs(s.lowest - 9.4) < 1e-9);
  assert.ok(Math.abs(s.highest - 12) < 1e-9);
  // 9.40 against a next-best 10.00 is a 6% saving.
  assert.ok(Math.abs(s.advantagePct! - 6) < 1e-9);
});

test("offers: a lone offer has no advantage to report", () => {
  assert.equal(offerSpread([offer({ id: 1 })], ctx())!.advantagePct, null);
});

test("offers: quotes age out after half a year", () => {
  const today = new Date("2026-08-19T00:00:00Z");
  assert.equal(isStaleQuote("2026-08-01", today), false);
  assert.equal(isStaleQuote("2025-06-01", today), true);
  // A malformed date is not evidence of staleness.
  assert.equal(isStaleQuote("", today), false);
});
