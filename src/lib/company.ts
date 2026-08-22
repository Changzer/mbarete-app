import { db } from "@/db";
import { companies, users, categories, exchangeRates } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

/**
 * Creating a company and its people.
 *
 * One place so the boot seed (self-hosted) and the public signup flow (SaaS)
 * produce byte-for-byte the same starting state: a company, its owner, and the
 * starter categories and exchange rates every tenant begins with.
 */

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
    await tx.insert(categories).values([
      { companyId, nameEn: "General", nameZh: "综合" },
      { companyId, nameEn: "Electronics", nameZh: "电子产品" },
      { companyId, nameEn: "Home Goods", nameZh: "家居用品" },
    ]);
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
    const [company] = await tx
      .insert(companies)
      .values({ name: input.companyName })
      .returning({ id: companies.id });

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
