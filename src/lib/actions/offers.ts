"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { productSuppliers, contacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/authz";
import { syncProductFromOffers } from "@/lib/queries/offers";

async function requireSession() {
  return (await requireUser()).id;
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
  const userId = await requireSession();

  const raw = Object.fromEntries(formData);
  if (!raw.id) delete raw.id; // empty means "new offer", not id 0
  const parsed = offerSchema.safeParse(raw);
  if (!parsed.success) return { error: "invalid" };
  const { id, productId, ...data } = parsed.data;

  // One supplier quotes one product once. A second row for the same factory
  // would make the card claim more sources than exist, so a re-quote is an
  // edit of the offer already there.
  if (data.supplierId !== null) {
    const clash = db
      .select({ id: productSuppliers.id, supplierId: productSuppliers.supplierId })
      .from(productSuppliers)
      .where(eq(productSuppliers.productId, productId))
      .all()
      .find((row) => row.supplierId === data.supplierId && row.id !== id);
    if (clash) return { error: "duplicate" };
  }

  if (id) {
    const existing = db
      .select({ id: productSuppliers.id })
      .from(productSuppliers)
      .where(eq(productSuppliers.id, id))
      .get();
    if (!existing) return { error: "missing" };
    db.update(productSuppliers)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(productSuppliers.id, id))
      .run();
  } else {
    db.insert(productSuppliers)
      .values({ productId, createdBy: userId, ...data })
      .run();

    // The quote created from the registration form stood in for a source
    // nobody had recorded yet. Once a real supplier is named it has served
    // its purpose, so it steps aside rather than inflating the count of
    // factories selling this item. Deactivated, not deleted: it can come
    // back from the supplier list if it was actually somebody's price.
    if (data.supplierId !== null) {
      const placeholder = db
        .select()
        .from(productSuppliers)
        .where(eq(productSuppliers.productId, productId))
        .all()
        .find((o) => o.supplierId === null && o.active);
      if (placeholder) {
        db.update(productSuppliers)
          .set({ active: false, updatedAt: new Date().toISOString() })
          .where(eq(productSuppliers.id, placeholder.id))
          .run();
      }
    }
  }

  await syncProductFromOffers(productId);
  refresh();
  return {};
}

/**
 * Offers are deactivated, not deleted: an order was placed against this
 * price, and the catalog should still be able to explain why.
 */
export async function setOfferActive(offerId: number, active: boolean) {
  await requireSession();
  const row = db
    .select()
    .from(productSuppliers)
    .where(eq(productSuppliers.id, offerId))
    .get();
  if (!row) return;

  db.update(productSuppliers)
    .set({ active, updatedAt: new Date().toISOString() })
    .where(eq(productSuppliers.id, offerId))
    .run();

  await syncProductFromOffers(row.productId);
  refresh();
}

/** Same rule for suppliers themselves: deactivate, keep the history. */
export async function setSupplierActive(contactId: number, active: boolean) {
  await requireSession();
  db.update(contacts).set({ active }).where(eq(contacts.id, contactId)).run();
  revalidatePath("/[locale]/contacts", "page");
  refresh();
}
