import { test } from "node:test";
import assert from "node:assert/strict";
import { backupName, BACKUP_NAME_RE, isBackupDue, namesToPrune, isUnchanged } from "./backups";

const H = 3_600_000;

test("backups: names are UTC-stamped and lexically chronological", () => {
  const a = backupName(new Date("2026-08-25T05:00:00Z"));
  const b = backupName(new Date("2026-08-26T04:59:59Z"));
  assert.equal(a, "backup-20260825-050000");
  assert.ok(BACKUP_NAME_RE.test(a));
  assert.ok(a < b);
});

test("backups: due with none yet, due near the interval, not due after one", () => {
  const now = Date.parse("2026-08-25T05:00:00Z");
  assert.equal(isBackupDue(null, now, 24 * H), true);
  // The half-hour slack keeps a daily backup from drifting later each day.
  assert.equal(isBackupDue(now - 23.5 * H, now, 24 * H), true);
  assert.equal(isBackupDue(now - 23 * H, now, 24 * H), false);
  assert.equal(isBackupDue(now - 25 * H, now, 24 * H), true);
});

test("backups: pruning keeps the newest N and ignores foreign names", () => {
  const names = [
    "backup-20260820-050000",
    "backup-20260821-050000",
    "backup-20260822-050000",
    "backup-20260823-050000",
    "lost+found",
    ".tmp-backup-20260824-050000",
  ];
  assert.deepEqual(namesToPrune(names, 2), ["backup-20260821-050000", "backup-20260820-050000"]);
  assert.deepEqual(namesToPrune(names, 10), []);
  // Retention can never prune everything.
  assert.deepEqual(namesToPrune(["backup-20260820-050000"], 0), []);
});

test("backups: a file is unchanged only when size and mtime both match", () => {
  const s = { size: 100, mtimeMs: 5000 };
  assert.equal(isUnchanged({ size: 100, mtimeMs: 5000 }, s), true);
  // Sub-2ms drift from filesystems rounding restored timestamps is absorbed…
  assert.equal(isUnchanged({ size: 100, mtimeMs: 5001 }, s), true);
  // …but a real difference is a real difference.
  assert.equal(isUnchanged({ size: 100, mtimeMs: 5002 }, s), false);
  assert.equal(isUnchanged({ size: 101, mtimeMs: 5000 }, s), false);
  assert.equal(isUnchanged(null, s), false);
});
