import { AsyncLocalStorage } from "node:async_hooks";
import { requestStore } from "@/db/tenant-context";
import type { AssistantScope } from "@/lib/assistant-keys";

/**
 * Which assistant account the current request acts as — set ONLY by the
 * assistant API after its key checked out (assistant-auth.ts), read by
 * authz.ts so that requireUser() inside that request resolves to the
 * assistant instead of a cookie. Every other route never sets it, so a key
 * opens the assistant API and nothing else.
 *
 * Unlike the tenant, a real request carries it ONLY on the request's own
 * work-unit store (tenant-context.ts explains that store): never
 * AsyncLocalStorage.enterWith, whose context can outlive the request through
 * whatever async resource it touched — and an assistant identity surfacing
 * in someone else's request would outrank their cookie. Tests and scripts
 * use runAsAssistant(), which is scoped to the function it runs.
 */
export type AssistantIdentity = {
  userId: number;
  companyId: number;
  name: string;
  scopes: Set<AssistantScope>;
};

const g = globalThis as unknown as {
  __mbAssistantByRequest?: WeakMap<object, AssistantIdentity>;
  __mbAssistantStorage?: AsyncLocalStorage<AssistantIdentity>;
};
const byRequest = (g.__mbAssistantByRequest ??= new WeakMap<object, AssistantIdentity>());
const storage = (g.__mbAssistantStorage ??= new AsyncLocalStorage<AssistantIdentity>());

export function currentAssistant(): AssistantIdentity | undefined {
  const scoped = storage.getStore();
  if (scoped) return scoped;
  const request = requestStore();
  return request ? byRequest.get(request) : undefined;
}

/** For the rest of this request only. Outside a request there is nothing to attach to. */
export function enterAssistant(identity: AssistantIdentity): void {
  const request = requestStore();
  if (!request) throw new Error("enterAssistant() outside a request");
  byRequest.set(request, identity);
}

/** Tests and scripts: `fn` runs as the assistant, and nothing after it does. */
export function runAsAssistant<T>(identity: AssistantIdentity, fn: () => Promise<T>): Promise<T> {
  return storage.run(identity, async () => await fn());
}
