"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/authz";
import { PLANS, type PlanId } from "@/lib/plans";

/**
 * Flips one company's module switch. The write lands on `companies`, which
 * carries no RLS — the tenant walls guard tenant data, and which modules a
 * tenant HAS is platform data about them, not data of theirs.
 */
export async function setCompanyModule(
  companyId: number,
  module: "orders" | "finance",
  enabled: boolean,
): Promise<void> {
  await requirePlatformAdmin();
  const column = module === "orders" ? { moduleOrders: enabled } : { moduleFinance: enabled };
  await db.update(companies).set(column).where(eq(companies.id, companyId));
  revalidatePath("/16015975/mbarete-admin");
}

/**
 * Puts a company on a plan and applies that plan's module defaults, so the
 * switches match the tier from the next request. They stay individually
 * overridable afterwards — the plan is a preset, not a cage.
 */
export async function setCompanyPlan(companyId: number, plan: PlanId): Promise<void> {
  await requirePlatformAdmin();
  const entitlements = PLANS[plan];
  if (!entitlements) return;
  await db
    .update(companies)
    .set({
      plan,
      moduleOrders: entitlements.modules.orders,
      moduleFinance: entitlements.modules.finance,
    })
    .where(eq(companies.id, companyId));
  revalidatePath("/16015975/mbarete-admin");
}
