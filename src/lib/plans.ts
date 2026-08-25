/**
 * What each plan entitles a company to.
 *
 * Plans live in code, not the database: there are two of them, they change
 * by shipping a commit, and every limit is visible in one screenful. The
 * database keeps only the company's plan NAME; switching plan also applies
 * the plan's module defaults to the company's switches, which stay
 * individually overridable from the panel afterwards.
 *
 * Limits are null for "no limit". They bind only on SaaS deployments —
 * a self-hosted install is the owner's own machine and is never metered
 * (see entitlements.ts).
 */

export type PlanId = "free" | "pro";

export type Plan = {
  id: PlanId;
  /** Module switches a company gets when put on this plan. */
  modules: { orders: boolean; finance: boolean };
  maxUsers: number | null;
  maxProducts: number | null;
  maxStorageBytes: number | null;
};

const MB = 1024 * 1024;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    // The catalog IS the free product: register at the market, browse, share.
    // Orders and finance are the paid loop.
    modules: { orders: false, finance: false },
    maxUsers: 2,
    maxProducts: 50,
    maxStorageBytes: 250 * MB,
  },
  pro: {
    id: "pro",
    modules: { orders: true, finance: true },
    maxUsers: null,
    maxProducts: null,
    maxStorageBytes: null,
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/**
 * The plan behind a stored name. An unknown name reads as free — commercially
 * fail-closed: a typo in the database must never hand out pro for nothing.
 */
export function planOf(name: string): Plan {
  return PLANS[name as PlanId] ?? PLANS.free;
}

/** Whether `current` uses of a limited resource leave room for one more. */
export function hasRoomFor(limit: number | null, current: number): boolean {
  return limit === null || current < limit;
}

/** "12/50" for the panel; "12" when the plan does not meter it. */
export function usageLabel(current: number, limit: number | null): string {
  return limit === null ? String(current) : `${current}/${limit}`;
}
