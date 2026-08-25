import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLimiter } from "./rate-limit";

test("limiter: allows up to max hits in a window, then refuses", () => {
  const l = makeLimiter({ max: 3, windowMs: 60_000 });
  assert.equal(l.hit("a"), false);
  assert.equal(l.hit("a"), false);
  assert.equal(l.hit("a"), false);
  assert.equal(l.hit("a"), true);
  assert.equal(l.isLimited("a"), true);
});

test("limiter: keys are independent", () => {
  const l = makeLimiter({ max: 1, windowMs: 60_000 });
  l.hit("a");
  assert.equal(l.hit("a"), true);
  assert.equal(l.hit("b"), false);
});

test("limiter: clear forgets a key's streak", () => {
  const l = makeLimiter({ max: 1, windowMs: 60_000 });
  l.hit("a");
  assert.equal(l.isLimited("a"), true);
  l.clear("a");
  assert.equal(l.isLimited("a"), false);
});

test("limiter: a flood of unique keys stays bounded", () => {
  const l = makeLimiter({ max: 1, windowMs: 60_000, maxKeys: 100 });
  for (let i = 0; i < 10_000; i += 1) l.hit(`probe-${i}`);
  // The hard ceiling: every key here is inside one window (nothing expires),
  // so only oldest-first eviction can hold the line.
  assert.ok(l.size() <= 101, `limiter held ${l.size()} keys, bound is 100`);
  assert.equal(l.isLimited("fresh"), false);
});

test("lockout is keyed per (ip, email) pair — attacker cannot lock the victim", () => {
  // The exact shape auth.ts uses: pair-keyed lockout. An attacker at evil-ip
  // burning the victim's email locks only their own pair.
  const pairLockout = makeLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
  for (let i = 0; i < 10; i += 1) pairLockout.hit("evil-ip|boss@company.com");
  assert.equal(pairLockout.isLimited("evil-ip|boss@company.com"), true);
  assert.equal(pairLockout.isLimited("home-ip|boss@company.com"), false);
});
