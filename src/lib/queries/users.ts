import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

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
