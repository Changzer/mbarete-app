/**
 * Entitlement enforcement, tested in SaaS mode against a real Postgres —
 * including the part a unit test cannot see: two requests racing for the
 * last slot must serialize on the company row lock and produce exactly one
 * success. Runs as the app's own role under tenant context, the same shape
 * every production write has.
 *
 * Usage (CI runs this with DEPLOY_MODE=saas):
 *   DEPLOY_MODE=saas DATABASE_URL=postgres://mbarete_app:... npx tsx scripts/test-entitlements.ts
 */
import { db, pool } from "../src/db";
import { companies, users, products, categories } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { runWithTenant } from "../src/db/tenant-context";
import {
  canAddProduct,
  canAddUser,
  productSlotAvailableLocked,
  seatAvailableLocked,
} from "../src/lib/entitlements";
import { isSaas } from "../src/lib/deploy";
import { PLANS } from "../src/lib/plans";

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg: string) {
  console.log(`OK: ${msg}`);
}

async function main() {
  if (!isSaas()) fail("run with DEPLOY_MODE=saas — self-hosted mode never meters");
  const CAP = PLANS.free.maxProducts;
  if (CAP === null) fail("free plan has no product cap to test");

  const run = Date.now();
  const [company] = await db
    .insert(companies)
    .values({ name: `Cap Test ${run}`, plan: "free" })
    .returning({ id: companies.id });
  const companyId = company.id;

  try {
    await runWithTenant(companyId, async () => {
      const [cat] = await db
        .insert(categories)
        .values({ companyId, nameEn: "caps", nameZh: "caps" })
        .returning({ id: categories.id });

      const productValues = (i: number | string) => ({
        companyId,
        sku: `CAP-${run}-${i}`,
        nameEn: `cap ${i}`,
        nameZh: "",
        categoryId: cat.id,
        price: 1,
        currency: "USD",
        moq: 1,
        qtyPerBox: 1,
      });

      // ---- products: fill to one below the cap, then race for the last slot
      for (let i = 0; i < CAP - 1; i += 1) {
        await db.insert(products).values(productValues(i));
      }
      if (!(await canAddProduct(companyId))) fail(`refused at ${CAP - 1}/${CAP}`);

      const attemptProduct = (tag: string) =>
        db.transaction(async (tx) => {
          if (!(await productSlotAvailableLocked(tx, companyId))) return false;
          await tx.insert(products).values(productValues(tag));
          return true;
        });
      const raced = await Promise.all([attemptProduct("race-a"), attemptProduct("race-b")]);
      if (raced.filter(Boolean).length !== 1) {
        fail(`product race: expected exactly one winner, got ${JSON.stringify(raced)}`);
      }
      ok("two requests racing for the last product slot: exactly one wins");

      const rows = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.companyId, companyId));
      if (rows.length !== CAP) fail(`expected ${CAP} products, found ${rows.length}`);
      if (await canAddProduct(companyId)) fail("cap full but canAddProduct still says yes");
      if (await attemptProduct("over")) fail("insert past the cap succeeded");
      ok(`the cap holds at ${CAP} against a straight attempt`);
    });

    // ---- seats: free = 1; occupy it, race for a bought extra seat
    await db.insert(users).values({
      companyId,
      email: `cap-owner-${run}@test.invalid`,
      passwordHash: "x",
      name: "Owner",
      role: "admin",
    });
    const attemptSeat = (i: number) =>
      db.transaction(async (tx) => {
        if (!(await seatAvailableLocked(tx, companyId))) return false;
        await tx.insert(users).values({
          companyId,
          email: `cap-user-${run}-${i}@test.invalid`,
          passwordHash: "x",
          name: `Racer ${i}`,
          role: "collaborator",
        });
        return true;
      });
    if (await canAddUser(companyId)) fail("free plan seat cap not binding at 1/1");
    if ((await Promise.all([attemptSeat(1), attemptSeat(2)])).some(Boolean)) {
      fail("a full seat cap still admitted someone");
    }
    ok("a full seat cap refuses everyone, even in parallel");

    await db.update(companies).set({ extraSeats: 1 }).where(eq(companies.id, companyId));
    const seatRace = await Promise.all([attemptSeat(3), attemptSeat(4)]);
    if (seatRace.filter(Boolean).length !== 1) {
      fail(`seat race: expected exactly one winner, got ${JSON.stringify(seatRace)}`);
    }
    ok("one bought seat, two racing invites: exactly one account");

    console.log("ALL ENTITLEMENT TESTS PASSED");
  } finally {
    // The test company and everything under it, gone — reruns start clean.
    await runWithTenant(companyId, async () => {
      await db.delete(products).where(eq(products.companyId, companyId));
      await db.delete(categories).where(eq(categories.companyId, companyId));
    });
    await db.delete(users).where(eq(users.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await pool.end();
  }
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
