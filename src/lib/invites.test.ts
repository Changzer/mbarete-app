import { test } from "node:test";
import assert from "node:assert/strict";
import { hashInviteToken, newInviteToken, isoIn, isoNow, INVITE_TTL_MS } from "./invites";

test("invite tokens are long, url-safe, and never stored raw", () => {
  const token = newInviteToken();
  assert.ok(token.length >= 40);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  const hash = hashInviteToken(token);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
  // Deterministic (lookup works), distinct per token.
  assert.equal(hash, hashInviteToken(token));
  assert.notEqual(hash, hashInviteToken(newInviteToken()));
});

test("expiry timestamps compare lexicographically in schema shape", () => {
  const now = isoNow();
  const later = isoIn(INVITE_TTL_MS);
  assert.match(now, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.ok(later > now);
});
