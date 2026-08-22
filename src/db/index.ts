import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { currentTenant } from "./tenant-context";

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

/** What each pooled connection currently has as its `app.company_id`. */
const appliedScope = new WeakMap<PoolClient, string>();

/**
 * A pool that stamps the current tenant (see tenant-context.ts) into the
 * connection as `app.company_id` on every checkout, so the database's RLS
 * policies see who is asking. Overriding connect() covers both paths drizzle
 * uses: pool.query() checks out through here, and so do transactions.
 *
 * Connections are reused across tenants, so the scope is re-applied whenever
 * it differs from what the connection last had — one cheap set_config round
 * trip on a tenant switch, none when consecutive requests share a tenant.
 * An empty scope means "no tenant": RLS then yields zero rows, never all.
 */
class TenantPool extends Pool {
  private async applyScope(client: PoolClient): Promise<void> {
    const tenant = currentTenant();
    const scope = tenant === undefined ? "" : String(tenant);
    if (appliedScope.get(client) === scope) return;
    await client.query("SELECT set_config('app.company_id', $1, false)", [scope]);
    appliedScope.set(client, scope);
  }

  override connect(): Promise<PoolClient>;
  override connect(
    callback: (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void,
  ): void;
  override connect(
    callback?: (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void,
  ): Promise<PoolClient> | void {
    if (callback) {
      // pg's own pool.query() checks out via this callback form.
      super.connect((err, client, done) => {
        if (err || !client) return callback(err as Error | undefined, client, done);
        this.applyScope(client).then(
          () => callback(undefined, client, done),
          (scopeErr) => {
            done(scopeErr);
            callback(scopeErr as Error, undefined, done);
          },
        );
      });
      return;
    }
    return super.connect().then(async (client) => {
      try {
        await this.applyScope(client);
        return client;
      } catch (scopeErr) {
        client.release(scopeErr as Error);
        throw scopeErr;
      }
    });
  }
}

const globalForDb = globalThis as unknown as { __mbaretePool?: Pool };

export const pool =
  globalForDb.__mbaretePool ??
  new TenantPool({
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
