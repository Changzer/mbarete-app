import { sql } from "drizzle-orm";
import { db } from "@/db";
import { userActivityDays } from "@/db/schema";

/**
 * The platform's pulse: who touched the app, when, and for roughly how long.
 *
 * Every authenticated request lands here via sessionUser(), but the database
 * sees at most one upsert per user per minute — an in-memory throttle absorbs
 * the rest. Recording is fire-and-forget: a metrics write must never slow
 * down or fail the request it is riding on.
 */

/** Gaps between touches longer than this are "away", not one sitting. */
export const SESSION_GAP_MS = 5 * 60_000;
/** How often, at most, one user costs the database a write. */
export const RECORD_INTERVAL_MS = 60_000;

/**
 * Seconds of active use to credit for a touch at `nowMs`, given the previous
 * touch. The sum of these gaps is the session time the panel reports: short
 * gaps are one sitting and count in full, a long gap means the user was away
 * — the sitting ended at the previous touch, so the gap credits nothing.
 * First touch of a day starts the clock and credits nothing by itself.
 */
export function activityCredit(prevMs: number | null, nowMs: number): number {
  if (prevMs === null) return 0;
  const gap = nowMs - prevMs;
  if (gap <= 0 || gap > SESSION_GAP_MS) return 0;
  return Math.round(gap / 1000);
}

/** UTC day bucket for a timestamp, YYYY-MM-DD. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Last time each user's activity actually reached the database. Off
// globalThis like the pool and tenant carriers: Next evaluates modules once
// per compiled graph, and per-graph maps would multiply the write rate.
const g = globalThis as unknown as { __mbActivityLast?: Map<number, number> };
const lastRecorded = (g.__mbActivityLast ??= new Map<number, number>());

/**
 * Notes that `userId` of `companyId` is active right now. Cheap to call on
 * every request; writes at most once per RECORD_INTERVAL_MS per user.
 */
export function touchActivity(companyId: number, userId: number, nowMs = Date.now()): void {
  const prev = lastRecorded.get(userId) ?? null;
  if (prev !== null && nowMs - prev < RECORD_INTERVAL_MS) return;
  lastRecorded.set(userId, nowMs);

  const day = utcDay(nowMs);
  const at = new Date(nowMs).toISOString().slice(0, 19).replace("T", " ");
  const credit = activityCredit(prev, nowMs);

  // Crossing midnight: the credit belongs to the day the touch lands in;
  // splitting seconds across the boundary buys precision nobody reads.
  void db
    .insert(userActivityDays)
    .values({
      companyId,
      userId,
      day,
      firstSeenAt: at,
      lastSeenAt: at,
      activeSeconds: credit,
    })
    .onConflictDoUpdate({
      target: [userActivityDays.userId, userActivityDays.day],
      set: {
        lastSeenAt: at,
        activeSeconds: sql`${userActivityDays.activeSeconds} + ${credit}`,
      },
    })
    .catch((err) => {
      // A lost data point, not a lost request. Roll the throttle back so the
      // next request retries rather than waiting out the interval.
      lastRecorded.delete(userId);
      console.error("[activity] write failed:", err instanceof Error ? err.message : err);
    });
}
