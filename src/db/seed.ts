import bcrypt from "bcryptjs";
import { db, one, pool } from "./index";
import { companies, users, categories, exchangeRates } from "./schema";
import { eq } from "drizzle-orm";

/**
 * Self-hosted bootstrap: one company, owned by the admin the env names.
 *
 * Runs on every boot and is idempotent. In the future SaaS mode, companies
 * are created by the signup flow instead and this seed only guarantees the
 * self-hosted install keeps working exactly as before — one tenant, made
 * from ADMIN_EMAIL / ADMIN_PASSWORD / COMPANY_NAME.
 */
export async function seed() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME ?? "Admin";
  const companyName = process.env.COMPANY_NAME ?? "Mbarete";

  // The install's company. Exactly one is created; its id anchors every
  // other seeded row and everything the app writes afterwards.
  let company = await db.select().from(companies).limit(1).then(one);
  if (!company) {
    [company] = await db.insert(companies).values({ name: companyName }).returning();
    console.log(`[seed] created company ${companyName}`);
  }
  const companyId = company.id;

  if (adminEmail && adminPassword) {
    const email = adminEmail.toLowerCase().trim();
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1).then(one);
    if (!existing) {
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      // The bootstrap account owns the company and must reach Settings/Users.
      const [created] = await db
        .insert(users)
        .values({ companyId, email, passwordHash, name: adminName, role: "admin" })
        .returning({ id: users.id });
      await db
        .update(companies)
        .set({ ownerUserId: created.id })
        .where(eq(companies.id, companyId));
      console.log(`[seed] created initial user ${email}`);
    }
  } else {
    console.warn(
      "[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping initial user creation",
    );
  }

  // An owner may be missing on installs migrated from the single-tenant era.
  if (!company.ownerUserId) {
    const firstAdmin = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.companyId, companyId))
      .limit(1)
      .then(one);
    if (firstAdmin) {
      await db
        .update(companies)
        .set({ ownerUserId: firstAdmin.id })
        .where(eq(companies.id, companyId));
    }
  }

  const existingCategories = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.companyId, companyId));
  if (existingCategories.length === 0) {
    await db.insert(categories).values([
      { companyId, nameEn: "General", nameZh: "综合" },
      { companyId, nameEn: "Electronics", nameZh: "电子产品" },
      { companyId, nameEn: "Home Goods", nameZh: "家居用品" },
    ]);
    console.log("[seed] created starter categories");
  }

  // Seeded per-currency rather than "only when the table is empty", so an
  // existing install picks up a currency it was missing on the next boot.
  // RMB and CNY are the same currency under two codes and suppliers quote in
  // both; without both present, products priced in the missing one convert to
  // nothing and drop out of order totals.
  const starterRates = [
    { currencyCode: "USD", rateToUsd: 1 },
    { currencyCode: "CNY", rateToUsd: 0.14 },
    { currencyCode: "RMB", rateToUsd: 0.14 },
    { currencyCode: "BRL", rateToUsd: 0.18 },
  ];
  const existingRateRows = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.companyId, companyId));
  const existingRates = new Set(existingRateRows.map((r) => r.currencyCode));
  const missingRates = starterRates.filter((r) => !existingRates.has(r.currencyCode));
  if (missingRates.length > 0) {
    // Never overwrites a rate already there, so rates edited in Settings stand.
    await db.insert(exchangeRates).values(missingRates.map((r) => ({ ...r, companyId })));
    console.log(
      `[seed] added starter exchange rates: ${missingRates
        .map((r) => r.currencyCode)
        .join(", ")} (edit these in the app)`,
    );
  }

  console.log("[seed] done");
}

if (require.main === module) {
  seed()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      console.error("[seed] failed:", err);
      await pool.end();
      process.exit(1);
    });
}
