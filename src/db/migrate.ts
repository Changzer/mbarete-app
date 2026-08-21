import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { db, pool } from "./index";

export async function runMigrations() {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

if (require.main === module) {
  runMigrations()
    .then(async () => {
      console.log("[migrate] done");
      await pool.end();
    })
    .catch(async (err) => {
      console.error("[migrate] failed:", err);
      await pool.end();
      process.exit(1);
    });
}
