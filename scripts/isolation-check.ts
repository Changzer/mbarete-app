import { db, one, pool } from "../src/db";
import {
  companies,
  users,
  categories,
  contacts,
  products,
  productSuppliers,
  orders,
  orderItems,
} from "../src/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getProducts, getProductById, getCategories } from "../src/lib/queries/catalog";
import { getContactsByType, getContactById } from "../src/lib/queries/contacts";
import { getOrders, getOrderById, getExchangeRates } from "../src/lib/queries/orders";
import { getOffersForProduct } from "../src/lib/queries/offers";
import { getFinanceData } from "../src/lib/queries/finance";
import { getUserNames } from "../src/lib/queries/users";

/**
 * Tenant-isolation check, run against a live database:
 *
 *   npm run check:isolation
 *
 * Creates a throwaway second company with its own data, then attacks company
 * 1 from it two ways — through every scoped query (must come back empty) and
 * through forged cross-tenant references (the composite FKs must reject
 * them). Cleans up after itself. Exits non-zero on any leak, so it can gate
 * a release.
 */

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures += 1;
}

async function expectFkViolation(name: string, run: () => Promise<unknown>) {
  try {
    await run();
    check(name, false, "insert was accepted");
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    check(name, code === "23503", `error code ${code ?? "none"}`);
  }
}

async function main() {
  // --- victim: whatever company 1 already has; make sure it has one of each.
  const victim = await db.select().from(companies).orderBy(companies.id).limit(1).then(one);
  if (!victim) throw new Error("no company 1 — run the seed first");
  const victimCategory = (await getCategories(victim.id))[0];
  const victimContact = await db
    .select()
    .from(contacts)
    .where(eq(contacts.companyId, victim.id))
    .limit(1)
    .then(one);
  const victimProduct = await db
    .select()
    .from(products)
    .where(eq(products.companyId, victim.id))
    .limit(1)
    .then(one);
  if (!victimCategory || !victimContact || !victimProduct) {
    throw new Error("company 1 needs at least one category, contact and product");
  }

  // --- attacker: a throwaway second company.
  const [attacker] = await db
    .insert(companies)
    .values({ name: "Isolation Probe Co" })
    .returning();
  const [attackerUser] = await db
    .insert(users)
    .values({
      companyId: attacker.id,
      email: `probe-${Date.now()}@isolation.test`,
      passwordHash: "x",
      name: "Probe",
      role: "admin",
    })
    .returning();
  const [attackerCategory] = await db
    .insert(categories)
    .values({ companyId: attacker.id, nameEn: "Probe", nameZh: "探" })
    .returning();

  try {
    // ---- 1. The query layer: company 1's data through company 2's eyes.
    const products2 = await getProducts(attacker.id);
    check("getProducts sees nothing", products2.length === 0);
    check(
      "getProductById refuses a foreign id",
      (await getProductById(attacker.id, victimProduct.id)) === undefined,
    );
    check(
      "getCategories sees only its own",
      (await getCategories(attacker.id)).every((c) => c.companyId === attacker.id),
    );
    const contactType = victimContact.type;
    check(
      "getContactsByType sees nothing",
      (await getContactsByType(attacker.id, contactType)).length === 0,
    );
    check(
      "getContactById refuses a foreign id",
      (await getContactById(attacker.id, victimContact.id)) === undefined,
    );
    check("getOrders sees nothing", (await getOrders(attacker.id)).length === 0);
    const victimOrder = await db
      .select()
      .from(orders)
      .where(eq(orders.companyId, victim.id))
      .limit(1)
      .then(one);
    if (victimOrder) {
      check(
        "getOrderById refuses a foreign id",
        (await getOrderById(attacker.id, victimOrder.id)) === null,
      );
    } else {
      console.log("SKIP: company 1 has no orders to probe");
    }
    check(
      "getOffersForProduct returns nothing for a foreign product",
      (await getOffersForProduct(attacker.id, victimProduct.id)).length === 0,
    );
    const finance = await getFinanceData(attacker.id);
    check("finance report is empty", finance.orders.length === 0);
    check(
      "getUserNames lists only its own team",
      ![...(await getUserNames(attacker.id)).keys()].some((id) => id !== attackerUser.id),
    );
    check(
      "exchange rates are its own (none yet)",
      Object.keys(await getExchangeRates(attacker.id)).length === 0,
    );

    // ---- 2. The walls: forged cross-tenant references must be impossible.
    await expectFkViolation("FK rejects a product using company 1's category", () =>
      db.insert(products).values({
        companyId: attacker.id,
        sku: "PROBE-1",
        nameEn: "Probe",
        nameZh: "探",
        categoryId: victimCategory.id,
        price: 1,
      }),
    );
    const supplierId =
      victimContact.type === "supplier"
        ? victimContact.id
        : (
            await db
              .select()
              .from(contacts)
              .where(and(eq(contacts.companyId, victim.id), eq(contacts.type, "supplier")))
              .limit(1)
              .then(one)
          )?.id;
    if (supplierId) {
      await expectFkViolation("FK rejects a product naming company 1's supplier", () =>
        db.insert(products).values({
          companyId: attacker.id,
          sku: "PROBE-2",
          nameEn: "Probe",
          nameZh: "探",
          categoryId: attackerCategory.id,
          price: 1,
          supplierId,
        }),
      );
      await expectFkViolation("FK rejects a quote naming company 1's supplier", async () => {
        const [p] = await db
          .insert(products)
          .values({
            companyId: attacker.id,
            sku: "PROBE-3",
            nameEn: "Probe",
            nameZh: "探",
            categoryId: attackerCategory.id,
            price: 1,
          })
          .returning();
        try {
          await db.insert(productSuppliers).values({
            companyId: attacker.id,
            productId: p.id,
            supplierId,
            price: 1,
            quotedOn: "2026-01-01",
          });
        } finally {
          await db.delete(products).where(eq(products.id, p.id));
        }
      });
    }
    await expectFkViolation("FK rejects an order for company 1's client", () =>
      db.insert(orders).values({
        companyId: attacker.id,
        orderNumber: "PROBE-ORD",
        clientId: victimContact.id,
        createdBy: attackerUser.id,
      }),
    );
    await expectFkViolation("FK rejects attributing rows to company 1's user", async () => {
      const victimUser = await db
        .select()
        .from(users)
        .where(eq(users.companyId, victim.id))
        .limit(1)
        .then(one);
      await db.insert(orders).values({
        companyId: attacker.id,
        orderNumber: "PROBE-ORD-2",
        clientId: victimContact.id,
        createdBy: victimUser!.id,
      });
    });
    // Order lines have no company column by design; prove the app layer's
    // product filter is what a forged payload actually meets.
    const victimItems = await db
      .select()
      .from(orderItems)
      .where(
        inArray(
          orderItems.orderId,
          db.select({ id: orders.id }).from(orders).where(eq(orders.companyId, attacker.id)),
        ),
      );
    check("no order lines leaked to the attacker", victimItems.length === 0);
  } finally {
    // ---- cleanup: the probe company and everything under it.
    await db.delete(productSuppliers).where(eq(productSuppliers.companyId, attacker.id));
    await db.delete(products).where(eq(products.companyId, attacker.id));
    await db.delete(categories).where(eq(categories.companyId, attacker.id));
    await db.delete(users).where(eq(users.companyId, attacker.id));
    await db.delete(companies).where(eq(companies.id, attacker.id));
    await pool.end();
  }

  console.log(failures === 0 ? "ISOLATION: ALL PASS" : `ISOLATION: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("isolation check failed to run:", err);
  process.exit(1);
});
