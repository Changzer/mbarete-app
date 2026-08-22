import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import path from "node:path";

/**
 * Migrations run on their own connection, as the database's owner role —
 * DATABASE_ADMIN_URL when set, else DATABASE_URL. The app's shared pool is
 * deliberately not used: on a fresh install the app role may not exist until
 * ensureAppRole below creates it.
 */
function adminUrl(): string {
  return (
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL ??
    "postgres://mbarete:mbarete@localhost:5432/mbarete"
  );
}

/**
 * Row-level security binds every role except superusers and BYPASSRLS roles —
 * for those it is silently inert, which is the worst possible failure mode.
 * The docker image's POSTGRES_USER is the cluster's bootstrap superuser and
 * Postgres refuses to demote it, so instead a separate non-superuser
 * "<owner>_app" login (same password) is kept for the app to connect as;
 * docker-compose and CI point DATABASE_URL at it. A local role that is
 * already RLS-subject (the NAS-era single role, or any plain owner) needs
 * nothing and gets nothing.
 */
async function ensureAppRole(client: Client) {
  const posture = await client.query(
    "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
  );
  const { rolsuper, rolbypassrls } = posture.rows[0] as {
    rolsuper: boolean;
    rolbypassrls: boolean;
  };
  if (!rolsuper && !rolbypassrls) return;

  const url = new URL(adminUrl());
  const owner = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const appRole = `${owner}_app`;

  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole}') THEN
        CREATE ROLE "${appRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END $$;
  `);
  // Password re-synced every boot so rotating DB_PASSWORD rotates both roles.
  await client.query(
    `ALTER ROLE "${appRole}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password.replace(/'/g, "''")}'`,
  );
  const db = client.database ?? owner;
  await client.query(`GRANT CONNECT ON DATABASE "${db}" TO "${appRole}"`);
  await client.query(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}"`,
  );
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appRole}"`);
  // Tables created by future migrations inherit the same grants.
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}"`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${appRole}"`,
  );
  console.log(
    `[migrate] app role "${appRole}" ensured — point DATABASE_URL at it; ` +
      `the "${owner}" role stays for migrations and admin work`,
  );
}

export async function runMigrations() {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    const admin = drizzle(client);
    await migrate(admin, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    await ensureAppRole(client);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log("[migrate] done");
    })
    .catch((err) => {
      console.error("[migrate] failed:", err);
      process.exit(1);
    });
}
