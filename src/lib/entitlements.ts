import { count, eq, and, sql } from "drizzle-orm";
import { db, one } from "@/db";
import { companies, users, products } from "@/db/schema";
import { isSaas } from "@/lib/deploy";
import { planOf, hasRoomFor, seatLimit, type Plan } from "@/lib/plans";
import { companyStorageBytes } from "@/lib/uploads";

/** db and a drizzle transaction share the query surface these checks need. */
type Queryer = Pick<typeof db, "select" | "execute">;

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

async function seatRoom(q: Queryer, companyId: number): Promise<boolean> {
  const company = await q
    .select({ plan: companies.plan, extraSeats: companies.extraSeats })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
    .then(one);
  const limit = seatLimit(planOf(company?.plan ?? ""), company?.extraSeats ?? 0);
  if (limit === null) return true;
  const row = await q
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.active, true)))
    .then((rows) => rows[0]);
  return hasRoomFor(limit, row?.n ?? 0);
}

async function productRoom(q: Queryer, companyId: number): Promise<boolean> {
  const company = await q
    .select({ plan: companies.plan })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
    .then(one);
  const plan = planOf(company?.plan ?? "");
  if (plan.maxProducts === null) return true;
  const row = await q
    .select({ n: count() })
    .from(products)
    .where(eq(products.companyId, companyId))
    .then((rows) => rows[0]);
  return hasRoomFor(plan.maxProducts, row?.n ?? 0);
}

/** Room for one more active user (invites are checked at create AND accept). */
export async function canAddUser(companyId: number): Promise<boolean> {
  if (!isSaas()) return true;
  return seatRoom(db, companyId);
}

/** Room for one more product in the catalog. */
export async function canAddProduct(companyId: number): Promise<boolean> {
  if (!isSaas()) return true;
  return productRoom(db, companyId);
}

/**
 * The cap checks above answer honestly but cannot promise: two requests both
 * seeing 49/50 both insert. These two make the promise — they take the
 * company's row lock INSIDE the caller's transaction and re-count while
 * holding it, so entitlement decisions for one company serialize (and other
 * tenants feel nothing). The caller's insert must happen in the same
 * transaction, before it commits and releases the lock.
 */
export async function seatAvailableLocked(tx: Queryer, companyId: number): Promise<boolean> {
  if (!isSaas()) return true;
  await tx.execute(sql`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`);
  return seatRoom(tx, companyId);
}

export async function productSlotAvailableLocked(tx: Queryer, companyId: number): Promise<boolean> {
  if (!isSaas()) return true;
  await tx.execute(sql`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`);
  return productRoom(tx, companyId);
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
