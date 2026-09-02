import { count, countDistinct, desc, eq, gte, max, sql, sum, inArray } from "drizzle-orm";
import { db } from "@/db";
import { companies, users, products, orders, contacts, userActivityDays, invites, aiUsage, waitlistSignups } from "@/db/schema";
import { companyStorageBytes } from "@/lib/uploads";
import { utcDayStart } from "@/lib/ai-budget";

/**
 * Everything the operator panel shows, in one pass.
 *
 * Runs under platform scope (requirePlatformAdmin entered it before calling
 * here): the platform_read policies open SELECT across tenants on products,
 * orders, contacts and the activity ledger; companies, users and invites
 * have no RLS to begin with. All of it is COUNTS AND TIMESTAMPS — the panel
 * deliberately never reads an amount column, so what tenants earn stays
 * theirs even from the operator's chair.
 */

export type CompanyMetrics = {
  id: number;
  name: string;
  /** Lifecycle: pending approval, in service, or frozen (companies.status). */
  status: "pending" | "active" | "suspended";
  /** The owner's email — the queue's contact line and the panel's handle. */
  ownerEmail: string | null;
  plan: string;
  /** Seats bought beyond the plan's cap, granted from the panel. */
  extraSeats: number;
  createdAt: string;
  /** Who referred this company in, when anyone did. */
  referredByName: string | null;
  /** Companies that joined through this one's link. */
  referrals: number;
  moduleOrders: boolean;
  moduleFinance: boolean;
  users: number;
  products: number;
  suppliers: number;
  clients: number;
  ordersDraft: number;
  ordersConfirmed: number;
  ordersShipped: number;
  ordersCancelled: number;
  pendingInvites: number;
  daysActive: number;
  lastSeenAt: string | null;
  activeSeconds: number;
  storageBytes: number;
  /** The AI spend ledger, summed: scans run, photos read, token bill. */
  aiScans: number;
  aiImages: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  /** Scans since UTC midnight — against the daily allowance. */
  aiReadsToday: number;
  /** The panel's override of that allowance; null follows the plan. */
  aiReadsPerDay: number | null;
};

export type PlatformOverview = {
  companies: CompanyMetrics[];
  totals: {
    companies: number;
    usersTotal: number;
    activeLast7d: number;
    newLast30d: number;
    /** Companies that arrived through another company's link. */
    referred: number;
  };
};

export async function loadPlatformOverview(): Promise<PlatformOverview> {
  const [
    companyRows,
    userCounts,
    productCounts,
    contactCounts,
    orderCounts,
    inviteCounts,
    activityRows,
    aiRows,
    aiTodayRows,
  ] = await Promise.all([
    db.select().from(companies).orderBy(companies.id),
    db
      .select({ companyId: users.companyId, n: count() })
      .from(users)
      .where(eq(users.active, true))
      .groupBy(users.companyId),
    db
      .select({ companyId: products.companyId, n: count() })
      .from(products)
      .groupBy(products.companyId),
    db
      .select({ companyId: contacts.companyId, type: contacts.type, n: count() })
      .from(contacts)
      .groupBy(contacts.companyId, contacts.type),
    db
      .select({ companyId: orders.companyId, status: orders.status, n: count() })
      .from(orders)
      .groupBy(orders.companyId, orders.status),
    db
      .select({ companyId: invites.companyId, n: count() })
      .from(invites)
      .where(sql`${invites.usedAt} IS NULL AND ${invites.expiresAt} > to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`)
      .groupBy(invites.companyId),
    db
      .select({
        companyId: userActivityDays.companyId,
        days: countDistinct(userActivityDays.day),
        lastSeen: max(userActivityDays.lastSeenAt),
        seconds: sum(userActivityDays.activeSeconds),
      })
      .from(userActivityDays)
      .groupBy(userActivityDays.companyId),
    db
      .select({
        companyId: aiUsage.companyId,
        scans: count(),
        images: sum(aiUsage.images),
        input: sum(aiUsage.inputTokens),
        output: sum(aiUsage.outputTokens),
      })
      .from(aiUsage)
      .groupBy(aiUsage.companyId),
    db
      .select({ companyId: aiUsage.companyId, n: count() })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, utcDayStart()))
      .groupBy(aiUsage.companyId),
  ]);

  const byCompany = <T extends { companyId: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) {
      const list = m.get(r.companyId) ?? [];
      list.push(r);
      m.set(r.companyId, list);
    }
    return m;
  };
  const usersBy = byCompany(userCounts);
  const productsBy = byCompany(productCounts);
  const contactsBy = byCompany(contactCounts);
  const ordersBy = byCompany(orderCounts);
  const invitesBy = byCompany(inviteCounts);
  const activityBy = byCompany(activityRows);
  const aiBy = byCompany(aiRows);
  const aiTodayBy = byCompany(aiTodayRows);

  const storage = new Map<number, number>();
  await Promise.all(
    companyRows.map(async (c) => storage.set(c.id, await companyStorageBytes(c.id))),
  );

  const nameById = new Map(companyRows.map((c) => [c.id, c.name]));
  const ownerIds = companyRows.map((c) => c.ownerUserId).filter((v): v is number => v !== null);
  const ownerRows = ownerIds.length
    ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ownerIds))
    : [];
  const ownerEmailById = new Map(ownerRows.map((r) => [r.id, r.email]));
  const referralsBy = new Map<number, number>();
  for (const c of companyRows) {
    if (c.referredByCompanyId !== null) {
      referralsBy.set(
        c.referredByCompanyId,
        (referralsBy.get(c.referredByCompanyId) ?? 0) + 1,
      );
    }
  }

  const metrics: CompanyMetrics[] = companyRows.map((c) => {
    const contactRows = contactsBy.get(c.id) ?? [];
    const orderRows = ordersBy.get(c.id) ?? [];
    const activity = activityBy.get(c.id)?.[0];
    const ai = aiBy.get(c.id)?.[0];
    const status = (s: string) => orderRows.find((r) => r.status === s)?.n ?? 0;
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      ownerEmail: c.ownerUserId !== null ? ownerEmailById.get(c.ownerUserId) ?? null : null,
      plan: c.plan,
      extraSeats: c.extraSeats,
      createdAt: c.createdAt,
      referredByName:
        c.referredByCompanyId !== null ? nameById.get(c.referredByCompanyId) ?? null : null,
      referrals: referralsBy.get(c.id) ?? 0,
      moduleOrders: c.moduleOrders,
      moduleFinance: c.moduleFinance,
      users: usersBy.get(c.id)?.[0]?.n ?? 0,
      products: productsBy.get(c.id)?.[0]?.n ?? 0,
      suppliers: contactRows.find((r) => r.type === "supplier")?.n ?? 0,
      clients: contactRows.find((r) => r.type === "client")?.n ?? 0,
      ordersDraft: status("draft"),
      ordersConfirmed: status("confirmed"),
      ordersShipped: status("shipped"),
      ordersCancelled: status("cancelled"),
      pendingInvites: invitesBy.get(c.id)?.[0]?.n ?? 0,
      daysActive: activity?.days ?? 0,
      lastSeenAt: activity?.lastSeen ?? null,
      activeSeconds: Number(activity?.seconds ?? 0),
      storageBytes: storage.get(c.id) ?? 0,
      aiScans: ai?.scans ?? 0,
      aiImages: Number(ai?.images ?? 0),
      aiInputTokens: Number(ai?.input ?? 0),
      aiOutputTokens: Number(ai?.output ?? 0),
      aiReadsToday: aiTodayBy.get(c.id)?.[0]?.n ?? 0,
      aiReadsPerDay: c.aiReadsPerDay,
    };
  });

  const now = Date.now();
  const seenWithin = (m: CompanyMetrics, days: number) =>
    m.lastSeenAt !== null &&
    now - Date.parse(m.lastSeenAt.replace(" ", "T") + "Z") <= days * 86_400_000;

  return {
    companies: metrics,
    totals: {
      companies: metrics.length,
      usersTotal: metrics.reduce((n, m) => n + m.users, 0),
      referred: metrics.filter((m) => m.referredByName !== null).length,
      activeLast7d: metrics.filter((m) => seenWithin(m, 7)).length,
      newLast30d: metrics.filter(
        (m) => now - Date.parse(m.createdAt.replace(" ", "T") + "Z") <= 30 * 86_400_000,
      ).length,
    },
  };
}

export type WaitlistEntry = {
  id: number;
  name: string;
  companyName: string;
  email: string;
  preferredContact: string | null;
  locale: string;
  createdAt: string;
};

/**
 * The pre-launch waiting list, newest first — the landing page's output.
 * Platform data with no company_id and no RLS, so a plain select is the
 * whole story.
 */
export async function loadWaitlist(): Promise<WaitlistEntry[]> {
  return db.select().from(waitlistSignups).orderBy(desc(waitlistSignups.id));
}
