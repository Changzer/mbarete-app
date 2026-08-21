import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * One shared pool for the whole process. Next.js can evaluate this module
 * more than once in dev (per compiled route graph), so the pool hangs off
 * globalThis to keep the connection count bounded.
 *
 * DATABASE_URL is the one knob: docker-compose points it at the bundled
 * postgres service; local dev defaults to a local server with the same
 * credentials the compose file creates.
 */
const connectionString =
  process.env.DATABASE_URL ?? "postgres://mbarete:mbarete@localhost:5432/mbarete";

const globalForDb = globalThis as unknown as { __mbaretePool?: Pool };

export const pool =
  globalForDb.__mbaretePool ??
  new Pool({
    connectionString,
    // The app is a handful of server processes at most; keep each modest so
    // the database's connection budget survives every one of them together.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });
globalForDb.__mbaretePool = pool;

export const db = drizzle(pool, { schema });

/**
 * First row or undefined — the successor of better-sqlite3's `.get()`.
 * Used as `await db.select()…limit(1).then(one)`.
 */
export const one = <T>(rows: T[]): T | undefined => rows[0];
