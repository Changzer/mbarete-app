import { planOf } from "@/lib/plans";
import { db } from "@/db";
import { companies, users, categories, exchangeRates } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

/**
 * Creating a company and its people.
 *
 * One place so the boot seed (self-hosted) and the public signup flow (SaaS)
 * produce byte-for-byte the same starting state: a company, its owner, and the
 * starter categories and exchange rates every tenant begins with.
 */

/**
 * Roughly how the Yiwu market itself is laid out, plus a General catch-all.
 * Every new tenant starts with the full list: photo transcription picks a
 * category from what exists, and three generic ones taught the model to
 * shelve rubber toys under Bags. Deleting unwanted ones is one tap each and
 * deletions stick — nothing re-seeds once the company has any category.
 */
export const STARTER_CATEGORIES: { nameEn: string; nameZh: string }[] = [
  { nameEn: "General", nameZh: "综合" },
  { nameEn: "Stationery", nameZh: "文具" },
  { nameEn: "Toys", nameZh: "玩具" },
  { nameEn: "Jewelry & Accessories", nameZh: "饰品" },
  { nameEn: "Cosmetics & Beauty Tools", nameZh: "美妆用品" },
  { nameEn: "Skincare", nameZh: "护肤品" },
  { nameEn: "Kitchenware", nameZh: "厨房用品" },
  { nameEn: "Home Goods", nameZh: "家居用品" },
  { nameEn: "Hardware & Tools", nameZh: "五金工具" },
  { nameEn: "Electronics", nameZh: "电子产品" },
  { nameEn: "Lighting", nameZh: "灯具" },
  { nameEn: "Watches & Eyewear", nameZh: "钟表眼镜" },
  { nameEn: "Bags & Luggage", nameZh: "箱包" },
  { nameEn: "Umbrellas & Rainwear", nameZh: "雨具" },
  { nameEn: "Socks & Hosiery", nameZh: "袜子" },
  { nameEn: "Apparel", nameZh: "服装" },
  { nameEn: "Shoes", nameZh: "鞋类" },
  { nameEn: "Sports & Outdoor", nameZh: "运动户外" },
  { nameEn: "Pet Supplies", nameZh: "宠物用品" },
  { nameEn: "Auto Accessories", nameZh: "汽车用品" },
  { nameEn: "Party & Festive", nameZh: "节庆用品" },
  { nameEn: "Artificial Flowers", nameZh: "仿真花" },
  { nameEn: "Packaging", nameZh: "包装材料" },
];

/** The starter rows a brand-new company begins with, per its own tenant. */
export async function seedCompanyDefaults(
  companyId: number,
  tx: Pick<typeof db, "select" | "insert"> = db,
) {
  const existingCategories = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.companyId, companyId));
  if (existingCategories.length === 0) {
    await tx.insert(categories).values(STARTER_CATEGORIES.map((c) => ({ companyId, ...c })));
  }

  // RMB and CNY are the same currency under two codes; suppliers quote in both.
  const starterRates = [
    { currencyCode: "USD", rateToUsd: 1 },
    { currencyCode: "CNY", rateToUsd: 0.14 },
    { currencyCode: "RMB", rateToUsd: 0.14 },
    { currencyCode: "BRL", rateToUsd: 0.18 },
  ];
  const existingRates = new Set(
    (
      await tx
        .select({ code: exchangeRates.currencyCode })
        .from(exchangeRates)
        .where(eq(exchangeRates.companyId, companyId))
    ).map((r) => r.code),
  );
  const missing = starterRates.filter((r) => !existingRates.has(r.currencyCode));
  if (missing.length > 0) {
    await tx.insert(exchangeRates).values(missing.map((r) => ({ ...r, companyId })));
  }
}

export type NewCompanyInput = {
  companyName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  /** Set when the signup arrived through another company's referral link. */
  referredByCompanyId?: number;
};

/**
 * Creates a company, its owner (an admin), and the starter defaults, in one
 * transaction — so a half-made company (a company row with no owner, say) can
 * never exist. The email is assumed already validated and free; the caller
 * checks that first to return a clean "email taken" rather than a raw
 * constraint error.
 */
export async function createCompanyWithOwner(
  input: NewCompanyInput,
): Promise<{ companyId: number; ownerId: number }> {
  const passwordHash = await bcrypt.hash(input.ownerPassword, 10);

  return db.transaction(async (tx) => {
    // New companies start on the free plan; its module defaults are applied
    // here so the switches match the plan from the first render. The panel
    // can override either afterwards.
    const plan = planOf("free");
    const [company] = await tx
      .insert(companies)
      .values({
        name: input.companyName,
        plan: plan.id,
        moduleOrders: plan.modules.orders,
        moduleFinance: plan.modules.finance,
        referredByCompanyId: input.referredByCompanyId ?? null,
      })
      .returning({ id: companies.id });

    // The connection was checked out before this company existed, so its RLS
    // scope can't cover it. SET LOCAL adopts the newborn tenant for the rest
    // of the transaction (and only the transaction) so the seeded defaults
    // pass the policies' WITH CHECK.
    await tx.execute(
      sql`SELECT set_config('app.company_id', ${String(company.id)}, true)`,
    );

    const [owner] = await tx
      .insert(users)
      .values({
        companyId: company.id,
        email: input.ownerEmail,
        passwordHash,
        name: input.ownerName,
        role: "admin",
      })
      .returning({ id: users.id });

    await tx
      .update(companies)
      .set({ ownerUserId: owner.id })
      .where(eq(companies.id, company.id));

    await seedCompanyDefaults(company.id, tx);

    return { companyId: company.id, ownerId: owner.id };
  });
}
