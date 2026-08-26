import { db } from "@/db";
import { periodCloses } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

/**
 * The recent period closes as a key → closedAt map, for the finance page's
 * pack card to show "closed on ..." next to whichever period is selected.
 * Keys are 'YYYY-MM' or 'YYYY-MM~YYYY-MM', same as periodKey().
 */
export async function listPeriodCloses(companyId: number): Promise<Record<string, string>> {
  const rows = await db
    .select({ period: periodCloses.period, closedAt: periodCloses.closedAt })
    .from(periodCloses)
    .where(eq(periodCloses.companyId, companyId))
    .orderBy(desc(periodCloses.closedAt))
    .limit(36);
  return Object.fromEntries(rows.map((r) => [r.period, r.closedAt]));
}
