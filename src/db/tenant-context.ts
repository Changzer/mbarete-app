import { AsyncLocalStorage } from "node:async_hooks";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

/**
 * Which company the current async execution is acting for.
 *
 * This is the app half of row-level security: the pool captures this value at
 * each query call and stamps it into the connection as `app.company_id`; the
 * database's RLS policies refuse rows whose company_id differs. No context
 * set means no rows at all — RLS fails closed, so a code path that forgot its
 * tenant reads nothing rather than everything.
 *
 * TWO carriers, because one cannot cover both worlds:
 *
 * - Next's work-unit store carries the tenant across a whole request —
 *   pages, layouts and server actions alike. This is the same storage that
 *   makes headers() and auth() work anywhere in a request, and it is the
 *   only thing that demonstrably survives Next's scheduling: our own
 *   AsyncLocalStorage.enterWith() inside awaited helpers did NOT reach the
 *   caller's later queries under Next (RSC or actions — empirically both
 *   lost it), which shipped as empty reads and 42501 writes. The tenant is
 *   attached to the store OBJECT via WeakMap, so nothing of Next's is
 *   mutated and a dropped request cleans itself up.
 * - AsyncLocalStorage carries it through `runWithTenant()` for everything
 *   with no request: the boot seed, the forex refresh loop, scripts, tests.
 *
 * Both carriers hang off globalThis for the same reason the pg pool does:
 * Next evaluates app modules once per compiled graph, and a second instance
 * would mean sessionUser() writing the tenant into one graph's store while
 * the pool captures from another.
 *
 * `users` and `companies` are exempt from RLS (see the migration): they are
 * the tables the tenant is *derived from* — login by email and session lookup
 * happen before any context can exist.
 */
const g = globalThis as unknown as {
  __mbTenantStorage?: AsyncLocalStorage<number>;
  __mbTenantByRequest?: WeakMap<object, number>;
};

const storage = (g.__mbTenantStorage ??= new AsyncLocalStorage<number>());
const byRequest = (g.__mbTenantByRequest ??= new WeakMap<object, number>());

function requestStore(): object | undefined {
  try {
    return workUnitAsyncStorage.getStore();
  } catch {
    // Outside Next entirely (scripts, tests) — the ALS carrier covers.
    return undefined;
  }
}

/** The company id the current execution is acting for, if any. */
export function currentTenant(): number | undefined {
  const scoped = storage.getStore();
  if (scoped !== undefined) return scoped;
  const request = requestStore();
  return request ? byRequest.get(request) : undefined;
}

/**
 * Adopts the tenant for the remainder of the current request. Called by
 * sessionUser() the moment the signed-in user's company is known, so every
 * query the request makes after authentication carries its tenant.
 */
export function enterTenant(companyId: number): void {
  const request = requestStore();
  if (request) byRequest.set(request, companyId);
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
