import bcrypt from "bcryptjs";
import { db, one, pool } from "./index";
import { companies, users } from "./schema";
import { eq } from "drizzle-orm";
import { seedCompanyDefaults } from "../lib/company";
import { isSaas } from "../lib/deploy";
import { runWithTenant } from "./tenant-context";

/**
 * Self-hosted bootstrap: one company, owned by the admin the env names.
 *
 * Runs on every boot and is idempotent. In SaaS mode this is a no-op —
 * companies are created by the public signup flow instead — so a public
 * server never auto-mints a stray company from leftover env vars.
 */
export async function seed() {
  if (isSaas()) {
    // The operator signs up like any tenant; the grant picks the account up
    // on the boot after it exists.
    await ensurePlatformAdmin();
    console.log("[seed] SaaS mode — companies come from signup, nothing to seed");
    return;
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME ?? "Admin";
  const companyName = process.env.COMPANY_NAME ?? "Mbarete";

  // The install's company. Exactly one is created; its id anchors every
  // other seeded row and everything the app writes afterwards.
  let company = await db.select().from(companies).limit(1).then(one);
  if (!company) {
    [company] = await db.insert(companies).values({ name: companyName, plan: "pro" }).returning();
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

  // Starter categories and rates — the same set signup gives a new company.
  // Wrapped because the boot seed runs outside any signed-in request, and the
  // defaults live in RLS-guarded tables.
  await runWithTenant(companyId, () => seedCompanyDefaults(companyId));

  // After the admin user exists, so the very first boot already grants it.
  await ensurePlatformAdmin();

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

/**
 * Grants the hidden cross-company panel to the operator's own account.
 *
 * Runs in BOTH deploy modes on every boot, and is the only way the flag is
 * ever set — there is deliberately no UI for it. PLATFORM_ADMIN_EMAIL names
 * the account; self-hosted installs fall back to ADMIN_EMAIL, so the
 * bootstrap admin is the operator without extra configuration. The account
 * must already exist (in SaaS: sign up first, then boot picks it up).
 */
async function ensurePlatformAdmin() {
  const email = (process.env.PLATFORM_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "")
    .toLowerCase()
    .trim();
  if (!email) return;
  const row = await db.select().from(users).where(eq(users.email, email)).limit(1).then(one);
  if (!row || row.platformAdmin) return;
  await db.update(users).set({ platformAdmin: true }).where(eq(users.id, row.id));
  console.log(`[seed] granted platform admin to ${email}`);
}
