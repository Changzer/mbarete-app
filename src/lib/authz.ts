import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db, one } from "@/db";
import { users, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { enterTenant, enterPlatform } from "@/db/tenant-context";
import { touchActivity } from "@/lib/activity";

export type Role = "admin" | "collaborator";

export type SessionUser = {
  id: number;
  companyId: number;
  role: Role;
  name: string;
  email: string;
};

/**
 * The one place a cookie becomes a database identity. Every gate — tenant
 * pages and the platform panel alike — validates through here, so a rule
 * added once (deactivation, password rotation) binds them all; the tenant
 * and platform paths cannot drift apart again.
 *
 * Checks, in order: a valid JWT naming a real row; the account still
 * active; and the session minted after the password last changed. Sessions
 * from before that column existed carry no authAt and stay valid until the
 * NEXT rotation — nobody is logged out by the deploy itself.
 *
 * Deliberately enters NO scope: the caller decides tenant or platform.
 */
async function loadValidatedIdentity() {
  const session = await auth();
  const id = Number(session?.user?.id);
  if (!id) return null;
  const row = await db.select().from(users).where(eq(users.id, id)).limit(1).then(one);
  if (!row || !row.active) return null;
  if (row.passwordChangedAt) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authAt = (session?.user as any)?.authAt as number | undefined;
    if (!authAt || authAt < Date.parse(row.passwordChangedAt)) return null;
  }
  return row;
}

/**
 * The signed-in user with their CURRENT role and active flag, read from the
 * database rather than the JWT. A demotion or deactivation therefore applies
 * on the next request, not the next sign-in — with a session that lives in a
 * cookie for days, "next sign-in" could otherwise be weeks away.
 */
export async function sessionUser(): Promise<SessionUser | null> {
  const row = await loadValidatedIdentity();
  if (!row) return null;
  // From here on, every query this request makes carries its tenant — the
  // pool stamps it into the connection and RLS enforces it (tenant-context.ts).
  enterTenant(row.companyId);
  // The platform's pulse: throttled, fire-and-forget, never blocks a request.
  touchActivity(row.companyId, row.id);
  return {
    id: row.id,
    companyId: row.companyId,
    role: row.role,
    name: row.name,
    email: row.email,
  };
}

/**
 * Any signed-in, still-active account. A session the database no longer
 * honors — deactivated user, or one minted before the last password change —
 * still carries a cryptographically valid JWT, so the middleware lets it
 * through; this is where it lands on the login page instead of an error.
 * (The bare path is fine: the locale middleware prefixes it.)
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await sessionUser();
  if (!user) redirect("/login");
  // The company's lifecycle gate. A pending or suspended company keeps its
  // logins, but every page yields to the one status screen — which is why
  // those two pages (and the data-export route a suspended admin is still
  // promised) sit on sessionUser directly, never on this.
  const status = await companyStatus(user.companyId);
  if (status === "pending") redirect("/pending");
  if (status === "suspended") redirect("/suspended");
  return user;
}

/** The company's lifecycle column, cached per request like the modules. */
export const companyStatus = cache(async (companyId: number) => {
  const row = await db
    .select({ status: companies.status })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
    .then(one);
  return row?.status ?? "active";
});

/**
 * Admin only. Server actions behind this are the actual security boundary;
 * hiding the buttons in the UI is only politeness.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("forbidden");
  return user;
}

// --- module visibility -------------------------------------------------------

export type CompanyModules = { orders: boolean; finance: boolean };

/**
 * Which switchable modules this company has. Catalog and contacts are the
 * product's core and are always on; orders and finance are flipped from the
 * platform panel, and off means the module does not exist for the company —
 * pages 404, actions refuse, nav omits. Cached per request: the layout and
 * the page both ask.
 */
export const getCompanyModules = cache(async (companyId: number): Promise<CompanyModules> => {
  const row = await db
    .select({ orders: companies.moduleOrders, finance: companies.moduleFinance })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
    .then(one);
  return row ?? { orders: true, finance: true };
});

/**
 * Gate for a switchable module's pages. 404 rather than redirect: to a
 * company without the module, the page genuinely does not exist.
 */
export async function requireModulePage(
  user: SessionUser,
  module: keyof CompanyModules,
): Promise<void> {
  const modules = await getCompanyModules(user.companyId);
  if (!modules[module]) notFound();
}

/** Gate for a switchable module's server actions. */
export async function requireModuleAction(
  user: SessionUser,
  module: keyof CompanyModules,
): Promise<void> {
  const modules = await getCompanyModules(user.companyId);
  if (!modules[module]) throw new Error("module disabled");
}

// --- platform operator -------------------------------------------------------

/**
 * The operator of the whole platform — Mbarete itself, not a tenant admin.
 *
 * Everything about the hidden panel funnels through here: it is the only
 * code that calls enterPlatform(), and it does so only after the flag on the
 * user row checked out. Everyone else gets a 404, so to a tenant the panel's
 * URL is indistinguishable from a page that does not exist.
 */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  // The SAME validation the tenant gates use — so a rotated password or a
  // deactivation kills panel access exactly as it kills everything else.
  const row = await loadValidatedIdentity();
  if (!row || !row.platformAdmin) notFound();
  // Cross-tenant SELECT via the platform_read policies; no tenant is entered,
  // so tenant-scoped writes stay impossible on this path.
  enterPlatform();
  return {
    id: row.id,
    companyId: row.companyId,
    role: row.role,
    name: row.name,
    email: row.email,
  };
}
