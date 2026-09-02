import { db } from "@/db";
import { users, invites } from "@/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { isoNow } from "@/lib/invites";

/**
 * id -> display name for everyone who has ever had an account.
 *
 * Deactivated users are included on purpose: they still appear on the products
 * and orders they entered.
 */
export async function getUserNames(companyId: number) {
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.companyId, companyId));
  return new Map(rows.map((u) => [u.id, u.name]));
}

/**
 * Pending (unused, unexpired) invites for one company — for the admin's
 * team page, which passes the SESSION's company. A query, not an action:
 * this used to be exported from a "use server" module, where it was a
 * callable endpoint that trusted whatever company id the caller sent, on a
 * table that sits outside row-level security.
 */
export async function pendingInvites(companyId: number) {
  return db
    .select({
      id: invites.id,
      role: invites.role,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
      createdByName: users.name,
    })
    .from(invites)
    .leftJoin(users, eq(invites.createdBy, users.id))
    .where(
      and(
        eq(invites.companyId, companyId),
        isNull(invites.usedAt),
        gt(invites.expiresAt, isoNow()),
      ),
    )
    .orderBy(invites.createdAt);
}
