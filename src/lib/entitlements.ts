import { count, eq, and } from "drizzle-orm";
import { db, one } from "@/db";
import { companies, users, products } from "@/db/schema";
import { isSaas } from "@/lib/deploy";
import { planOf, hasRoomFor, type Plan } from "@/lib/plans";
import { companyStorageBytes } from "@/lib/uploads";

/**
 * Where plan limits actually bind.
 *
 * Every check answers "may this company add one more X" — asked at the write,
 * server-side, so the limit holds whatever the UI showed. On a self-hosted
 * install every answer is yes: the owner's own machine is never metered, and
 * the NAS deployment keeps behaving exactly as it always has.
 */

export async function companyPlan(companyId: number): Promise<Plan> {
  const row = await db
    .select({ plan: companies.plan })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
    .then(one);
  return planOf(row?.plan ?? "");
}

/** Room for one more active user (invites are checked at create AND accept). */
export async function canAddUser(companyId: number): Promise<boolean> {
  if (!isSaas()) return true;
  const plan = await companyPlan(companyId);
  if (plan.maxUsers === null) return true;
  const row = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.active, true)))
    .then((rows) => rows[0]);
  return hasRoomFor(plan.maxUsers, row?.n ?? 0);
}

/** Room for one more product in the catalog. */
export async function canAddProduct(companyId: number): Promise<boolean> {
  if (!isSaas()) return true;
  const plan = await companyPlan(companyId);
  if (plan.maxProducts === null) return true;
  const row = await db
    .select({ n: count() })
    .from(products)
    .where(eq(products.companyId, companyId))
    .then((rows) => rows[0]);
  return hasRoomFor(plan.maxProducts, row?.n ?? 0);
}

/**
 * Room for `incomingBytes` more of stored files. Reads the disk rather than
 * a counter: the disk is the truth, cannot drift, and one folder listing per
 * upload is cheap at catalog scale.
 */
export async function hasStorageFor(companyId: number, incomingBytes: number): Promise<boolean> {
  if (!isSaas()) return true;
  const plan = await companyPlan(companyId);
  if (plan.maxStorageBytes === null) return true;
  const used = await companyStorageBytes(companyId);
  return used + incomingBytes <= plan.maxStorageBytes;
}
