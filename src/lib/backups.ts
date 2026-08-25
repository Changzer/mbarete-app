import fs from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";

/**
 * Automated backups: the whole install — every tenant's rows and every
 * uploaded file — snapshotted to BACKUP_DIR on a schedule, with retention.
 *
 * Shape: one directory per backup, not one archive. The database is dumped
 * as one gzipped JSON-lines file per table (the image deliberately has no
 * pg_dump — see docker/Dockerfile's no-apk stance — and JSONL round-trips
 * this schema losslessly: text timestamps, numerics, booleans, no bytea).
 * Uploads are mirrored file-by-file, and a file unchanged since the previous
 * backup is HARDLINKED to it instead of copied — years of photos cost one
 * copy plus each day's delta, the same trick rsync --link-dest plays.
 *
 * A backup directory is real only once manifest.json exists: it is written
 * last, and everything is staged under a .tmp- name and renamed into place,
 * so a crash mid-backup can never leave a plausible-looking partial.
 *
 * Restore is scripts/restore-backup.ts; the runbook is docs/BACKUPS.md.
 *
 * The dump runs as the ADMIN role on purpose: it is the operator's disaster
 * copy of everything, so it must see across tenants (the admin/superuser
 * role bypasses RLS) and it must include password hashes — a restore that
 * logs nobody in is not a restore. This is unlike the tenant-facing export
 * route, which omits hashes and other tenants by design. BACKUP_DIR must be
 * treated with the same care as the database itself.
 */

export const BACKUP_PREFIX = "backup-";
const TMP_PREFIX = ".tmp-";

export function backupDir(): string | null {
  const dir = process.env.BACKUP_DIR?.trim();
  return dir ? dir : null;
}

function retention(): number {
  const n = Number(process.env.BACKUP_RETENTION ?? 14);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 14;
}

function intervalMs(): number {
  const h = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
  return (Number.isFinite(h) && h > 0 ? h : 24) * 3_600_000;
}

function adminUrl(): string {
  return (
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgres://mbarete:mbarete@localhost:5432/mbarete"
  );
}

/** backup-YYYYMMDD-HHMMSS, UTC — lexical order is chronological order. */
export function backupName(now: Date): string {
  const s = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${BACKUP_PREFIX}${s}`;
}

export const BACKUP_NAME_RE = /^backup-\d{8}-\d{6}$/;

/**
 * Due when there is no backup yet, or the newest is older than the interval
 * less half an hour — the slack keeps a daily backup from drifting later
 * every day under an hourly check.
 */
export function isBackupDue(newestMs: number | null, nowMs: number, interval: number): boolean {
  if (newestMs === null) return true;
  return nowMs - newestMs >= interval - 1_800_000;
}

/** Which of these backup names to delete, keeping the newest `keep`. */
export function namesToPrune(names: string[], keep: number): string[] {
  return names
    .filter((n) => BACKUP_NAME_RE.test(n))
    .sort()
    .reverse()
    .slice(Math.max(1, keep));
}

/**
 * Unchanged means safe to hardlink to the previous backup's copy. Copies are
 * stamped with the source's mtime (see mirrorUploads); the sub-2ms tolerance
 * absorbs filesystems that round timestamps when setting them back.
 */
export function isUnchanged(
  prev: { size: number; mtimeMs: number } | null,
  src: { size: number; mtimeMs: number },
): boolean {
  return prev !== null && prev.size === src.size && Math.abs(prev.mtimeMs - src.mtimeMs) < 2;
}

export type BackupStatus = {
  configured: boolean;
  count: number;
  /** Completion time of the newest backup, ms epoch; null when none. */
  newestMs: number | null;
  running: boolean;
  lastError: string | null;
};

let running = false;
let lastError: string | null = null;

async function listBackups(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const out: string[] = [];
  for (const name of entries) {
    if (!BACKUP_NAME_RE.test(name)) continue;
    // Only completed backups count — the manifest is written last.
    const done = await fs
      .stat(path.join(dir, name, "manifest.json"))
      .then(() => true)
      .catch(() => false);
    if (done) out.push(name);
  }
  return out.sort();
}

export async function backupStatus(): Promise<BackupStatus> {
  const dir = backupDir();
  if (!dir) return { configured: false, count: 0, newestMs: null, running, lastError };
  const names = await listBackups(dir);
  const newest = names[names.length - 1];
  const newestMs = newest
    ? await fs
        .stat(path.join(dir, newest, "manifest.json"))
        .then((s) => s.mtimeMs)
        .catch(() => null)
    : null;
  return { configured: true, count: names.length, newestMs, running, lastError };
}

/** Every ordinary table in the public schema — the whole application. */
async function tableNames(client: Client): Promise<string[]> {
  const { rows } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return rows.map((r: { tablename: string }) => r.tablename);
}

/**
 * One table to gzipped JSONL, streamed through a server-side cursor: rows
 * arrive in batches and flow straight through gzip to disk, so memory stays
 * flat however large the activity history grows. The dump's SHA-256 rides
 * along into the manifest, so a restore can prove the file it is about to
 * load is byte-for-byte the file the backup wrote.
 */
async function dumpTable(
  client: Client,
  table: string,
  file: string,
): Promise<{ rows: number; sha256: string }> {
  const gzip = zlib.createGzip({ level: 6 });
  const out = createWriteStream(file);
  const done = pipeline(gzip, out);
  const hash = crypto.createHash("sha256");

  // Cursors only live inside a transaction — runBackup opened one, so this
  // rides the same REPEATABLE READ snapshot as every other table.
  let rows = 0;
  await client.query(`DECLARE backup_cur NO SCROLL CURSOR FOR SELECT * FROM "${table}" ORDER BY 1`);
  try {
    for (;;) {
      const batch = await client.query("FETCH 1000 FROM backup_cur");
      if (batch.rows.length === 0) break;
      for (const row of batch.rows) {
        const line = JSON.stringify(row) + "\n";
        hash.update(line);
        if (!gzip.write(line)) await new Promise((r) => gzip.once("drain", r));
      }
      rows += batch.rows.length;
    }
  } finally {
    await client.query("CLOSE backup_cur").catch(() => {});
  }
  gzip.end();
  await done;
  return { rows, sha256: hash.digest("hex") };
}

/** SHA-256 of a file on disk, streamed. */
async function fileSha256(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Copy while hashing — the bytes are in hand anyway, the hash is free. */
async function copyWithHash(from: string, to: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const out = createWriteStream(to);
  const src = createReadStream(from);
  src.on("data", (chunk) => hash.update(chunk as Buffer));
  await pipeline(src, out);
  return hash.digest("hex");
}

export type FileRecord = { size: number; sha256: string };

/**
 * Recursively mirror src into dest, hardlinking what prev already holds.
 *
 * Every file lands in `records` (path relative to the uploads root) with its
 * size and SHA-256 — computed during the copy for new files, inherited from
 * the previous backup's manifest for hardlinked ones (same inode, same
 * bytes; hashing years of photos nightly would defeat the hardlink trick).
 */
async function mirrorUploads(
  src: string,
  dest: string,
  prev: string | null,
  relBase: string,
  prevRecords: Record<string, FileRecord>,
  records: Record<string, FileRecord>,
): Promise<number> {
  let files = 0;
  const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    // The resize cache is derived data, regenerated on demand — dead weight
    // in a backup (same exclusion the tenant export makes).
    if (entry.name === ".variants") continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      files += await mirrorUploads(
        from,
        to,
        prev ? path.join(prev, entry.name) : null,
        rel,
        prevRecords,
        records,
      );
    } else if (entry.isFile()) {
      const stat = await fs.stat(from);
      const prevPath = prev ? path.join(prev, entry.name) : null;
      const prevStat = prevPath ? await fs.stat(prevPath).catch(() => null) : null;
      const inherited = prevRecords[rel];
      if (prevPath && isUnchanged(prevStat, stat) && inherited) {
        // A filesystem without hardlinks (some network mounts) falls back
        // to a plain copy — correct either way, just larger.
        await fs.link(prevPath, to).catch(() => fs.copyFile(from, to));
        records[rel] = inherited;
      } else {
        const sha256 = await copyWithHash(from, to);
        // The copy keeps the source's mtime so the NEXT run can recognize
        // the file as unchanged — without this, nothing ever hardlinks.
        const when = new Date(stat.mtimeMs);
        await fs.utimes(to, when, when).catch(() => {});
        records[rel] = { size: stat.size, sha256 };
      }
      files++;
    }
  }
  return files;
}

export type BackupResult =
  | { ok: true; name: string; tables: number; rows: number; files: number }
  | { ok: false; error: string };

/**
 * One full backup: dump every table, mirror uploads, write the manifest,
 * rename into place, prune beyond retention. Serialized — a run that finds
 * another in flight reports so instead of stacking.
 */
export async function runBackup(): Promise<BackupResult> {
  const dir = backupDir();
  if (!dir) return { ok: false, error: "BACKUP_DIR not set" };
  if (running) return { ok: false, error: "a backup is already running" };
  running = true;

  const name = backupName(new Date());
  const tmp = path.join(dir, TMP_PREFIX + name);
  const client = new Client({ connectionString: adminUrl() });
  try {
    // Names have one-second grain; a second run inside the same second could
    // only collide with the first, so it reports done instead of starting.
    const clash = await fs
      .stat(path.join(dir, name))
      .then(() => true)
      .catch(() => false);
    if (clash) return { ok: false, error: "a backup was made this very second" };
    await fs.mkdir(path.join(tmp, "db"), { recursive: true });
    await client.connect();

    // The dump must see everything. Under FORCEd row-level security a
    // non-bypassing role (the app's own DATABASE_URL role, if the admin URL
    // fell back to it) reads business tables as EMPTY — and a dump taken
    // that way looks complete, has a manifest, and restores to a data loss.
    // Refuse loudly instead of backing up blind; the panel shows the error.
    const seesAll = await client
      .query(
        "SELECT rolsuper OR rolbypassrls AS sees_all FROM pg_roles WHERE rolname = current_user",
      )
      .then((r) => Boolean(r.rows[0]?.sees_all));
    if (!seesAll) {
      throw new Error(
        "backup role cannot bypass row-level security — set DATABASE_ADMIN_URL to the admin role",
      );
    }

    // One snapshot for every table: rows written mid-backup land wholly in
    // the next backup instead of tearing this one (an order without its
    // items, a payment without its order).
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const tables = await tableNames(client);
    const counts: Record<string, number> = {};
    const tableHashes: Record<string, string> = {};
    for (const table of tables) {
      const dumped = await dumpTable(client, table, path.join(tmp, "db", `${table}.jsonl.gz`));
      counts[table] = dumped.rows;
      tableHashes[table] = dumped.sha256;
    }

    await client.query("COMMIT");

    // Migration state travels with the dump so restore can refuse a backup
    // from a different schema generation instead of loading it crooked.
    // Outside the snapshot on purpose: its .catch would poison an open
    // transaction on installs where the drizzle schema is absent.
    const mig = await client
      .query('SELECT count(*)::int AS n FROM drizzle."__drizzle_migrations"')
      .then((r) => r.rows[0]?.n ?? 0)
      .catch(() => 0);

    const { uploadsDir } = await import("@/lib/uploads");
    const backups = await listBackups(dir);
    const newest = backups[backups.length - 1];
    const prevUploads = newest ? path.join(dir, newest, "uploads") : null;
    // The previous manifest's per-file hashes carry over for every file the
    // mirror hardlinks — same inode, same bytes, no re-hash.
    const prevRecords: Record<string, FileRecord> = newest
      ? await fs
          .readFile(path.join(dir, newest, "manifest.json"), "utf8")
          .then((raw) => (JSON.parse(raw).fileRecords ?? {}) as Record<string, FileRecord>)
          .catch(() => ({}))
      : {};
    const fileRecords: Record<string, FileRecord> = {};
    await fs.mkdir(path.join(tmp, "uploads"), { recursive: true });
    const files = await mirrorUploads(
      uploadsDir(),
      path.join(tmp, "uploads"),
      prevUploads,
      "",
      prevRecords,
      fileRecords,
    );

    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    await fs.writeFile(
      path.join(tmp, "manifest.json"),
      JSON.stringify(
        {
          // v2 adds integrity: SHA-256 per table dump and per uploaded file.
          // Restore verifies everything against these BEFORE touching live
          // data; v1 backups restore as before, just without the proof.
          version: 2,
          createdAt: new Date().toISOString(),
          migrations: mig,
          tables: counts,
          tableHashes,
          fileRecords,
          files,
        },
        null,
        2,
      ),
    );
    await fs.rename(tmp, path.join(dir, name));

    for (const old of namesToPrune(await listBackups(dir), retention())) {
      await fs.rm(path.join(dir, old), { recursive: true, force: true });
    }
    // Leftover staging from a crashed earlier run, no longer of interest.
    for (const entry of await fs.readdir(dir).catch(() => [] as string[])) {
      if (entry.startsWith(TMP_PREFIX) && entry !== path.basename(tmp)) {
        await fs.rm(path.join(dir, entry), { recursive: true, force: true });
      }
    }

    lastError = null;
    console.log(`[backups] ${name}: ${tables.length} tables, ${rows} rows, ${files} files`);
    return { ok: true, name, tables: tables.length, rows, files };
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error(`[backups] failed: ${lastError}`);
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: lastError };
  } finally {
    running = false;
    await client.end().catch(() => {});
  }
}

const STARTED = Symbol.for("mbarete.backups.scheduler");

/**
 * Backs up when due, checked hourly — dead simple and reboot-proof: the
 * newest backup on disk is the schedule state, so a NAS that restarts every
 * night still backs up once a day. Guarded so hot reloads do not stack
 * intervals; a failure costs nothing but is kept for the panel to show.
 */
export function startBackupScheduler() {
  const g = globalThis as Record<symbol, unknown>;
  if (g[STARTED]) return;
  g[STARTED] = true;

  const dir = backupDir();
  if (!dir) {
    console.log("[backups] BACKUP_DIR not set — automated backups off");
    return;
  }

  const tick = async () => {
    const status = await backupStatus();
    if (!status.running && isBackupDue(status.newestMs, Date.now(), intervalMs())) {
      await runBackup();
    }
  };

  // First check ninety seconds after boot: past the migration/seed window,
  // ahead of "the NAS reboots nightly and the interval never fires".
  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), 3_600_000);
}
