/**
 * The two-command NAS setup, rehearsed against the running app: setup-server.sh
 * opens a pairing and waits, setup-nas.sh hands its key over through the app,
 * the server script installs it read-only — and the NAS's first copy then runs
 * through exactly the line that was installed (the fake ssh below reads the
 * authorized_keys file and runs its forced command, as sshd would).
 *
 * Needs the app running with BACKUP_DIR and NAS_REPORT_TOKEN, the same
 * BACKUP_DIR here, and rsync (with rrsync), ssh-keygen and sha256sum.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKUP_DIR = process.env.BACKUP_DIR;
const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;

function start(cmd, args, opts) {
  const child = spawn(cmd, args, opts);
  const out = { text: "" };
  child.stdout.on("data", (c) => (out.text += c));
  child.stderr.on("data", (c) => (out.text += c));
  const done = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  return { child, out, done };
}

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

test("two pasted lines: the NAS pairs itself, gets a read-only key and takes its first copy", { timeout: 240_000 }, async () => {
  assert.ok(BACKUP_DIR, "BACKUP_DIR (the app's) required");
  for (const cmd of ["rsync", "rrsync", "ssh-keygen", "sha256sum"]) assert.ok(has(cmd), `${cmd} required`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nas-setup-"));
  const appDir = path.join(tmp, "app");
  const nas = path.join(tmp, "nas");
  const authKeys = path.join(tmp, "ssh", "authorized_keys");
  fs.mkdirSync(appDir);
  fs.writeFileSync(path.join(appDir, "docker-compose.yml"), "# stand-in\n");
  // The operator's own login key is there before and must be there after.
  fs.mkdirSync(path.dirname(authKeys));
  fs.writeFileSync(authKeys, "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7operatorkey abel@laptop\n");

  // A fresh backup with SHA256SUMS, as the script's step 3 makes on a real server.
  const made = spawnSync("npx", ["tsx", "scripts/backup-now.ts"], { encoding: "utf8", env: process.env });
  assert.equal(made.status, 0, made.stdout + made.stderr);

  try {
    const server = start("sh", [path.resolve("scripts/nas/setup-server.sh")], {
      cwd: appDir,
      env: {
        ...process.env,
        SKIP_DEPLOY: "1",
        BACKUPS: BACKUP_DIR,
        AUTH_KEYS: authKeys,
        APP_ORIGIN: BASE,
        NAS_HOST: "tokyo.example",
        NAS_PORT: "2222",
      },
    });
    const line = await until(() => server.out.text.match(/curl -fsSL \S+\/api\/nas\/setup-nas\.sh \| sudo sh -s -- (\S+) (\S+) (\S+) ([0-9a-f]{32})/), 60_000, "the NAS line");
    const [, origin, host, port, code] = line;
    assert.deepEqual([origin, host, port], [BASE, "tokyo.example", "2222"]);
    assert.match(fs.readFileSync(path.join(appDir, ".env"), "utf8"), /^NAS_REPORT_TOKEN=[0-9a-f]{64}$/m);

    // A wrong code is refused and leaves the pairing open.
    const wrong = await fetch(`${BASE}/api/backups/nas-pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "0".repeat(32), publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFnMhGI/VlSrQXGnW6zYQY8TuCtvg/GIz/SXbUJUaOse x" }),
    });
    assert.equal(wrong.status, 403);
    assert.equal((await fetch(`${BASE}/api/nas/backup-now.ts`)).status, 404, "only the two NAS scripts are served");

    // The fake ssh: what sshd does with the line the server script installed.
    const fakeSsh = path.join(tmp, "fake-ssh");
    fs.writeFileSync(
      fakeSsh,
      `#!/bin/sh
[ "$1" = "-l" ] && shift 2
shift
line="$(grep ' mbarete-nas-backup$' "${authKeys}")" || { echo "Permission denied (publickey)." >&2; exit 255; }
forced="$(printf '%s' "$line" | sed -n 's/^restrict,command="\\([^"]*\\)".*/\\1/p')"
SSH_ORIGINAL_COMMAND="$*" exec sh -c "$forced"
`,
    );
    fs.chmodSync(fakeSsh, 0o755);

    // The served script, exactly as the NAS downloads it.
    const served = await fetch(`${BASE}/api/nas/setup-nas.sh`);
    assert.equal(served.status, 200);
    const setupNas = path.join(tmp, "setup-nas.sh");
    fs.writeFileSync(setupNas, await served.text());
    const nasRun = start("sh", [setupNas, origin, host, port, code], {
      env: { ...process.env, DEST: nas, SSH_CMD: fakeSsh, NAS_NO_SCHEDULE: "1" },
    });
    const [serverExit, nasExit] = await Promise.all([server.done, nasRun.done]);
    assert.equal(serverExit, 0, server.out.text);
    assert.equal(nasExit, 0, nasRun.out.text);
    assert.match(nasRun.out.text, /All set\./);

    // The server let in exactly one key, read-only, and left the operator's alone.
    const keys = fs.readFileSync(authKeys, "utf8").trim().split("\n");
    assert.equal(keys[0], "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7operatorkey abel@laptop");
    assert.equal(keys.length, 2);
    assert.match(keys[1], new RegExp(`^restrict,command="\\S*rrsync -ro ${BACKUP_DIR}" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI\\S{43} mbarete-nas-backup$`));
    assert.ok(!fs.existsSync(path.join(BACKUP_DIR, ".nas-pair.json")), "the pairing is closed");
    // The code worked once.
    const again = await fetch(`${BASE}/api/backups/nas-pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, publicKey: keys[1].split(" ").slice(2, 4).join(" ") }),
    });
    assert.equal(again.status, 404);

    // The NAS got its token and settings, and its first copy arrives verified.
    const conf = fs.readFileSync(path.join(nas, "mbarete-nas-backup.conf"), "utf8");
    assert.match(conf, /^VPS=root@tokyo\.example$/m);
    assert.match(conf, /^VPS_PORT=2222$/m);
    assert.match(conf, /^REPORT_TOKEN=\S+$/m);
    await until(() => fs.existsSync(path.join(nas, "snapshots")) && fs.readdirSync(path.join(nas, "snapshots")).length > 0, 60_000, "the first copy");
    await until(() => /stored backup-/.test(fs.readFileSync(path.join(nas, "logs/nas-backup.log"), "utf8")), 60_000, "the first copy to verify");
    const report = await until(() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, "nas-report.json"), "utf8")).lastOk;
      } catch {
        return null;
      }
    }, 30_000, "the NAS's report");
    assert.match(report.snapshot, /^backup-\d{8}-\d{6}$/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
