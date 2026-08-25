import bcrypt from "bcryptjs";
import { db, one, pool } from "./index";
import { companies, users } from "./schema";
import { and, eq, ne } from "drizzle-orm";
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
    await backfillPartiesSnapshots();
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

  await backfillPartiesSnapshots();

  console.log("[seed] done");
}

/**
 * One-time freeze for orders confirmed before parties snapshots existed.
 *
 * Their documents rendered live master data until now; the closest honest
 * copy is master data as it stands at THIS boot, so that is what gets
 * frozen — marked `reconstructed`, because it is a reconstruction, not what
 * the confirmation actually showed. Idempotent: only NULL snapshots on
 * non-draft orders are filled, so every later boot finds nothing to do.
 */
async function backfillPartiesSnapshots() {
  const { orders } = await import("./schema");
  const { buildPartiesSnapshot } = await import("../lib/parties-snapshot");
  const { isNull, ne: notEq, and: allOf } = await import("drizzle-orm");
  const companyRows = await db.select({ id: companies.id }).from(companies);
  let frozen = 0;
  for (const { id: companyId } of companyRows) {
    // Order tables are RLS-guarded; the boot seed adopts each tenant in turn.
    await runWithTenant(companyId, async () => {
      const rows = await db
        .select({ id: orders.id, clientId: orders.clientId, bankAccountId: orders.bankAccountId })
        .from(orders)
        .where(allOf(isNull(orders.partiesSnapshot), notEq(orders.status, "draft")));
      for (const row of rows) {
        const snapshot = await buildPartiesSnapshot(companyId, row.clientId, row.bankAccountId, {
          reconstructed: true,
        });
        await db.update(orders).set({ partiesSnapshot: snapshot }).where(eq(orders.id, row.id));
        frozen += 1;
      }
    });
  }
  if (frozen > 0) console.log(`[seed] froze parties on ${frozen} pre-existing order(s)`);
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
 * Reconciles the platform-panel flag against the environment — the env var
 * is the single source of truth, and the database follows it on every boot.
 *
 * Runs in BOTH deploy modes, and is the only way the flag is ever set —
 * there is deliberately no UI for it. PLATFORM_ADMIN_EMAIL names the
 * account; self-hosted installs fall back to ADMIN_EMAIL, so the bootstrap
 * admin is the operator without extra configuration.
 *
 * Reconcile, not merely grant: changing the variable dethrones the old
 * operator, unsetting it (with no fallback) leaves nobody, and naming an
 * account that does not exist or is deactivated grants nobody — each with
 * a loud log line, because a panel whose operator silently changed is how
 * an ex-employee keeps the keys.
 */
async function ensurePlatformAdmin() {
  const email = (process.env.PLATFORM_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "")
    .toLowerCase()
    .trim();
  await db.transaction(async (tx) => {
    // Whoever holds the flag but is not the configured account loses it.
    const revoked = await tx
      .update(users)
      .set({ platformAdmin: false })
      .where(email ? and(eq(users.platformAdmin, true), ne(users.email, email)) : eq(users.platformAdmin, true))
      .returning({ email: users.email });
    for (const r of revoked) {
      console.warn(`[seed] revoked platform admin from ${r.email} (no longer configured)`);
    }
    if (!email) {
      console.warn("[seed] PLATFORM_ADMIN_EMAIL unset — the platform panel has no operator");
      return;
    }
    const row = await tx.select().from(users).where(eq(users.email, email)).limit(1).then(one);
    if (!row) {
      console.warn(`[seed] PLATFORM_ADMIN_EMAIL ${email} matches no account — nobody granted`);
      return;
    }
    if (!row.active) {
      // The gate checks active anyway; stripping the flag keeps the truth
      // in one place instead of an inert grant waiting to surprise someone.
      if (row.platformAdmin) {
        await tx.update(users).set({ platformAdmin: false }).where(eq(users.id, row.id));
      }
      console.warn(`[seed] PLATFORM_ADMIN_EMAIL ${email} is deactivated — nobody granted`);
      return;
    }
    if (!row.platformAdmin) {
      await tx.update(users).set({ platformAdmin: true }).where(eq(users.id, row.id));
      console.log(`[seed] granted platform admin to ${email}`);
    }
  });
}
