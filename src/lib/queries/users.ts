import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * id -> display name for everyone who has ever had an account.
 *
 * Deactivated users are included on purpose: they still appear on the products
 * and orders they entered.
 */
export async function getUserNames() {
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .all();
  return new Map(rows.map((u) => [u.id, u.name]));
}
