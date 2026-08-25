/**
 * Restore a backup made by src/lib/backups.ts — database rows and uploads.
 *
 *   npx tsx scripts/restore-backup.ts /app/backups/backup-20260825-050000 [--force] [--skip-uploads]
 *
 * In the container:
 *   docker compose exec mbarete-app npx tsx scripts/restore-backup.ts <dir>
 *
 * DESTRUCTIVE: truncates every application table and replaces the rows with
 * the backup's. Run it against a stopped-or-quiet app, never mid-traffic.
 * The full runbook, including restoring onto a brand-new server, is
 * docs/BACKUPS.md.
 *
 * Safety rail: the manifest records how many migrations the schema had when
 * the backup was made; a mismatch with the live database aborts unless
 * --force. Migrate first (boot the app once), then restore.
 *
 * Uses the admin/superuser connection: session_replication_role = replica
 * turns foreign keys and triggers off so table order cannot matter, and RLS
 * does not bind the restore. Sequences are realigned afterwards, so new rows
 * continue from the restored ids.
 */
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import readline from "node:readline";
import { Client } from "pg";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const force = process.argv.includes("--force");
const skipUploads = process.argv.includes("--skip-uploads");
const backupPath = args[0];

function adminUrl(): string {
  return (
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgres://mbarete:mbarete@localhost:5432/mbarete"
  );
}

async function readJsonl(file: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const rl = readline.createInterface({
    input: createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

async function copyTree(src: string, dest: string): Promise<number> {
  let n = 0;
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) n += await copyTree(from, to);
    else if (entry.isFile()) {
      await fs.copyFile(from, to);
      n++;
    }
  }
  return n;
}

async function sha256(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** SHA-256 of the JSONL content INSIDE the gzip — what the dump hashed. */
async function sha256Jsonl(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const rl = readline.createInterface({
    input: createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) hash.update(line + "\n");
  }
  return hash.digest("hex");
}

/**
 * Everything the manifest can prove, proven BEFORE live data is touched:
 * each table dump's content hash, and every uploaded file's size and hash.
 * v1 manifests carry no hashes and skip with a notice — the row-count
 * verification during load still applies to them.
 */
async function verifyBackup(
  backupPath: string,
  manifest: {
    tableHashes?: Record<string, string>;
    fileRecords?: Record<string, { size: number; sha256: string }>;
  },
): Promise<void> {
  if (!manifest.tableHashes && !manifest.fileRecords) {
    console.log("[restore] v1 backup — no hashes to verify, relying on row counts");
    return;
  }
  for (const [table, expected] of Object.entries(manifest.tableHashes ?? {})) {
    const actual = await sha256Jsonl(path.join(backupPath, "db", `${table}.jsonl.gz`));
    if (actual !== expected) {
      throw new Error(`verification failed: ${table} dump hash mismatch — backup is damaged`);
    }
  }
  console.log(`[restore] verified ${Object.keys(manifest.tableHashes ?? {}).length} table dumps`);
  let checked = 0;
  for (const [rel, record] of Object.entries(manifest.fileRecords ?? {})) {
    const file = path.join(backupPath, "uploads", rel);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat || stat.size !== record.size || (await sha256(file)) !== record.sha256) {
      throw new Error(`verification failed: uploads/${rel} missing or damaged`);
    }
    checked += 1;
  }
  console.log(`[restore] verified ${checked} uploaded files`);
}

async function main() {
  if (!backupPath) {
    console.error("usage: tsx scripts/restore-backup.ts <backup-dir> [--force] [--skip-uploads]");
    process.exit(2);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(backupPath, "manifest.json"), "utf8"));
  const tables = Object.keys(manifest.tables as Record<string, number>);
  console.log(`[restore] ${backupPath} — made ${manifest.createdAt}, ${tables.length} tables`);

  // Prove the backup whole BEFORE anything live is touched — a damaged
  // backup must fail here, not halfway through a truncate.
  await verifyBackup(backupPath, manifest);

  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    const liveMigrations = await client
      .query('SELECT count(*)::int AS n FROM drizzle."__drizzle_migrations"')
      .then((r) => r.rows[0]?.n ?? 0)
      .catch(() => 0);
    if (liveMigrations !== manifest.migrations && !force) {
      console.error(
        `[restore] ABORT: backup is from migration ${manifest.migrations}, database is at ` +
          `${liveMigrations}. Boot the app once so migrations run, or pass --force.`,
      );
      process.exit(1);
    }

    await client.query("SET session_replication_role = replica");
    await client.query("BEGIN");

    const quoted = tables.map((t) => `"${t}"`).join(", ");
    await client.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);

    for (const table of tables) {
      const rows = await readJsonl(path.join(backupPath, "db", `${table}.jsonl.gz`));
      for (let i = 0; i < rows.length; i += 1000) {
        const batch = rows.slice(i, i + 1000);
        // jsonb_populate_recordset maps JSON keys onto the live row type —
        // one round trip per batch and the server does all type coercion.
        await client.query(
          `INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`,
          [JSON.stringify(batch)],
        );
      }
      if (rows.length !== manifest.tables[table]) {
        throw new Error(`${table}: loaded ${rows.length}, manifest says ${manifest.tables[table]}`);
      }
      console.log(`[restore] ${table}: ${rows.length} rows`);
    }

    // Serial sequences must resume past the restored ids.
    for (const table of tables) {
      const has = await client.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='id'",
        [table],
      );
      if (has.rowCount) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('"${table}"','id'), COALESCE(max(id),1), max(id) IS NOT NULL) FROM "${table}"`,
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }

  if (!skipUploads) {
    // Staged, then swapped: the backup's files land in a sibling directory
    // first, the current uploads move aside whole, and only then does the
    // staged copy take the live name. Files deleted before the backup was
    // made cannot linger as unexplained leftovers, and the previous state
    // survives as .pre-restore until the operator confirms and deletes it.
    const uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
    const staging = `${uploadsDir}.restore-tmp`;
    const keep = `${uploadsDir}.pre-restore`;
    await fs.rm(staging, { recursive: true, force: true });
    const n = await copyTree(path.join(backupPath, "uploads"), staging);
    await fs.rm(keep, { recursive: true, force: true });
    await fs.rename(uploadsDir, keep).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    });
    await fs.rename(staging, uploadsDir);
    console.log(`[restore] uploads: ${n} files into ${uploadsDir}`);
    console.log(`[restore] previous uploads kept at ${keep} — delete after a spot check`);
  }

  console.log("[restore] done");
}

main().catch((err) => {
  console.error("[restore] failed:", err);
  process.exit(1);
});
