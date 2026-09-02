import { and, count, eq, gte } from "drizzle-orm";
import { db, one } from "@/db";
import { aiUsage, companies } from "@/db/schema";
import { isSaas } from "@/lib/deploy";
import { planOf } from "@/lib/plans";
import { makeLimiter } from "@/lib/rate-limit";

/**
 * The AI spend brakes, in ONE place for every path that reaches a vision
 * model: the live "fill from photos" actions and the background read of an
 * offline capture. Every scan is a paid request, and the two paths used to
 * brake separately — the draft route's own limiter let one account through
 * at six times the direct rate. Now a scan is a scan whichever door it
 * came in by.
 *
 * Two brakes, both answered by reserveAiRead():
 * - Per user, per hour: a burst brake. In memory, like every limiter here.
 * - Per company, per UTC day: the plan's allowance, counted from the spend
 *   ledger itself (ai_usage), so it survives restarts and is the same
 *   number the panel shows. The plan's figure binds only on SaaS — a
 *   self-hosted install pays its own API bill and is never metered — but
 *   the panel can override it per company (companies.ai_reads_per_day),
 *   and an override binds wherever it is set: 0 switches AI reading off.
 */

export const AI_PER_USER_PER_HOUR = 120;

const perUser = makeLimiter({ max: AI_PER_USER_PER_HOUR, windowMs: 60 * 60 * 1000 });

export type AiReadDecision = "ok" | "user-limit" | "company-budget";

/**
 * The decision, given what the counters say. Pure, tested without a
 * database. A null daily limit is "unlimited"; zero refuses every read.
 */
export function decideAiRead(input: {
  userOverLimit: boolean;
  dailyLimit: number | null;
  usedToday: number;
}): AiReadDecision {
  if (input.userOverLimit) return "user-limit";
  if (input.dailyLimit !== null && input.usedToday >= input.dailyLimit) {
    return "company-budget";
  }
  return "ok";
}

/**
 * The daily cap that binds for a company: the panel's override when one is
 * set, else the plan's allowance on SaaS, else nothing.
 */
export async function companyAiDailyLimit(companyId: number): Promise<number | null> {
  const row = await db
    .select({ plan: companies.plan, override: companies.aiReadsPerDay })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
    .then(one);
  if (row?.override !== null && row?.override !== undefined) return row.override;
  return isSaas() ? planOf(row?.plan ?? "").maxAiReadsPerDay : null;
}

/** "YYYY-MM-DD 00:00:00" in UTC — the ledger's created_at format, at midnight. */
export function utcDayStart(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 10)} 00:00:00`;
}

/** Scans this company has run since UTC midnight, from the ledger. */
export async function companyAiReadsToday(companyId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(aiUsage)
    .where(and(eq(aiUsage.companyId, companyId), gte(aiUsage.createdAt, utcDayStart())));
  return row?.n ?? 0;
}

/**
 * Asks for one scan. "ok" spends one unit of the user's hourly brake; a
 * refusal names which brake said no, so the UI can say "later" versus
 * "tomorrow". A background read with no user (an offline capture whose
 * uploader is unknown) is judged on the company budget alone.
 */
export async function reserveAiRead(input: {
  companyId: number;
  userId: number | null;
}): Promise<AiReadDecision> {
  const userOverLimit = input.userId !== null && perUser.hit(`u${input.userId}`);
  const dailyLimit = await companyAiDailyLimit(input.companyId);
  const usedToday = dailyLimit !== null ? await companyAiReadsToday(input.companyId) : 0;
  return decideAiRead({ userOverLimit, dailyLimit, usedToday });
}
