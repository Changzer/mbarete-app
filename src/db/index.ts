import { Pool, type PoolClient, type QueryResult } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { currentTenant, currentPlatform } from "./tenant-context";

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
 * connection as `app.company_id`, so the database's RLS policies see who is
 * asking.
 *
 * The tenant is captured SYNCHRONOUSLY at the query()/connect() call —
 * still inside the caller's async flow, where the request context is alive —
 * and carried to the checked-out client by closure. It must never be read
 * inside the checkout callback: pg fires those from socket/pool events,
 * outside the caller's async context, which reads as "no tenant" and turns
 * every request into empty reads and 42501 writes.
 *
 * Connections are reused across tenants, so the scope is re-applied only
 * when it differs from what the connection last had — one cheap set_config
 * round trip on a tenant switch, none when consecutive queries share one.
 * An empty scope means "no tenant": RLS then yields zero rows, never all.
 */
class TenantPool extends Pool {
  private async scopeClient(client: PoolClient, scope: string): Promise<void> {
    if (appliedScope.get(client) === scope) return;
    // scope is "<tenant>|<platform>"; both settings travel together so a
    // connection can never keep one half of a previous caller's identity.
    const [tenant, platform] = scope.split("|");
    await client.query(
      "SELECT set_config('app.company_id', $1, false), set_config('app.platform', $2, false)",
      [tenant, platform],
    );
    appliedScope.set(client, scope);
  }

  private capturedScope(): string {
    const tenant = currentTenant();
    if (process.env.RLS_DEBUG) console.log("[dbg] captured:", tenant, new Error().stack?.split("\n")[3]?.trim());
    const tenantPart = tenant === undefined ? "" : String(tenant);
    const platformPart = currentPlatform() ? "1" : "";
    return `${tenantPart}|${platformPart}`;
  }

  // Implemented on top of connect() rather than delegating to pg's own
  // pool.query, so the captured scope is applied on the very client that
  // runs the statement.
  // pg's Pool.query has a tower of generic overloads; this implementation is
  // signature-compatible at runtime (text/config/values/callback all pass
  // through to client.query) but typing the tower again buys nothing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override query(...args: any[]): any {
    const scope = this.capturedScope();
    const callback =
      typeof args[args.length - 1] === "function"
        ? (args.pop() as (err: Error | null, result?: QueryResult) => void)
        : undefined;

    const run = async (): Promise<QueryResult> => {
      const client = await super.connect();
      try {
        await this.scopeClient(client, scope);
        return await (client.query as (...a: unknown[]) => Promise<QueryResult>)(...args);
      } finally {
        client.release();
      }
    };

    if (callback) {
      run().then(
        (result) => callback(null, result),
        (error) => callback(error as Error),
      );
      return;
    }
    return run();
  }

  override connect(): Promise<PoolClient>;
  override connect(
    callback: (
      err: Error | undefined,
      client: PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ): void;
  override connect(
    callback?: (
      err: Error | undefined,
      client: PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ): Promise<PoolClient> | void {
    const scope = this.capturedScope();
    if (callback) {
      super.connect((err, client, done) => {
        if (err || !client) return callback(err as Error | undefined, client, done);
        this.scopeClient(client, scope).then(
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
        await this.scopeClient(client, scope);
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
