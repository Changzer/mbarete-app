/**
 * The disaster drill, runnable in CI: back up a live database and uploads,
 * damage both, prove the restore (a) refuses a corrupted backup before
 * touching anything, and (b) brings back exactly what was backed up.
 *
 *   BACKUP_DIR=/tmp/bk UPLOADS_DIR=/tmp/up DATABASE_ADMIN_URL=... \
 *     npx tsx scripts/test-backup-roundtrip.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg: string) {
  console.log(`OK: ${msg}`);
}

async function main() {
  const backupDir = process.env.BACKUP_DIR;
  const uploadsDir = process.env.UPLOADS_DIR;
  if (!backupDir || !uploadsDir) fail("set BACKUP_DIR and UPLOADS_DIR");
  await fs.mkdir(backupDir, { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });

  const url =
    process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? fail("set DATABASE_ADMIN_URL");
  const client = new Client({ connectionString: url });
  await client.connect();

  const marker = path.join(uploadsDir, "roundtrip-marker.txt");
  await fs.writeFile(marker, "original content");

  // ---- back up the world as it stands
  const { runBackup } = await import("../src/lib/backups");
  const result = await runBackup();
  if (!result.ok) fail(`backup failed: ${result.error}`);
  const backupPath = path.join(backupDir, result.name);
  ok(`backup ${result.name}: ${result.rows} rows, ${result.files} files`);

  // ---- damage everything the backup protects
  const before = await client
    .query("SELECT id, name_en FROM products ORDER BY id LIMIT 1")
    .then((r) => r.rows[0] as { id: number; name_en: string } | undefined);
  if (before) {
    await client.query("UPDATE products SET name_en='SABOTAGED' WHERE id=$1", [before.id]);
  }
  await client.query(
    "INSERT INTO contacts (company_id, type, company_name) SELECT id, 'client', 'GHOST ROW' FROM companies LIMIT 1",
  );
  await fs.writeFile(marker, "tampered content");

  const restoreEnv = { ...process.env, UPLOADS_DIR: uploadsDir };
  const restore = (dir: string) =>
    spawnSync("npx", ["tsx", "scripts/restore-backup.ts", dir], {
      env: restoreEnv,
      encoding: "utf8",
    });

  // ---- a corrupted backup must be refused BEFORE anything is truncated
  const corrupted = `${backupPath}-corrupted`;
  await fs.cp(backupPath, corrupted, { recursive: true });
  const dumps = await fs.readdir(path.join(corrupted, "db"));
  const victim = path.join(corrupted, "db", dumps[0]);
  const bytes = await fs.readFile(victim);
  bytes[bytes.length - 5] ^= 0xff;
  await fs.writeFile(victim, bytes);
  const refused = restore(corrupted);
  if (refused.status === 0) fail("a corrupted backup restored without complaint");
  const ghostStill = await client
    .query("SELECT count(*)::int AS n FROM contacts WHERE company_name='GHOST ROW'")
    .then((r) => r.rows[0].n as number);
  if (ghostStill !== 1) fail("refused restore still modified the database");
  ok("a corrupted backup is refused before live data is touched");
  await fs.rm(corrupted, { recursive: true, force: true });

  // ---- the intact backup restores the exact pre-damage state
  const good = restore(backupPath);
  if (good.status !== 0) fail(`restore failed:\n${good.stdout}\n${good.stderr}`);
  if (before) {
    const name = await client
      .query("SELECT name_en FROM products WHERE id=$1", [before.id])
      .then((r) => r.rows[0]?.name_en as string);
    if (name !== before.name_en) fail(`product name not restored: ${name}`);
  }
  const ghost = await client
    .query("SELECT count(*)::int AS n FROM contacts WHERE company_name='GHOST ROW'")
    .then((r) => r.rows[0].n as number);
  if (ghost !== 0) fail("ghost row survived the restore");
  const content = await fs.readFile(marker, "utf8");
  if (content !== "original content") fail(`upload not restored: "${content}"`);
  const kept = await fs.readFile(`${uploadsDir}.pre-restore/roundtrip-marker.txt`, "utf8");
  if (kept !== "tampered content") fail("pre-restore safety copy missing or wrong");
  ok("the intact backup restores rows and files to the backed-up state");

  await client.end();
  console.log("BACKUP ROUND-TRIP PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
