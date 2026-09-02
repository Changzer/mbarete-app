import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformEvents, users, companies } from "@/db/schema";

/**
 * The operator's audit trail.
 *
 * Every cross-tenant write from the panel, and every reset link minted
 * there, leaves a row: who, what, to which company or user, when. The panel
 * is a support tool with real reach into every tenant — support access that
 * nobody can see afterwards is not something a company should have to take
 * on trust. Writes are awaited and not swallowed: an action whose record
 * cannot be written fails visibly rather than happening unrecorded.
 */

export type PlatformAction =
  | "module"
  | "plan"
  | "seats"
  | "ai-budget"
  | "approve"
  | "suspend"
  | "unsuspend"
  | "reset-link"
  | "backup"
  | "test-email";

export async function recordPlatformEvent(event: {
  operatorUserId: number;
  action: PlatformAction;
  targetCompanyId?: number | null;
  targetUserId?: number | null;
  detail?: string;
}): Promise<void> {
  await db.insert(platformEvents).values({
    operatorUserId: event.operatorUserId,
    action: event.action,
    targetCompanyId: event.targetCompanyId ?? null,
    targetUserId: event.targetUserId ?? null,
    detail: (event.detail ?? "").slice(0, 500),
  });
}

export type PlatformEventRow = {
  id: number;
  createdAt: string;
  action: string;
  detail: string;
  operatorUserId: number;
  operatorEmail: string | null;
  targetCompanyId: number | null;
  companyName: string | null;
};

/** The latest entries, newest first, for the panel. */
export async function recentPlatformEvents(limit = 20): Promise<PlatformEventRow[]> {
  const rows = await db
    .select({
      id: platformEvents.id,
      createdAt: platformEvents.createdAt,
      action: platformEvents.action,
      detail: platformEvents.detail,
      operatorUserId: platformEvents.operatorUserId,
      operatorEmail: users.email,
      targetCompanyId: platformEvents.targetCompanyId,
      companyName: companies.name,
    })
    .from(platformEvents)
    .leftJoin(users, eq(platformEvents.operatorUserId, users.id))
    .leftJoin(companies, eq(platformEvents.targetCompanyId, companies.id))
    .orderBy(desc(platformEvents.id))
    .limit(limit);
  return rows;
}
