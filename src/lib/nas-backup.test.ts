import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyNasReport,
  checkPairing,
  describeNasTrouble,
  isNasPublicKey,
  nasHealth,
  parseNasReport,
  shouldAlert,
  snapshotTimeMs,
} from "./nas-backup";
import { sha256sumsText } from "./backups";

const at = (iso: string) => Date.parse(iso);

test("a report is a verified snapshot or a reason, nothing else", () => {
  assert.deepEqual(parseNasReport({ ok: true, snapshot: "backup-20261022-050000", files: 12, bytes: 3456, kept: 31 }), {
    ok: true,
    snapshot: "backup-20261022-050000",
    files: 12,
    bytes: 3456,
    kept: 31,
  });
  assert.deepEqual(parseNasReport({ ok: false, error: " ssh timed out " }), { ok: false, error: "ssh timed out" });
  assert.equal(parseNasReport({ ok: true, snapshot: "../../etc", files: 1, bytes: 1, kept: 1 }), null);
  assert.equal(parseNasReport({ ok: false, error: "" }), null);
  assert.equal(parseNasReport("hello"), null);
});

test("a success clears the failure before it; a failure keeps the last good copy", () => {
  const ok = applyNasReport(null, { ok: true, snapshot: "backup-20261021-050000", files: 1, bytes: 1, kept: 1 }, new Date("2026-10-21T08:00:00Z"));
  const failed = applyNasReport(ok, { ok: false, error: "no route" }, new Date("2026-10-22T08:00:00Z"));
  assert.equal(failed.lastOk?.snapshot, "backup-20261021-050000");
  assert.equal(failed.lastFailure?.error, "no route");
  const healed = applyNasReport(failed, { ok: true, snapshot: "backup-20261022-050000", files: 2, bytes: 2, kept: 2 }, new Date("2026-10-22T09:00:00Z"));
  assert.equal(healed.lastFailure, null);
  assert.equal(healed.lastOk?.at, "2026-10-22T09:00:00.000Z");
});

test("stale counts from when the snapshot was taken, not when the NAS last spoke", () => {
  assert.equal(snapshotTimeMs("backup-20261022-050000"), at("2026-10-22T05:00:00Z"));
  assert.equal(snapshotTimeMs("nope"), null);
  assert.deepEqual(nasHealth(null, at("2026-10-22T12:00:00Z")), { level: "off" });
  const state = applyNasReport(null, { ok: true, snapshot: "backup-20261020-050000", files: 1, bytes: 1, kept: 9 }, new Date("2026-10-22T11:00:00Z"));
  const fresh = nasHealth(state, at("2026-10-21T12:00:00Z"), 48);
  assert.equal(fresh.level, "ok");
  // The NAS reported an hour ago, but what it holds is 55 hours old: the server stopped backing up.
  const stale = nasHealth(state, at("2026-10-22T12:00:00Z"), 48);
  assert.equal(stale.level, "stale");
  assert.equal("ageHours" in stale ? stale.ageHours : null, 55);
  const failing = nasHealth(applyNasReport(state, { ok: false, error: "x" }, new Date()), at("2026-10-20T06:00:00Z"), 48);
  assert.equal(failing.level, "failing");
});

test("the operator hears once a day while it lasts, and only when something is wrong", () => {
  const state = applyNasReport(null, { ok: false, error: "ssh: connect to host timed out" }, new Date("2026-10-22T02:00:00Z"));
  const health = nasHealth(state, at("2026-10-22T03:00:00Z"));
  assert.equal(shouldAlert(health, null, at("2026-10-22T03:00:00Z")), true);
  assert.equal(shouldAlert(health, "2026-10-22T02:30:00Z", at("2026-10-22T20:00:00Z")), false);
  assert.equal(shouldAlert(health, "2026-10-21T02:30:00Z", at("2026-10-22T03:00:00Z")), true);
  assert.equal(shouldAlert({ level: "off" }, null, Date.now()), false);
  const mail = describeNasTrouble(health);
  assert.match(mail!.subject, /NAS backup failed/);
  assert.match(mail!.text, /ssh: connect to host timed out/);
});

test("SHA256SUMS lists every dump and upload in the format sha256sum -c reads", () => {
  const text = sha256sumsText(
    { orders: "a".repeat(64), contacts: "b".repeat(64) },
    { "c1/photo.jpg": { size: 3, sha256: "c".repeat(64) }, "c1/odd\\name.jpg": { size: 1, sha256: "d".repeat(64) } },
  );
  assert.equal(
    text,
    `${"b".repeat(64)}  db/contacts.jsonl.gz\n` +
      `${"a".repeat(64)}  db/orders.jsonl.gz\n` +
      `\\${"d".repeat(64)}  uploads/c1/odd\\\\name.jpg\n` +
      `${"c".repeat(64)}  uploads/c1/photo.jpg\n`,
  );
});

test("pairing takes one ed25519 public key with the right code, before it expires", () => {
  const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFnMhGI/VlSrQXGnW6zYQY8TuCtvg/GIz/SXbUJUaOse";
  assert.equal(isNasPublicKey(key), true);
  assert.equal(isNasPublicKey(`${key} mbarete-nas`), true);
  assert.equal(isNasPublicKey(`${key} mbarete-nas\nssh-ed25519 AAAA… evil`), false, "one line only");
  assert.equal(isNasPublicKey(`command="sh" ${key}`), false, "no options can ride along");
  assert.equal(isNasPublicKey("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ abel"), false);
  assert.equal(isNasPublicKey("937e1b286875acd442fde3dc343bb4c8d25040905bf132b3f2ed7366b53683c3"), false, "a token is not a key");

  const pairing = { code: "59b117e5b6d8ce238de90679bd620f52", expiresAt: "2026-10-22T05:20:00Z" };
  const now = Date.parse("2026-10-22T05:05:00Z");
  assert.equal(checkPairing(pairing, "59b117e5b6d8ce238de90679bd620f52", now), "ok");
  assert.equal(checkPairing(pairing, "00000000000000000000000000000000", now), "wrong-code");
  assert.equal(checkPairing(pairing, "59b117e5b6d8ce238de90679bd620f52", Date.parse("2026-10-22T05:21:00Z")), "expired");
  assert.equal(checkPairing(null, "anything", now), "closed");
  assert.equal(checkPairing({ code: "", expiresAt: "2099-01-01T00:00:00Z" }, "", now), "closed", "an empty code never opens it");
});
