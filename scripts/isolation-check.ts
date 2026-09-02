import { db, one, pool } from "../src/db";
import {
  companies,
  users,
  categories,
  contacts,
  products,
  productImages,
  contactImages,
  productSuppliers,
  orders,
  orderItems,
  orderDocuments,
  orderPayments,
  orderExpenses,
  captureDrafts,
  captureDraftImages,
} from "../src/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { runWithTenant } from "../src/db/tenant-context";
import { periodCloses, adminEvents } from "../src/db/schema";
import { listPeriodCloses } from "../src/lib/queries/accountant";
import { getProducts, getProductById, getCategories } from "../src/lib/queries/catalog";
import { getContactsByType, getContactById } from "../src/lib/queries/contacts";
import { getOrders, getOrderById, getExchangeRates } from "../src/lib/queries/orders";
import { getOffersForProduct } from "../src/lib/queries/offers";
import { getFinanceData } from "../src/lib/queries/finance";
import { getUserNames } from "../src/lib/queries/users";
import { isGatedUploadName, isDocumentUploadName } from "../src/lib/uploads";

/**
 * Tenant-isolation check, run against a live database:
 *
 *   npm run check:isolation
 *
 * Stands up two throwaway companies (a "victim" A with one of everything, and
 * an "attacker" B), then attacks A from B four ways:
 *   1. Scoped queries — every read fn must return nothing for B.
 *   2. Forged cross-tenant references — the composite FKs must reject them.
 *   3. Scoped writes — an UPDATE with B's company predicate must touch ZERO of
 *      A's rows (this is the invariant setOrderStatus/saveOffer now uphold; a
 *      regression that drops the companyId predicate makes these fail).
 *   4. Gated-upload classification — order documents and slips are gated.
 *
 * Both companies are fully created here (not reusing the seed's company), so
 * the FK and write probes have real A-owned rows to bounce off. Cleans up
 * everything and exits non-zero on any leak, so it can gate a release.
 */

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures += 1;
}

async function expectFkViolation(name: string, run: () => Promise<unknown>) {
  try {
    await run();
    check(name, false, "write was accepted (expected FK violation)");
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    check(name, code === "23503", `error code ${code ?? "none"}`);
  }
}

/** A full, self-contained company with one of every kind of row. */
async function makeCompany(name: string) {
  const [company] = await db.insert(companies).values({ name }).returning();
  const [user] = await db
    .insert(users)
    .values({
      companyId: company.id,
      email: `probe-${company.id}-${name.replace(/\W+/g, "")}@isolation.test`,
      passwordHash: "x",
      name: `${name} admin`,
      role: "admin",
    })
    .returning();
  // Business rows live behind RLS; create them as the company they belong to.
  return runWithTenant(company.id, async () => {
  const [category] = await db
    .insert(categories)
    .values({ companyId: company.id, nameEn: `${name} cat`, nameZh: "类" })
    .returning();
  const [supplier] = await db
    .insert(contacts)
    .values({ companyId: company.id, type: "supplier", companyName: `${name} supplier` })
    .returning();
  const [client] = await db
    .insert(contacts)
    .values({ companyId: company.id, type: "client", companyName: `${name} client` })
    .returning();
  const [product] = await db
    .insert(products)
    .values({
      companyId: company.id,
      sku: `${name}-SKU-1`,
      nameEn: `${name} product`,
      nameZh: "品",
      categoryId: category.id,
      price: 1,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  await db.insert(periodCloses).values({
    companyId: company.id,
    period: "2026-01",
    closedBy: user.id,
    closedAt: new Date().toISOString(),
    packSha256: `digest-${name}`,
  });
  const [offer] = await db
    .insert(productSuppliers)
    .values({
      companyId: company.id,
      productId: product.id,
      supplierId: supplier.id,
      price: 1,
      currency: "RMB",
      quotedOn: "2026-01-01",
      createdBy: user.id,
    })
    .returning();
  const [order] = await db
    .insert(orders)
    .values({
      companyId: company.id,
      orderNumber: `${name}-ORD-1`,
      clientId: client.id,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  const [draft] = await db
    .insert(captureDrafts)
    .values({
      companyId: company.id,
      clientId: `probe-${company.id}-${Math.round(company.id * 1e6)}`,
      userId: user.id,
      capturedAt: "2026-01-01",
    })
    .returning();
  await db.insert(adminEvents).values({
    companyId: company.id,
    actorUserId: user.id,
    action: "user-created",
    targetUserId: user.id,
    detail: name,
  });
  return { company, user, category, supplier, client, product, offer, order, draft };
  });
}

async function destroyCompany(companyId: number) {
  // Child rows cascade from their parents via the composite FKs; delete the
  // parents in dependency order and the children go with them. Business rows
  // are behind RLS, so clean up as their own tenant; users and companies are
  // exempt and go last.
  await runWithTenant(companyId, async () => {
    await db.delete(adminEvents).where(eq(adminEvents.companyId, companyId));
    await db.delete(periodCloses).where(eq(periodCloses.companyId, companyId));
    await db.delete(captureDraftImages).where(eq(captureDraftImages.companyId, companyId));
    await db.delete(captureDrafts).where(eq(captureDrafts.companyId, companyId));
    await db.delete(orders).where(eq(orders.companyId, companyId));
    await db.delete(productSuppliers).where(eq(productSuppliers.companyId, companyId));
    await db.delete(products).where(eq(products.companyId, companyId));
    await db.delete(contacts).where(eq(contacts.companyId, companyId));
    await db.delete(categories).where(eq(categories.companyId, companyId));
  });
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

async function main() {
  const A = await makeCompany("VictimA");
  const B = await makeCompany("AttackerB");

  try {
    // Sections 1–3 all act as company B — the attacker probing for A's data —
    // so they run under B's tenant context, exactly as B's requests would.
    await runWithTenant(B.company.id, async () => {
    // ---- 1. Scoped queries: A's data through B's eyes must be empty. --------
    check(
      "getProducts sees only B's",
      (await getProducts(B.company.id)).every((p) => p.id === B.product.id),
    );
    check(
      "getProductById refuses A's product",
      (await getProductById(B.company.id, A.product.id)) === undefined,
    );
    check(
      "getCategories sees only B's",
      (await getCategories(B.company.id)).every((c) => c.companyId === B.company.id),
    );
    check(
      "getContactsByType(supplier) sees only B's",
      (await getContactsByType(B.company.id, "supplier")).every((c) => c.id === B.supplier.id),
    );
    check(
      "getContactById refuses A's contact",
      (await getContactById(B.company.id, A.client.id)) === undefined,
    );
    check("getOrders sees only B's", (await getOrders(B.company.id)).every((o) => o.id === B.order.id));
    check("getOrderById refuses A's order", (await getOrderById(B.company.id, A.order.id)) === null);
    check(
      "getOffersForProduct returns nothing for A's product",
      (await getOffersForProduct(B.company.id, A.product.id)).length === 0,
    );
    const closesB = await listPeriodCloses(B.company.id);
    check("period closes listing sees only B's row", Object.keys(closesB).length === 1);
    const closeRowsB = await db.select().from(periodCloses);
    check(
      "period_closes RLS hides A's digest from B's scope",
      closeRowsB.length === 1 && closeRowsB[0].packSha256 === "digest-AttackerB",
    );
    const adminRowsB = await db.select().from(adminEvents);
    check(
      "admin_events RLS hides A's admin trail from B's scope",
      adminRowsB.length === 1 && adminRowsB[0].detail === "AttackerB",
    );
    const finance = await getFinanceData(B.company.id);
    check("finance report excludes A's orders", finance.orders.every((o) => o.id === B.order.id));
    check(
      "getUserNames lists only B's team",
      [...(await getUserNames(B.company.id)).keys()].every((id) => id === B.user.id),
    );
    check(
      "exchange rates are B's own",
      Object.keys(await getExchangeRates(B.company.id)).length === 0,
    );

    // ---- 2. Forged cross-tenant references: composite FKs must reject. ------
    await expectFkViolation("FK rejects a product using A's category", () =>
      db.insert(products).values({
        companyId: B.company.id,
        sku: "X-1",
        nameEn: "x",
        nameZh: "x",
        categoryId: A.category.id,
        price: 1,
      }),
    );
    await expectFkViolation("FK rejects a product naming A's supplier", () =>
      db.insert(products).values({
        companyId: B.company.id,
        sku: "X-2",
        nameEn: "x",
        nameZh: "x",
        categoryId: B.category.id,
        price: 1,
        supplierId: A.supplier.id,
      }),
    );
    await expectFkViolation("FK rejects a quote on A's product", () =>
      db.insert(productSuppliers).values({
        companyId: B.company.id,
        productId: A.product.id,
        supplierId: B.supplier.id,
        price: 1,
        currency: "RMB",
        quotedOn: "2026-01-01",
      }),
    );
    await expectFkViolation("FK rejects an order for A's client", () =>
      db.insert(orders).values({
        companyId: B.company.id,
        orderNumber: "X-ORD",
        clientId: A.client.id,
        createdBy: B.user.id,
      }),
    );
    // Attribution isolated: a VALID B order (B's own client) but createdBy = A's
    // user. Previously this test used A's client too, so the 23503 came from the
    // client FK and the attribution wall was never exercised — a false pass.
    await expectFkViolation("FK rejects an order attributed to A's user", () =>
      db.insert(orders).values({
        companyId: B.company.id,
        orderNumber: "X-ORD-ATTR",
        clientId: B.client.id,
        createdBy: A.user.id,
      }),
    );
    await expectFkViolation("FK rejects a product attributed to A's user", () =>
      db.insert(products).values({
        companyId: B.company.id,
        sku: "X-3",
        nameEn: "x",
        nameZh: "x",
        categoryId: B.category.id,
        price: 1,
        createdBy: A.user.id,
      }),
    );

    // ---- 2b. Child tables now carry their own wall: a child row can never
    //          hang off another tenant's parent, whatever id is posted. ------
    await expectFkViolation("FK rejects an order line on A's order", () =>
      db.insert(orderItems).values({
        companyId: B.company.id,
        orderId: A.order.id,
        productId: B.product.id,
        quantity: 1,
        unitPriceSnapshot: 1,
        currencySnapshot: "RMB",
        moqSnapshot: 1,
        lineTotal: 1,
        lineCbm: 0,
        lineWeightKg: 0,
      }),
    );
    await expectFkViolation("FK rejects an order line referencing A's product", () =>
      db.insert(orderItems).values({
        companyId: B.company.id,
        orderId: B.order.id,
        productId: A.product.id,
        quantity: 1,
        unitPriceSnapshot: 1,
        currencySnapshot: "RMB",
        moqSnapshot: 1,
        lineTotal: 1,
        lineCbm: 0,
        lineWeightKg: 0,
      }),
    );
    await expectFkViolation("FK rejects a photo on A's product", () =>
      db.insert(productImages).values({
        companyId: B.company.id,
        productId: A.product.id,
        path: "/uploads/c1/x.jpg",
      }),
    );
    await expectFkViolation("FK rejects a card photo on A's contact", () =>
      db.insert(contactImages).values({
        companyId: B.company.id,
        contactId: A.client.id,
        path: "/uploads/c1/x.jpg",
      }),
    );
    await expectFkViolation("FK rejects a document on A's order", () =>
      db.insert(orderDocuments).values({
        companyId: B.company.id,
        orderId: A.order.id,
        path: "/uploads/c1/doc-x.pdf",
        originalName: "x.pdf",
      }),
    );
    await expectFkViolation("FK rejects a payment on A's order", () =>
      db.insert(orderPayments).values({
        companyId: B.company.id,
        orderId: A.order.id,
        direction: "in",
        amount: 1,
        currency: "RMB",
        paidOn: "2026-01-01",
      }),
    );
    await expectFkViolation("FK rejects an expense on A's order", () =>
      db.insert(orderExpenses).values({
        companyId: B.company.id,
        orderId: A.order.id,
        category: "freight",
        amount: 1,
        currency: "RMB",
        spentOn: "2026-01-01",
      }),
    );
    await expectFkViolation("FK rejects a draft photo on A's draft", () =>
      db.insert(captureDraftImages).values({
        companyId: B.company.id,
        draftId: A.draft.id,
        path: "/uploads/c1/x.jpg",
      }),
    );

    // ---- 3. Scoped writes: B's company predicate must touch 0 of A's rows. --
    // These encode the setOrderStatus / saveOffer / bank / delete invariants:
    // every mutation carries company_id, so a foreign id filtered by B's
    // company matches nothing and A's row is left untouched.
    const orderTouched = await db
      .update(orders)
      .set({ status: "cancelled" })
      .where(and(eq(orders.companyId, B.company.id), eq(orders.id, A.order.id)))
      .returning({ id: orders.id });
    check("scoped order update touches 0 of A's rows (setOrderStatus)", orderTouched.length === 0);
    const aOrderAfter = await runWithTenant(A.company.id, () =>
      db
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, A.order.id))
        .limit(1)
        .then(one),
    );
    check("A's order status is unchanged", aOrderAfter?.status === "draft");

    const offerTouched = await db
      .update(productSuppliers)
      .set({ price: 999 })
      .where(and(eq(productSuppliers.companyId, B.company.id), eq(productSuppliers.id, A.offer.id)))
      .returning({ id: productSuppliers.id });
    check("scoped offer update touches 0 of A's rows (saveOffer)", offerTouched.length === 0);
    const aOfferAfter = await runWithTenant(A.company.id, () =>
      db
        .select({ price: productSuppliers.price })
        .from(productSuppliers)
        .where(eq(productSuppliers.id, A.offer.id))
        .limit(1)
        .then(one),
    );
    check("A's offer price is unchanged", aOfferAfter?.price === 1);

    const productDeleted = await db
      .delete(products)
      .where(and(eq(products.companyId, B.company.id), eq(products.id, A.product.id)))
      .returning({ id: products.id });
    check("scoped product delete removes 0 of A's rows (deleteProduct)", productDeleted.length === 0);
    check(
      "A's product still exists",
      (
        await runWithTenant(A.company.id, () =>
          db.select({ id: products.id }).from(products).where(eq(products.id, A.product.id)),
        )
      ).length === 1,
    );
    }); // end of tenant-B scope

    // ---- 4. Gated-upload classification. ------------------------------------
    check("order documents are gated by name", isGatedUploadName("c1/doc-abc.jpg"));
    check("document prefix recognised in a company folder", isDocumentUploadName("c9/doc-x.png"));
    check("payment slips are gated by name", isGatedUploadName("c1/slip-abc.jpg"));
    check("plain product photos are NOT gated", !isGatedUploadName("c1/abc.jpg"));

    // ---- 5. RLS: the database itself is the wall, not just the queries. -----
    // First the posture: a superuser or BYPASSRLS role walks straight through
    // every policy, which would leave all of the below silently inert.
    const posture = await db.execute(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    const role = posture.rows[0] as { rolsuper: boolean; rolbypassrls: boolean };
    check(
      "app role cannot bypass RLS",
      role.rolsuper === false && role.rolbypassrls === false,
      `rolsuper=${role.rolsuper} rolbypassrls=${role.rolbypassrls}`,
    );
    check(
      "RLS hides A's rows from tenant B even when asked for by id",
      (
        await runWithTenant(B.company.id, () =>
          db.select({ id: products.id }).from(products).where(eq(products.companyId, A.company.id)),
        )
      ).length === 0,
    );
    check(
      "RLS filters an UNSCOPED select down to tenant B's own rows",
      (
        await runWithTenant(B.company.id, () =>
          db.select({ companyId: products.companyId }).from(products),
        )
      ).every((r) => r.companyId === B.company.id),
    );
    check(
      "RLS with no tenant context returns no rows at all (fails closed)",
      (await db.select({ id: products.id }).from(products)).length === 0,
    );
    try {
      await runWithTenant(B.company.id, () =>
        db
          .insert(categories)
          .values({ companyId: A.company.id, nameEn: "smuggled", nameZh: "走私" }),
      );
      check("RLS rejects tenant B writing a row into company A", false, "insert was accepted");
    } catch (err) {
      const code =
        (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
      check("RLS rejects tenant B writing a row into company A", code === "42501", `error code ${code ?? "none"}`);
    }
  } finally {
    await destroyCompany(B.company.id);
    await destroyCompany(A.company.id);
    await pool.end();
  }

  console.log(failures === 0 ? "ISOLATION: ALL PASS" : `ISOLATION: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("isolation check failed to run:", err);
  process.exit(1);
});
