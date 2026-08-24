import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { roundMoney } from "@/lib/calculations";

/**
 * The money columns are numeric(14,4) read back through JS doubles
 * (drizzle's mode: "number"). That is only safe while every value the
 * database can hold survives the string → double → string trip exactly —
 * true because ulp(x) < 1e-4 for |x| < 2^53 / 1e4, and numeric(14,4) tops
 * out at 1e10, far inside that. This suite asserts the property instead of
 * trusting the argument, so widening the precision or scale without
 * rethinking the double path fails a test rather than corrupting a ledger.
 *
 * BigInt is written constructor-style throughout: the build's typecheck
 * target predates bigint literals, but the runtime (and lib: esnext) has
 * the type itself.
 */

/** numeric(14,4): up to 10 integer digits, 4 fractional. */
const SCALE = 4;
const ZERO = BigInt(0);
const TEN = BigInt(10);
const SCALE_UNITS = TEN ** BigInt(SCALE);
const MAX_UNITS = TEN ** BigInt(14); // all values are k / 10^4 with |k| below this

/** The canonical string Postgres sends for k/10^4 — exact, no doubles. */
function pgNumericString(units: bigint): string {
  const sign = units < ZERO ? "-" : "";
  const abs = units < ZERO ? -units : units;
  const whole = abs / SCALE_UNITS;
  const frac = (abs % SCALE_UNITS).toString().padStart(SCALE, "0");
  return `${sign}${whole}.${frac}`;
}

/** Deterministic PRNG so a failure reproduces (mulberry32). */
function makeRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnits(random: () => number): bigint {
  // Uniform over digit counts rather than magnitude, so small prices and
  // ten-digit order books are probed equally hard.
  const digits = 1 + Math.floor(random() * 14);
  let units = ZERO;
  for (let i = 0; i < digits; i++) {
    units = units * TEN + BigInt(Math.floor(random() * 10));
  }
  return (units % MAX_UNITS) * (random() < 0.5 ? BigInt(-1) : BigInt(1));
}

function assertRoundTrips(units: bigint) {
  const wire = pgNumericString(units);
  const asDouble = Number(wire); // what drizzle mode:"number" does on read
  assert.equal(
    asDouble.toFixed(SCALE),
    wire === "-0.0000" ? "0.0000" : wire,
    `k=${units} did not round-trip`,
  );
  // Re-rounding an already-exact value must be the identity, or every save
  // would drift what it read.
  assert.equal(roundMoney(asDouble, SCALE), asDouble, `roundMoney moved k=${units}`);
}

describe("numeric(14,4) round-trips exactly through doubles", () => {
  it("survives string → Number → toFixed for 20k random values", () => {
    const random = makeRandom(0x6d6f6e79); // "mony"
    for (let i = 0; i < 20_000; i++) assertRoundTrips(randomUnits(random));
  });

  it("survives the exact boundaries of the column", () => {
    for (const units of [
      ZERO,
      BigInt(1), // 0.0001, the smallest step
      BigInt(-1),
      MAX_UNITS - BigInt(1), // 9999999999.9999, the largest value
      BigInt(1) - MAX_UNITS,
      TEN ** BigInt(13), // 1000000000.0000, first ten-digit whole
      BigInt("99999999999994"), // near-max, non-round digits
    ]) {
      assertRoundTrips(units);
    }
  });

  it("keeps sums of exact cents exact across a large order book", () => {
    // 100k lines of odd cents: doubles add cents exactly at these magnitudes,
    // so the running sum must equal the bigint truth to the cent.
    const random = makeRandom(0xb00cceed);
    let sum = 0;
    let truthCents = ZERO;
    for (let i = 0; i < 100_000; i++) {
      const cents = Math.floor(random() * 10_000_000); // ≤ $100k lines
      truthCents += BigInt(cents);
      sum += cents / 100;
    }
    assert.equal(roundMoney(sum), Number(truthCents) / 100);
  });

  it("rounds typed halves the way the person typed them", () => {
    assert.equal(roundMoney(1.005), 1.01);
    assert.equal(roundMoney(-1.005), -1.01);
    assert.equal(roundMoney(2.675), 2.68);
  });
});
