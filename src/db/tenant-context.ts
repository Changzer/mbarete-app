import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which company the current async execution is acting for.
 *
 * This is the app half of row-level security: the pool stamps this value into
 * the connection as `app.company_id` before every checkout, and the database's
 * RLS policies refuse rows whose company_id differs. No context set means no
 * rows at all — RLS fails closed, so a code path that forgot its tenant reads
 * nothing rather than everything.
 *
 * `users` and `companies` are exempt from RLS (see the migration): they are
 * the tables the tenant is *derived from* — login by email and session lookup
 * happen before any context can exist.
 */
const storage = new AsyncLocalStorage<number>();

/** The company id the current request is acting for, if any. */
export function currentTenant(): number | undefined {
  return storage.getStore();
}

/**
 * Adopts the tenant for the remainder of the current async flow. Called by
 * sessionUser() the moment the signed-in user's company is known, so every
 * query a request makes after authentication carries its tenant.
 */
export function enterTenant(companyId: number): void {
  storage.enterWith(companyId);
}

/**
 * Runs a task as one tenant — for work that happens outside a signed-in
 * request: the boot seed, the forex refresh loop, one-off scripts.
 */
export function runWithTenant<T>(companyId: number, fn: () => Promise<T>): Promise<T> {
  // The promise must be RESOLVED inside the context, not just created there:
  // drizzle queries execute lazily on .then(), so handing the bare thenable
  // back would run the query in the caller's context instead of this one.
  return storage.run(companyId, async () => await fn());
}
