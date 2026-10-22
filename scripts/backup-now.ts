/**
 * One backup, now, from the command line — what the panel's "Back up now"
 * does. Used by scripts/nas/setup-server.sh so the NAS has a fresh backup
 * (with SHA256SUMS) to take on its first run:
 *
 *   docker compose exec -T mbarete-app npx tsx scripts/backup-now.ts
 */
async function main() {
  const { runBackup } = await import("../src/lib/backups");
  const result = await runBackup();
  if (!result.ok) {
    console.error(`backup failed: ${result.error}`);
    process.exit(1);
  }
  console.log(`backup ${result.name}: ${result.tables} tables, ${result.rows} rows, ${result.files} files`);
  process.exit(0);
}

void main();
