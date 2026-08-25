export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations, migrationGap } = await import("./src/db/migrate");
    const { seed } = await import("./src/db/seed");

    // A migration only ever runs against freshly backed-up data: the
    // auto-updater cannot roll a schema back, so the snapshot taken here is
    // the undo button. A fresh install (nothing applied yet) has nothing to
    // protect; with backups unconfigured the behavior stays as it was.
    const { backupDir, runBackup } = await import("./src/lib/backups");
    if (backupDir()) {
      const gap = await migrationGap();
      if (gap.applied > 0 && gap.pending > 0) {
        console.log(`[boot] ${gap.pending} migration(s) pending — backing up first`);
        const result = await runBackup();
        if (!result.ok && result.error !== "a backup was made this very second") {
          // Booting on would migrate unprotected data; failing loudly keeps
          // the OLD deployment's last state restorable while the operator
          // fixes whatever broke the backup (disk full, wrong admin URL).
          throw new Error(`refusing to migrate without a fresh backup: ${result.error}`);
        }
      }
    }

    // Seed queries the migrated schema, and requests must not reach an app
    // whose database is still changing in the background.
    await runMigrations();
    await seed();

    // Exchange rates refresh themselves from here on; see src/lib/forex.ts.
    const { startForexAutoRefresh } = await import("./src/lib/forex");
    startForexAutoRefresh();

    // Daily snapshots of the database and uploads; see src/lib/backups.ts.
    const { startBackupScheduler } = await import("./src/lib/backups");
    startBackupScheduler();
  }
}
