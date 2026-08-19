export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./src/db/migrate");
    const { seed } = await import("./src/db/seed");
    runMigrations();
    await seed();

    // Exchange rates refresh themselves from here on; see src/lib/forex.ts.
    const { startForexAutoRefresh } = await import("./src/lib/forex");
    startForexAutoRefresh();
  }
}
