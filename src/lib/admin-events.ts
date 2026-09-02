import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { adminEvents, users } from "@/db/schema";

/**
 * A company's own admin trail (admin_events): who changed which account,
 * how, when. The Users page shows the latest entries, so a password set
 * behind someone's back, or an email quietly rewritten, is visible to
 * every admin of the company rather than only to the one who did it.
 * Writes are awaited, not swallowed: an account change that cannot be
 * recorded fails rather than happening in silence.
 */

export type AdminAction =
  | "user-created"
  | "user-updated"
  | "password-set"
  | "email-changed"
  | "user-activated"
  | "user-deactivated"
  | "role-changed";

export async function recordAdminEvent(event: {
  companyId: number;
  actorUserId: number;
  action: AdminAction;
  targetUserId?: number | null;
  detail?: string;
}): Promise<void> {
  await db.insert(adminEvents).values({
    companyId: event.companyId,
    actorUserId: event.actorUserId,
    action: event.action,
    targetUserId: event.targetUserId ?? null,
    detail: (event.detail ?? "").slice(0, 300),
  });
}

export type AdminEventRow = {
  id: number;
  createdAt: string;
  action: string;
  detail: string;
  actorName: string | null;
  targetName: string | null;
};

/** The latest entries for one company, newest first. Runs under tenant scope. */
export async function recentAdminEvents(companyId: number, limit = 20): Promise<AdminEventRow[]> {
  const actor = alias(users, "actor");
  const target = alias(users, "target");
  return db
    .select({
      id: adminEvents.id,
      createdAt: adminEvents.createdAt,
      action: adminEvents.action,
      detail: adminEvents.detail,
      actorName: actor.name,
      targetName: target.name,
    })
    .from(adminEvents)
    .leftJoin(actor, eq(adminEvents.actorUserId, actor.id))
    .leftJoin(target, eq(adminEvents.targetUserId, target.id))
    .where(eq(adminEvents.companyId, companyId))
    .orderBy(desc(adminEvents.id))
    .limit(limit);
}
