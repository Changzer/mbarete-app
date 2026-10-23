import { and, eq, sql } from "drizzle-orm";
import { db, one } from "@/db";
import { followupChecklistItems, users } from "@/db/schema";
import type { SessionUser } from "@/lib/authz";
import { utcStampToIso } from "@/lib/followup";
import { getFollowupBoard, type FollowupUser } from "@/lib/followup-server";
import { collectTasks, type MyTask, type TaskCardInput } from "@/lib/tasks";
import type { Locale } from "@/i18n/routing";

export type MyTasks = {
  tasks: MyTask[];
  users: FollowupUser[];
  /** The server's clock when the list was read: opening the bell marks up to here as seen. */
  asOf: string;
};

/** Everything waiting on this person on the follow-up board. */
export async function getMyTasks(user: SessionUser, locale: Locale): Promise<MyTasks> {
  const [board, items, me] = await Promise.all([
    getFollowupBoard(user.companyId, locale),
    db
      .select({
        id: followupChecklistItems.id,
        cardId: followupChecklistItems.cardId,
        text: followupChecklistItems.text,
        assignedBy: followupChecklistItems.assignedBy,
        assignedAt: followupChecklistItems.assignedAt,
      })
      .from(followupChecklistItems)
      .where(and(
        eq(followupChecklistItems.companyId, user.companyId),
        eq(followupChecklistItems.ownerId, user.id),
        eq(followupChecklistItems.done, false),
      ))
      .orderBy(followupChecklistItems.cardId, followupChecklistItems.position, followupChecklistItems.id),
    db
      .select({
        seenAt: users.tasksSeenAt,
        now: sql<string>`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`,
      })
      .from(users)
      .where(and(eq(users.companyId, user.companyId), eq(users.id, user.id)))
      .limit(1)
      .then(one),
  ]);
  const cards: TaskCardInput[] = [
    ...board.cards.map((c) => ({
      ...c,
      productName: c.mainProductName,
    })),
    ...board.shipments.map((s) => ({
      ...s,
      supplierName: "",
      supplierNameAlt: "",
      productName: s.productNames[0] ?? "",
      otherLines: Math.max(0, s.productNames.length - 1),
    })),
  ];
  const tasks = collectTasks(
    cards,
    items.map((i) => ({ ...i, assignedAt: i.assignedAt ? utcStampToIso(i.assignedAt) : null })),
    user.id,
    me?.seenAt ? utcStampToIso(me.seenAt) : null,
  );
  return { tasks, users: board.users, asOf: utcStampToIso(me?.now ?? "") };
}

const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})Z$/;

/**
 * Opening the bell: what was on the list the person saw is no longer new.
 * Only ever moves forward, and never past the database's clock, so a stale
 * or forged instant cannot hide tomorrow's assignments.
 *
 * Seen up to the second BEFORE the list was read: stamps are whole seconds,
 * and a step handed over later in that same second was not on the list, so
 * it must still ring. One from that second that was on the list shows as new
 * once more — twice beats never.
 */
export async function markTasksSeen(user: SessionUser, upTo: string): Promise<boolean> {
  const match = ISO_INSTANT.exec(upTo);
  if (!match) return false;
  const stamp = `${match[1]} ${match[2]}`;
  await db
    .update(users)
    .set({
      tasksSeenAt: sql`GREATEST(
        COALESCE(${users.tasksSeenAt}, ''),
        to_char(
          LEAST(${stamp}::timestamp, date_trunc('second', now() AT TIME ZONE 'utc')) - interval '1 second',
          'YYYY-MM-DD HH24:MI:SS'
        )
      )`,
    })
    .where(and(eq(users.companyId, user.companyId), eq(users.id, user.id)));
  return true;
}
