import bcrypt from "bcryptjs";
import { db } from "./index";
import { users, categories, exchangeRates } from "./schema";
import { eq } from "drizzle-orm";

export async function seed() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME ?? "Admin";

  if (adminEmail && adminPassword) {
    const email = adminEmail.toLowerCase().trim();
    const existing = db.select().from(users).where(eq(users.email, email)).get();
    if (!existing) {
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      // The bootstrap account must be able to reach Settings and Users.
      db.insert(users).values({ email, passwordHash, name: adminName, role: "admin" }).run();
      console.log(`[seed] created initial user ${email}`);
    }
  } else {
    console.warn(
      "[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping initial user creation",
    );
  }

  const categoryCount = db.select().from(categories).all().length;
  if (categoryCount === 0) {
    db.insert(categories)
      .values([
        { nameEn: "General", nameZh: "综合" },
        { nameEn: "Electronics", nameZh: "电子产品" },
        { nameEn: "Home Goods", nameZh: "家居用品" },
      ])
      .run();
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
  const existingRates = new Set(
    db.select().from(exchangeRates).all().map((r) => r.currencyCode),
  );
  const missingRates = starterRates.filter((r) => !existingRates.has(r.currencyCode));
  if (missingRates.length > 0) {
    // Never overwrites a rate already there, so rates edited in Settings stand.
    db.insert(exchangeRates).values(missingRates).run();
    console.log(
      `[seed] added starter exchange rates: ${missingRates
        .map((r) => r.currencyCode)
        .join(", ")} (edit these in the app)`,
    );
  }
}

if (require.main === module) {
  seed()
    .then(() => {
      console.log("[seed] done");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
