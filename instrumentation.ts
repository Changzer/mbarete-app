export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./src/db/migrate");
    const { seed } = await import("./src/db/seed");
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
