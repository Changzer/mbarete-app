import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256sumsText } from "./backups";

/**
 * scripts/nas/mbarete-nas-backup.sh end to end, against a fake server that is
 * locked down exactly like the real one: every ssh call lands in
 * `rrsync -ro <backups>`, the forced command the NAS key is given on the VPS.
 * Needs rsync (with rrsync) and sha256sum, like the NAS itself.
 */

const SCRIPT = path.resolve("scripts/nas/mbarete-nas-backup.sh");
const has = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const ready = has("rsync") && has("rrsync") && has("sha256sum");

const sha = (data: string) => crypto.createHash("sha256").update(data).digest("hex");

const snapshotDate = (name: string) => new Date(`${name.slice(7, 11)}-${name.slice(11, 13)}-${name.slice(13, 15)}T05:00:00Z`);

function makeSnapshot(root: string, name: string, files: Record<string, string>, opts: { sums?: boolean; corrupt?: string } = {}) {
  const dir = path.join(root, name);
  const db: Record<string, string> = {};
  const uploads: Record<string, { size: number; sha256: string }> = {};
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
    // Uploads keep their mtime night after night, as the app's mirror does;
    // table dumps are written fresh each night.
    const when = rel.startsWith("db/") ? snapshotDate(name) : new Date("2026-10-01T00:00:00Z");
    fs.utimesSync(path.join(dir, rel), when, when);
    const hash = rel === opts.corrupt ? sha("something else") : sha(content);
    if (rel.startsWith("db/")) db[rel.slice(3).replace(/\.jsonl\.gz$/, "")] = hash;
    else uploads[rel.slice("uploads/".length)] = { size: content.length, sha256: hash };
  }
  if (opts.sums !== false) fs.writeFileSync(path.join(dir, "SHA256SUMS"), sha256sumsText(db, uploads));
  fs.writeFileSync(path.join(dir, "manifest.json"), "{}");
}

/** Runs the script without blocking: the report server lives in this same process. */
function runScript(args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", [SCRIPT, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function reportServer(): Promise<{ server: Server; url: string; bodies: unknown[] }> {
  const bodies: unknown[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}/api/backups/nas-report`, bodies };
}

test("the NAS pulls, hardlinks, retries, refuses a bad copy and reports", { skip: !ready && "needs rsync, rrsync and sha256sum" }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nas-"));
  const server = path.join(tmp, "server");
  const nas = path.join(tmp, "nas");
  fs.mkdirSync(server);
  fs.mkdirSync(nas);
  const failOnce = path.join(tmp, "fail-once");
  // The fake ssh: drop the host, run what the forced command would.
  const fakeSsh = path.join(tmp, "fake-ssh");
  fs.writeFileSync(
    fakeSsh,
    `#!/bin/sh\n[ "$1" = "-l" ] && shift 2\nshift\nif [ -f "${failOnce}" ]; then rm -f "${failOnce}"; echo "ssh: connect to host timed out" >&2; exit 255; fi\nSSH_ORIGINAL_COMMAND="$*" exec rrsync -ro "${server}"\n`,
  );
  fs.chmodSync(fakeSsh, 0o755);
  const { server: http, url, bodies } = await reportServer();
  const env = {
    ...process.env,
    NAS_BACKUP_CONF: path.join(tmp, "none.conf"),
    DEST: nas,
    VPS: "backup@tokyo",
    SSH_CMD: fakeSsh,
    RETRIES: "3",
    RETRY_DELAYS: "0",
    REPORT_URL: url,
    REPORT_TOKEN: "secret-token",
  };
  const run = (...args: string[]) => runScript(args, env);
  const inode = (p: string) => fs.statSync(p).ino;
  const last = () => (bodies[bodies.length - 1] as { body: Record<string, unknown> }).body;

  try {
    // Night one: the first copy arrives whole and checks out.
    makeSnapshot(server, "backup-20261020-050000", {
      "db/orders.jsonl.gz": "orders v1",
      "uploads/c1/photo-a.jpg": "photo A",
    });
    let r = await run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(nas, "snapshots/backup-20261020-050000/uploads/c1/photo-a.jpg")));
    assert.deepEqual(last(), { ok: true, snapshot: "backup-20261020-050000", files: 2, bytes: last().bytes, kept: 1 });
    assert.equal((bodies[0] as { auth: string }).auth, "Bearer secret-token");

    // Night two: only what changed travels; the old photo is the same file on disk.
    makeSnapshot(server, "backup-20261021-050000", {
      "db/orders.jsonl.gz": "orders v2",
      "uploads/c1/photo-a.jpg": "photo A",
      "uploads/c1/photo-b.jpg": "photo B",
    });
    r = await run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(
      inode(path.join(nas, "snapshots/backup-20261021-050000/uploads/c1/photo-a.jpg")),
      inode(path.join(nas, "snapshots/backup-20261020-050000/uploads/c1/photo-a.jpg")),
      "an unchanged photo is hardlinked, not stored twice",
    );
    assert.equal(last().kept, 2);

    // Nothing new: nothing fetched, the server still hears from the NAS.
    r = await run();
    assert.match(r.stdout, /already have backup-20261021-050000/);
    assert.equal(last().snapshot, "backup-20261021-050000");

    // A photo on the NAS rots without changing size or date: the next night
    // hardlinks the rotten copy, the checksums catch it, a byte-wise fetch heals it.
    const rotten = path.join(nas, "snapshots/backup-20261021-050000/uploads/c1/photo-b.jpg");
    const stamp = fs.statSync(rotten).mtime;
    fs.writeFileSync(rotten, "photo X");
    fs.utimesSync(rotten, stamp, stamp);
    makeSnapshot(server, "backup-20261021-170000", {
      "db/orders.jsonl.gz": "orders v2b",
      "uploads/c1/photo-a.jpg": "photo A",
      "uploads/c1/photo-b.jpg": "photo B",
    });
    r = await run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /fetching again, comparing every file by content/);
    assert.equal(fs.readFileSync(path.join(nas, "snapshots/backup-20261021-170000/uploads/c1/photo-b.jpg"), "utf8"), "photo B");

    // A dropped connection is retried.
    makeSnapshot(server, "backup-20261022-050000", { "db/orders.jsonl.gz": "orders v3", "uploads/c1/photo-a.jpg": "photo A" });
    fs.writeFileSync(failOnce, "");
    r = await run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /attempt 1 failed; trying again/);
    assert.ok(fs.existsSync(path.join(nas, "snapshots/backup-20261022-050000")));

    // A copy that does not match its checksums is thrown away and reported.
    makeSnapshot(server, "backup-20261023-050000", { "db/orders.jsonl.gz": "orders v4", "uploads/c1/photo-c.jpg": "photo C" }, { corrupt: "uploads/c1/photo-c.jpg" });
    r = await run();
    assert.equal(r.status, 1);
    assert.ok(!fs.existsSync(path.join(nas, "snapshots/backup-20261023-050000")), "never kept as if it were good");
    assert.ok(!fs.existsSync(path.join(nas, ".incoming/backup-20261023-050000")));
    assert.equal(last().ok, false);
    assert.match(String(last().error), /failed verification/);

    // A snapshot made before checksums existed is passed over for one that has them.
    fs.rmSync(path.join(server, "backup-20261023-050000"), { recursive: true });
    makeSnapshot(server, "backup-20261024-050000", { "db/orders.jsonl.gz": "orders v5" }, { sums: false });
    r = await run();
    assert.match(r.stdout, /already have backup-20261022-050000/);

    // The server unreachable after every retry: a clear failure, reported.
    const unreachable = await runScript([], { ...env, SSH_CMD: "false", RETRIES: "2" });
    assert.equal(unreachable.status, 1);
    assert.match(String(last().error), /cannot reach the server/);

    // --check says what both sides hold.
    r = await run("--check");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Newest the NAS can take: backup-20261022-050000/);
  } finally {
    http.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("history: the newest 30 nights, then the first of each month for 3 years", () => {
  const names: string[] = [];
  // Four years of nightly snapshots, 2022-11-01 → 2026-10-22.
  for (let d = new Date("2022-11-01T05:00:00Z"); d <= new Date("2026-10-22T05:00:00Z"); d = new Date(d.getTime() + 86_400_000)) {
    names.push(`backup-${d.toISOString().slice(0, 10).replace(/-/g, "")}-050000`);
  }
  const out = execFileSync("sh", [SCRIPT, "--plan-retention"], {
    input: names.join("\n"),
    encoding: "utf8",
    env: { ...process.env, NAS_BACKUP_CONF: "/nonexistent", KEEP_DAILY: "30", KEEP_MONTHLY: "36" },
  });
  const deleted = new Set(out.split("\n").filter(Boolean));
  const kept = names.filter((n) => !deleted.has(n));
  const nightly = kept.filter((n) => n >= "backup-20260923");
  assert.equal(nightly.length, 30, "every night of the last 30");
  const monthly = kept.filter((n) => n < "backup-20260923");
  assert.ok(monthly.every((n) => n.slice(13, 15) === "01"), "older ones are the first of their month");
  assert.equal(monthly[0], "backup-20231101-050000", "36 months back, no further");
  // 1 October 2026 falls inside the nightly window, so 35 month-firsts lie before it.
  assert.equal(kept.length, 30 + 35, "30 nightly + the month-firsts back to November 2023");
});
