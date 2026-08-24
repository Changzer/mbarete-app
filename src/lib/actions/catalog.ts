"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { db, one } from "@/db";
import {
  products,
  categories,
  productImages,
  orderItems,
  productSuppliers,
  contacts,
  captureDrafts,
  captureDraftImages,
} from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { productSchema, categorySchema } from "@/lib/validators";
import {
  computeCbm,
  estimateCartonCbm,
  estimateCartonWeightKg,
} from "@/lib/calculations";
import {
  saveUploadedImage,
  deleteUpload,
  isSafeUploadName,
  uploadCompanyId,
  uploadsDir,
} from "@/lib/uploads";
import fs from "node:fs/promises";
import nodePath from "node:path";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { suggestNextSku } from "@/lib/queries/catalog";
import { syncProductFromOffers } from "@/lib/queries/offers";

/** Saves every non-empty file under `images`, preserving the chosen order. */
async function saveUploadedImages(companyId: number, formData: FormData) {
  const files = formData
    .getAll("images")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const paths: string[] = [];
  for (const file of files) {
    paths.push(await saveUploadedImage(companyId, file));
  }
  return paths;
}
import { requireUser, requireAdmin } from "@/lib/authz";
import { logEntityEvent, diffProductEdit } from "@/lib/entity-log";

/** The signed-in user, for attribution and tenant scoping alike. */
async function requireSession() {
  return await requireUser();
}

function productLogName(row: { sku: string; nameEn: string }) {
  return `${row.sku} ${row.nameEn}`.trim();
}

async function categoryNameOf(id: number) {
  const row = await db.select().from(categories).where(eq(categories.id, id)).limit(1).then(one);
  return row ? row.nameEn || row.nameZh : "—";
}

async function supplierNameOf(id: number | null) {
  if (!id) return "—";
  const row = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1).then(one);
  return row ? row.companyName || row.companyNameZh : "—";
}

function formToProductInput(formData: FormData) {
  // Decimal fields are text inputs (comma-locale keyboards), normalized here
  // before validation: "10,20" -> "10.20", "1,200" -> "1200".
  const dec = (v: FormDataEntryValue | null) =>
    typeof v === "string" ? normalizeDecimalInput(v) : v;
  return productSchema.parse({
    sku: formData.get("sku"),
    supplierCode: formData.get("supplierCode") ?? "",
    nameEn: formData.get("nameEn"),
    nameZh: formData.get("nameZh"),
    categoryId: formData.get("categoryId"),
    descriptionEn: formData.get("descriptionEn") ?? "",
    descriptionZh: formData.get("descriptionZh") ?? "",
    // Market-floor captures may carry no price yet: blank means "not quoted",
    // stored as 0 and visibly missing, never a reason to block the save.
    price: dec(formData.get("price")) || 0,
    sellPrice: dec(formData.get("sellPrice")) || 0,
    currency: formData.get("currency"),
    moq: formData.get("moq") || 1,
    qtyPerBox: formData.get("qtyPerBox") || 1,
    lengthCm: dec(formData.get("lengthCm")) || 0,
    widthCm: dec(formData.get("widthCm")) || 0,
    heightCm: dec(formData.get("heightCm")) || 0,
    weightKg: dec(formData.get("weightKg")) || 0,
    dimensionSource: formData.get("dimensionSource") || "carton",
    pieceLengthCm: dec(formData.get("pieceLengthCm")) || 0,
    pieceWidthCm: dec(formData.get("pieceWidthCm")) || 0,
    pieceHeightCm: dec(formData.get("pieceHeightCm")) || 0,
    pieceWeightKg: dec(formData.get("pieceWeightKg")) || 0,
    packingAllowancePct: dec(formData.get("packingAllowancePct")) ?? 15,
    cbmOverride: dec(formData.get("cbmOverride")) || undefined,
    supplierId: formData.get("supplierId") || undefined,
    duplicatedFromId: formData.get("duplicatedFromId") || undefined,
    active: formData.get("active") === "on",
  });
}

/**
 * The posted supplier id, verified against the database — a form can post any
 * number, so it must point at a real supplier contact before it is stored.
 * Returns null for "no supplier", undefined when the id doesn't check out.
 */
async function resolveSupplierId(companyId: number, supplierId: number | undefined) {
  if (!supplierId) return null;
  const row = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.companyId, companyId),
        eq(contacts.id, supplierId),
        eq(contacts.type, "supplier"),
      ),
    )
    .limit(1)
    .then(one);
  return row ? row.id : undefined;
}

/** Lineage is best-effort: a stale source product just means no link. */
async function resolveDuplicatedFromId(companyId: number, duplicatedFromId: number | undefined) {
  if (!duplicatedFromId) return null;
  const row = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.id, duplicatedFromId)))
    .limit(1)
    .then(one);
  return row ? row.id : null;
}

type ProductInput = ReturnType<typeof formToProductInput>;

/**
 * The transcription pass saves its cropped thumbnail to the uploads volume
 * and the form posts the path back on save. A posted path is a claim: it only
 * sticks when it names a thumb file inside THIS company's folder that really
 * exists. Anything else quietly stores no thumbnail.
 */
async function resolveThumbPath(companyId: number, formData: FormData): Promise<string> {
  const posted = formData.get("thumbPath");
  if (typeof posted !== "string" || !posted || posted.length > 300) return "";
  const filename = posted.replace(/^\/uploads\//, "");
  if (!isSafeUploadName(filename)) return "";
  if (uploadCompanyId(filename) !== companyId) return "";
  if (!filename.replace(/^c\d+\//, "").startsWith("thumb-")) return "";
  const stat = await fs
    .stat(nodePath.join(/* turbopackIgnore: true */ uploadsDir(), filename))
    .catch(() => null);
  return stat?.isFile() ? posted : "";
}

/**
 * The carton figures to store, whichever way the product was registered.
 *
 * Order calculations only ever read the carton columns, so piece-mode
 * products are converted here and nothing downstream needs to know the
 * difference. The piece values are kept alongside so the form round-trips and
 * the estimate can be recalculated if pieces per carton changes.
 */
function resolveCartonFigures(data: ProductInput) {
  if (data.dimensionSource === "piece") {
    const piece = {
      lengthCm: data.pieceLengthCm,
      widthCm: data.pieceWidthCm,
      heightCm: data.pieceHeightCm,
    };
    return {
      // No carton was measured, so there are no carton dimensions to show.
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      weightKg: estimateCartonWeightKg(
        data.pieceWeightKg,
        data.qtyPerBox,
        data.packingAllowancePct,
      ),
      cbm:
        data.cbmOverride && data.cbmOverride > 0
          ? data.cbmOverride
          : estimateCartonCbm(piece, data.qtyPerBox, data.packingAllowancePct),
      dimensionSource: "piece" as const,
      pieceLengthCm: data.pieceLengthCm,
      pieceWidthCm: data.pieceWidthCm,
      pieceHeightCm: data.pieceHeightCm,
      pieceWeightKg: data.pieceWeightKg,
      packingAllowancePct: data.packingAllowancePct,
    };
  }

  return {
    lengthCm: data.lengthCm,
    widthCm: data.widthCm,
    heightCm: data.heightCm,
    weightKg: data.weightKg,
    cbm:
      data.cbmOverride && data.cbmOverride > 0
        ? data.cbmOverride
        : computeCbm(data.lengthCm, data.widthCm, data.heightCm),
    dimensionSource: "carton" as const,
    pieceLengthCm: 0,
    pieceWidthCm: 0,
    pieceHeightCm: 0,
    pieceWeightKg: 0,
    packingAllowancePct: data.packingAllowancePct,
  };
}

export async function createProduct(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const user = await requireSession();
  const userId = user.id;

  let data;
  try {
    data = formToProductInput(formData);
  } catch (error) {
    // "invalid" on the phone is undebuggable without the server knowing why.
    console.error("[product] form rejected:", error);
    return "invalid";
  }

  const carton = resolveCartonFigures(data);

  const supplierId = await resolveSupplierId(user.companyId, data.supplierId);
  if (supplierId === undefined) {
    console.error("[product] rejected: supplier", data.supplierId, "not visible to company", user.companyId);
    return "invalid";
  }

  // A form can post any category id; only this company's count.
  const category = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.companyId, user.companyId), eq(categories.id, data.categoryId)))
    .limit(1)
    .then(one);
  if (!category) {
    console.error("[product] rejected: category", data.categoryId, "not visible to company", user.companyId);
    return "invalid";
  }

  // Left blank on purpose, or cleared while entering products in a hurry.
  const sku = data.sku || (await suggestNextSku(user.companyId));
  const skuClash = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, user.companyId), eq(products.sku, sku)))
    .limit(1)
    .then(one);
  if (skuClash) {
    return "duplicate-sku";
  }

  let uploaded: string[];
  try {
    uploaded = await saveUploadedImages(user.companyId, formData);
  } catch {
    return "image-error";
  }

  let inserted;
  try {
    [inserted] = await db
      .insert(products)
      .values({
        companyId: user.companyId,
        sku,
        supplierCode: data.supplierCode,
        thumbPath: await resolveThumbPath(user.companyId, formData),
        nameEn: data.nameEn,
      nameZh: data.nameZh,
      categoryId: data.categoryId,
      descriptionEn: data.descriptionEn,
      descriptionZh: data.descriptionZh,
      price: data.price,
      sellPrice: data.sellPrice,
      currency: data.currency,
      moq: data.moq,
      qtyPerBox: data.qtyPerBox,
      ...carton,
      supplierId,
      duplicatedFromId: await resolveDuplicatedFromId(user.companyId, data.duplicatedFromId),
      active: data.active,
      createdBy: userId,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
      .returning({ id: products.id });
  } catch {
    // Two saves racing onto the same auto-assigned SKU: the loser retries by hand.
    for (const path of uploaded) await deleteUpload(path);
    return "duplicate-sku";
  }

  const newProductId = inserted.id;

  await logEntityEvent(user.companyId, "product", newProductId, userId, "created", {
    name: productLogName({ sku, nameEn: data.nameEn }),
  });

  // The price typed on the registration form becomes the product's first
  // supplier quote, credited to whichever supplier the form named. Left
  // unrecorded when it named none — honest about knowing a price but not
  // its source, and a real supplier can be attached later.
  await db.insert(productSuppliers)
    .values({
      companyId: user.companyId,
      productId: newProductId,
      supplierId,
      price: data.price,
      currency: data.currency,
      moq: data.moq,
      quotedOn: new Date().toISOString().slice(0, 10),
      createdBy: userId,
    });

  for (const [i, path] of uploaded.entries()) {
    await db
      .insert(productImages)
      .values({ companyId: user.companyId, productId: newProductId, path, sortOrder: i });
  }

  // Saving from a capture draft (photos taken offline at a booth): the photos
  // are already on disk under the draft, so they move across instead of being
  // uploaded again, and the draft is settled so it leaves the review queue.
  const draftId = Number(formData.get("draftId"));
  if (Number.isFinite(draftId) && draftId > 0) {
    const draft = await db
      .select()
      .from(captureDrafts)
      .where(and(eq(captureDrafts.companyId, user.companyId), eq(captureDrafts.id, draftId)))
      .limit(1)
      .then(one);
    // Only an open draft is promotable — a second save of the same review tab
    // must not steal photos from the product the first save created.
    if (draft && (draft.status === "pending" || draft.status === "read")) {
      const draftImageRows = await db
        .select()
        .from(captureDraftImages)
        .where(eq(captureDraftImages.draftId, draftId));
      const draftImages = draftImageRows.sort((a, b) => a.sortOrder - b.sortOrder);
      for (const [i, image] of draftImages.entries()) {
        await db.insert(productImages).values({
          companyId: user.companyId,
          productId: newProductId,
          path: image.path,
          sortOrder: uploaded.length + i,
        });
      }
      await db.delete(captureDraftImages).where(eq(captureDraftImages.draftId, draftId));
      await db.update(captureDrafts)
        .set({
          status: "imported",
          productId: newProductId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(captureDrafts.id, draftId));
      revalidatePath("/catalog/drafts");
    }
  }

  revalidatePath("/catalog");

  // Entering a run of products from one supplier: straight back to a blank
  // form, keeping the category — and the supplier, so a whole booth can be
  // registered without re-picking the vendor on every item.
  const locale = (await getLocale()) as Locale;
  if (formData.get("andAnother")) {
    const sticky = supplierId ? `&supplier=${supplierId}` : "";
    redirect({ href: `/catalog/new?category=${data.categoryId}${sticky}`, locale });
  }
  redirect({ href: "/catalog", locale });
}

export async function updateProduct(
  id: number,
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const user = await requireSession();
  const userId = user.id;

  let data;
  try {
    data = formToProductInput(formData);
  } catch (error) {
    // "invalid" on the phone is undebuggable without the server knowing why.
    console.error("[product] form rejected:", error);
    return "invalid";
  }

  const carton = resolveCartonFigures(data);

  const supplierId = await resolveSupplierId(user.companyId, data.supplierId);
  if (supplierId === undefined) {
    console.error("[product] rejected: supplier", data.supplierId, "not visible to company", user.companyId);
    return "invalid";
  }

  // A form can post any category id; only this company's count.
  const category = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.companyId, user.companyId), eq(categories.id, data.categoryId)))
    .limit(1)
    .then(one);
  if (!category) {
    console.error("[product] rejected: category", data.categoryId, "not visible to company", user.companyId);
    return "invalid";
  }

  const existing = await db
    .select()
    .from(products)
    .where(and(eq(products.companyId, user.companyId), eq(products.id, id)))
    .limit(1)
    .then(one);
  if (!existing) return "not-found";

  const sku = data.sku || existing.sku;
  const clash = await db
    .select()
    .from(products)
    .where(
      and(eq(products.companyId, user.companyId), eq(products.sku, sku), ne(products.id, id)),
    )
    .limit(1)
    .then(one);
  if (clash) return "duplicate-sku";

  // Images the user ticked for removal in the form.
  const removeIds = formData
    .getAll("removeImageIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  for (const imageId of removeIds) {
    const row = await db
      .select()
      .from(productImages)
      .where(eq(productImages.id, imageId))
      .limit(1)
      .then(one);
    if (row && row.productId === id) {
      await db.delete(productImages).where(eq(productImages.id, imageId));
      await deleteUpload(row.path);
    }
  }

  let uploaded: string[];
  try {
    uploaded = await saveUploadedImages(user.companyId, formData);
  } catch {
    return "image-error";
  }

  const remaining = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, id));
  for (const [i, path] of uploaded.entries()) {
    await db
      .insert(productImages)
      .values({ companyId: user.companyId, productId: id, path, sortOrder: remaining.length + i });
  }

  // A fresh crop replaces the old thumbnail; no crop this save keeps the old.
  const newThumb = await resolveThumbPath(user.companyId, formData);
  if (newThumb && existing.thumbPath && newThumb !== existing.thumbPath) {
    await deleteUpload(existing.thumbPath);
  }

  await db.update(products)
    .set({
      sku,
      supplierCode: data.supplierCode,
      thumbPath: newThumb || existing.thumbPath,
      nameEn: data.nameEn,
      nameZh: data.nameZh,
      categoryId: data.categoryId,
      descriptionEn: data.descriptionEn,
      descriptionZh: data.descriptionZh,
      price: data.price,
      sellPrice: data.sellPrice,
      currency: data.currency,
      moq: data.moq,
      qtyPerBox: data.qtyPerBox,
      ...carton,
      // Lineage (duplicatedFromId) is deliberately not editable here: it
      // records where a row came from, not something to maintain by hand.
      supplierId,
      active: data.active,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(products.companyId, user.companyId), eq(products.id, id)));

  // The diff wants display names; resolve the four that can appear before
  // handing it plain lookups.
  const categoryNames = new Map<number, string>();
  for (const categoryId of new Set([existing.categoryId, data.categoryId])) {
    categoryNames.set(categoryId, await categoryNameOf(categoryId));
  }
  const supplierNames = new Map<number | null, string>();
  for (const sid of new Set([existing.supplierId, supplierId])) {
    supplierNames.set(sid, await supplierNameOf(sid));
  }
  const changes = diffProductEdit(
    existing,
    { ...data, sku, ...carton, supplierId },
    (categoryId) => categoryNames.get(categoryId) ?? "—",
    (sid) => supplierNames.get(sid) ?? "—",
  );
  if (changes.length > 0) {
    await logEntityEvent(user.companyId, "product", id, userId, "edited", {
      name: productLogName({ sku, nameEn: data.nameEn }),
      changes,
    });
  }

  // The product form carries one supplier and one price, so it edits that
  // supplier's quote — keeping the simple one-supplier case behaving exactly
  // as it always did. Comparing several factories is the supplier section's
  // job, and quotes it owns are never rewritten from here.
  const quotes = await db
    .select()
    .from(productSuppliers)
    .where(eq(productSuppliers.productId, id));
  const terms = {
    price: data.price,
    currency: data.currency,
    moq: data.moq,
    updatedAt: new Date().toISOString(),
  };
  const forThisSupplier = quotes.find((o) => o.supplierId === supplierId);
  const onlyQuote = quotes.length === 1 ? quotes[0] : undefined;

  if (forThisSupplier) {
    await db.update(productSuppliers)
      .set(terms)
      .where(eq(productSuppliers.id, forThisSupplier.id));
  } else if (onlyQuote) {
    // Naming a supplier on a product that had a single unattributed quote
    // credits that quote rather than leaving a duplicate behind.
    await db.update(productSuppliers)
      .set({ ...terms, supplierId })
      .where(eq(productSuppliers.id, onlyQuote.id));
  } else {
    await db.insert(productSuppliers)
      .values({
        companyId: user.companyId,
        productId: id,
        supplierId,
        ...terms,
        quotedOn: new Date().toISOString().slice(0, 10),
        createdBy: userId,
      });
  }
  await syncProductFromOffers(user.companyId, id);

  revalidatePath("/catalog");
  redirect({ href: "/catalog", locale: (await getLocale()) as Locale });
}

export async function deleteProduct(id: number): Promise<string | undefined> {
  const admin = await requireAdmin();

  const existing = await db
    .select()
    .from(products)
    .where(and(eq(products.companyId, admin.companyId), eq(products.id, id)))
    .limit(1)
    .then(one);
  if (!existing) return undefined;

  // A product on an order is history, not clutter: deleting it would strip
  // the name and SKU off every order that bought it (and the foreign key
  // blocks it anyway). Deactivating hides it from the catalog instead.
  const onOrder = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.productId, id))
    .limit(1)
    .then(one);
  if (onOrder) return "on-orders";

  // Rows cascade, but the files on disk would be orphaned otherwise.
  const images = await db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, id));

  // Drafts that became this product keep existing, but their link is cleared
  // by hand: the composite tenant FK deliberately has no SET NULL action.
  await db
    .update(captureDrafts)
    .set({ productId: null })
    .where(eq(captureDrafts.productId, id));

  await db.delete(products).where(and(eq(products.companyId, admin.companyId), eq(products.id, id)));
  for (const image of images) {
    await deleteUpload(image.path);
  }
  if (existing.thumbPath) await deleteUpload(existing.thumbPath);

  await logEntityEvent(admin.companyId, "product", id, admin.id, "deleted", {
    name: productLogName(existing),
  });

  revalidatePath("/catalog");
  return undefined;
}

export async function createCategory(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const user = await requireSession();

  let data;
  try {
    data = categorySchema.parse({
      nameEn: formData.get("nameEn"),
      nameZh: formData.get("nameZh"),
    });
  } catch {
    return "invalid";
  }

  await db.insert(categories).values({ ...data, companyId: user.companyId });
  revalidatePath("/catalog");
  return undefined;
}

export async function deleteCategory(id: number): Promise<string | undefined> {
  const admin = await requireAdmin();

  // Products carry a required category, so the foreign key would reject this
  // with a raw constraint error. Check first and say what is actually wrong:
  // move those products to another category, then delete this one.
  const inUse = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.categoryId, id))
    .limit(1)
    .then(one);
  if (inUse) return "has-products";

  await db
    .delete(categories)
    .where(and(eq(categories.companyId, admin.companyId), eq(categories.id, id)));
  revalidatePath("/catalog");
  return undefined;
}
