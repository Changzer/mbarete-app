"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, one } from "@/db";
import { productSuppliers, products, contacts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/authz";
import { logEntityEvent } from "@/lib/entity-log";
import { syncProductFromOffers } from "@/lib/queries/offers";

async function requireSession() {
  return await requireUser();
}

function refresh() {
  revalidatePath("/[locale]/catalog", "page");
  revalidatePath("/[locale]/catalog/[id]", "page");
  revalidatePath("/[locale]/orders/new", "page");
}

export type OfferActionResult = { error?: string };

const offerSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  productId: z.coerce.number().int().positive(),
  // Optional: a price whose source was never recorded is still worth keeping.
  supplierId: z
    .union([z.coerce.number().int().positive(), z.literal("")])
    .optional()
    .transform((v) => (typeof v === "number" ? v : null)),
  price: z.coerce.number().positive(),
  currency: z.string().trim().min(1).max(8).transform((s) => s.toUpperCase()),
  moq: z.coerce.number().int().min(1),
  // Never a deal breaker: most China lead times are the same 30 days.
  leadTimeDays: z.coerce.number().int().min(0).max(3650).default(0),
  quotedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(300).default(""),
});

export async function saveOffer(
  _prev: OfferActionResult | undefined,
  formData: FormData,
): Promise<OfferActionResult> {
  const user = await requireSession();
  const userId = user.id;

  const raw = Object.fromEntries(formData);
  if (!raw.id) delete raw.id; // empty means "new offer", not id 0
  const parsed = offerSchema.safeParse(raw);
  if (!parsed.success) return { error: "invalid" };
  const { id, productId, ...data } = parsed.data;

  // One supplier quotes one product once. A second row for the same factory
  // would make the card claim more sources than exist, so a re-quote is an
  // edit of the offer already there.
  // The product itself must belong to the caller's company before any offer
  // hangs off it.
  const product = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, user.companyId), eq(products.id, productId)))
    .limit(1)
    .then(one);
  if (!product) return { error: "missing" };

  // Only this company's suppliers can be quoted — the form posts a bare id.
  if (data.supplierId !== null) {
    const supplier = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.companyId, user.companyId),
          eq(contacts.id, data.supplierId),
          eq(contacts.type, "supplier"),
        ),
      )
      .limit(1)
      .then(one);
    if (!supplier) return { error: "invalid" };
  }

  if (data.supplierId !== null) {
    const rows = await db
      .select({ id: productSuppliers.id, supplierId: productSuppliers.supplierId })
      .from(productSuppliers)
      .where(eq(productSuppliers.productId, productId));
    const clash = rows.find((row) => row.supplierId === data.supplierId && row.id !== id);
    if (clash) return { error: "duplicate" };
  }

  if (id) {
    // Scope the lookup to the caller's company AND to the product just
    // validated as theirs: an offer id from another tenant is not found, and
    // an edit cannot be re-pointed at a different product than the one posted.
    const existing = await db
      .select({ id: productSuppliers.id })
      .from(productSuppliers)
      .where(
        and(
          eq(productSuppliers.id, id),
          eq(productSuppliers.companyId, user.companyId),
          eq(productSuppliers.productId, productId),
        ),
      )
      .limit(1)
      .then(one);
    if (!existing) return { error: "missing" };
    await db
      .update(productSuppliers)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(and(eq(productSuppliers.id, id), eq(productSuppliers.companyId, user.companyId)));
  } else {
    await db
      .insert(productSuppliers)
      .values({ companyId: user.companyId, productId, createdBy: userId, ...data });

    // The quote created from the registration form stood in for a source
    // nobody had recorded yet. Once a real supplier is named it has served
    // its purpose, so it steps aside rather than inflating the count of
    // factories selling this item. Deactivated, not deleted: it can come
    // back from the supplier list if it was actually somebody's price.
    if (data.supplierId !== null) {
      const offerRows = await db
        .select()
        .from(productSuppliers)
        .where(eq(productSuppliers.productId, productId));
      const placeholder = offerRows.find((o) => o.supplierId === null && o.active);
      if (placeholder) {
        await db.update(productSuppliers)
          .set({ active: false, updatedAt: new Date().toISOString() })
          .where(eq(productSuppliers.id, placeholder.id));
      }
    }
  }

  await syncProductFromOffers(user.companyId, productId);
  refresh();
  return {};
}

/**
 * Offers are deactivated, not deleted: an order was placed against this
 * price, and the catalog should still be able to explain why.
 */
export async function setOfferActive(offerId: number, active: boolean) {
  const user = await requireSession();
  const row = await db
    .select({ offer: productSuppliers, companyId: products.companyId })
    .from(productSuppliers)
    .innerJoin(products, eq(productSuppliers.productId, products.id))
    .where(eq(productSuppliers.id, offerId))
    .limit(1)
    .then(one);
  if (!row || row.companyId !== user.companyId) return;

  await db
    .update(productSuppliers)
    .set({ active, updatedAt: new Date().toISOString() })
    .where(and(eq(productSuppliers.id, offerId), eq(productSuppliers.companyId, user.companyId)));

  await syncProductFromOffers(user.companyId, row.offer.productId);
  refresh();
}

/** Same rule for suppliers themselves: deactivate, keep the history. */
export async function setSupplierActive(contactId: number, active: boolean) {
  const user = await requireSession();
  const row = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.companyId, user.companyId), eq(contacts.id, contactId)))
    .limit(1)
    .then(one);
  if (!row || row.active === active) return;
  await db
    .update(contacts)
    .set({ active })
    .where(and(eq(contacts.companyId, user.companyId), eq(contacts.id, contactId)));
  await logEntityEvent(user.companyId, "contact", contactId, user.id, "edited", {
    name: row.companyName || row.companyNameZh,
    changes: [{ field: active ? "activated" : "deactivated" }],
  });
  revalidatePath("/[locale]/contacts", "page");
  refresh();
}
