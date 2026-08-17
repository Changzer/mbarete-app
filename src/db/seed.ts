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
      db.insert(users).values({ email, passwordHash, name: adminName }).run();
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

  const rateCount = db.select().from(exchangeRates).all().length;
  if (rateCount === 0) {
    db.insert(exchangeRates)
      .values([
        { currencyCode: "USD", rateToUsd: 1 },
        { currencyCode: "CNY", rateToUsd: 0.14 },
      ])
      .run();
    console.log("[seed] created starter exchange rates (edit these in the app)");
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
