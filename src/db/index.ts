import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

const dbDir = process.env.DATABASE_DIR ?? path.join(process.cwd(), "data");
fs.mkdirSync(/* turbopackIgnore: true */ dbDir, { recursive: true });
const dbPath = path.join(dbDir, "mbarete.db");

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { sqlite };
