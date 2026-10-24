import { and, eq, sql } from "drizzle-orm";
import { db, one } from "@/db";
import { assistantKeys, users } from "@/db/schema";
import { enterTenant, runWithTenant } from "@/db/tenant-context";
import { enterAssistant, type AssistantIdentity } from "@/lib/assistant-context";
import { parseAssistantKey, parseScopes, secretMatches } from "@/lib/assistant-keys";
import { clientIp, makeLimiter } from "@/lib/rate-limit";

/**
 * The assistant API's front door: a bearer key in, an assistant identity out.
 *
 * Order matters. The key's shape is checked before any query; the account
 * (users is readable before a tenant exists) must be an active assistant;
 * its company is entered only to read the key row under RLS, and adopted
 * for the request only once the secret matched. Failed keys count per
 * address, so guessing is slow; a working key is still braked per account,
 * so a confused assistant in a loop cannot rewrite the board in a minute.
 */

const badKeys = makeLimiter({ max: 30, windowMs: 15 * 60 * 1000 });
const reads = makeLimiter({ max: 240, windowMs: 60 * 1000 });
const writes = makeLimiter({ max: 30, windowMs: 60 * 1000 });

export type AssistantGate =
  | { ok: true; identity: AssistantIdentity }
  | { ok: false; status: 401 | 429; error: string };

/** How often the "last used" stamp is rewritten; reads in between leave it be. */
const LAST_USED_EVERY_MS = 60 * 1000;

export async function authenticateAssistant(request: Request): Promise<AssistantGate> {
  const ip = await clientIp();
  if (badKeys.isLimited(ip)) return { ok: false, status: 429, error: "too-many-bad-keys" };
  const refuse = (): AssistantGate => {
    badKeys.hit(ip);
    return { ok: false, status: 401, error: "unauthorized" };
  };

  const presented = parseAssistantKey(request.headers.get("authorization"));
  if (!presented) return refuse();
  const account = await db
    .select({ id: users.id, companyId: users.companyId, name: users.name, active: users.active, kind: users.kind })
    .from(users)
    .where(eq(users.id, presented.userId))
    .limit(1)
    .then(one);
  if (!account || !account.active || account.kind !== "assistant") return refuse();

  const key = await runWithTenant(account.companyId, () =>
    db
      .select()
      .from(assistantKeys)
      .where(and(eq(assistantKeys.companyId, account.companyId), eq(assistantKeys.userId, account.id)))
      .limit(1)
      .then(one),
  );
  if (!key || !secretMatches(presented.secret, key.tokenHash)) return refuse();

  enterTenant(account.companyId);
  const identity: AssistantIdentity = {
    userId: account.id,
    companyId: account.companyId,
    name: account.name,
    scopes: parseScopes(key.scopes),
  };
  enterAssistant(identity);

  const lastUsed = key.lastUsedAt ? Date.parse(`${key.lastUsedAt.replace(" ", "T")}Z`) : 0;
  if (Date.now() - lastUsed > LAST_USED_EVERY_MS) {
    await db
      .update(assistantKeys)
      .set({ lastUsedAt: sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')` })
      .where(and(eq(assistantKeys.companyId, account.companyId), eq(assistantKeys.id, key.id)));
  }
  return { ok: true, identity };
}

/** True when this assistant is over its budget for the minute; writes have a tighter one. */
export function overBudget(identity: AssistantIdentity, write: boolean): boolean {
  const key = String(identity.userId);
  if (reads.hit(key)) return true;
  return write && writes.hit(key);
}
