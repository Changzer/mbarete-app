export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./src/db/migrate");
    const { seed } = await import("./src/db/seed");
    runMigrations();
    await seed();
  }
}
