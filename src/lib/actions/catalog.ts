"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { db } from "@/db";
import { products, categories, productImages, orderItems, contacts } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { productSchema, categorySchema } from "@/lib/validators";
import {
  computeCbm,
  estimateCartonCbm,
  estimateCartonWeightKg,
} from "@/lib/calculations";
import { saveUploadedImage, deleteUpload } from "@/lib/uploads";
import { suggestNextSku } from "@/lib/queries/catalog";

/** Saves every non-empty file under `images`, preserving the chosen order. */
async function saveUploadedImages(formData: FormData) {
  const files = formData
    .getAll("images")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const paths: string[] = [];
  for (const file of files) {
    paths.push(await saveUploadedImage(file));
  }
  return paths;
}
import { auth } from "@/lib/auth";

/** Returns the signed-in user's id, so edits can be attributed to them. */
async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  return Number(session.user.id);
}

function formToProductInput(formData: FormData) {
  return productSchema.parse({
    sku: formData.get("sku"),
    nameEn: formData.get("nameEn"),
    nameZh: formData.get("nameZh"),
    categoryId: formData.get("categoryId"),
    descriptionEn: formData.get("descriptionEn") ?? "",
    descriptionZh: formData.get("descriptionZh") ?? "",
    price: formData.get("price"),
    sellPrice: formData.get("sellPrice") || 0,
    currency: formData.get("currency"),
    moq: formData.get("moq"),
    qtyPerBox: formData.get("qtyPerBox"),
    lengthCm: formData.get("lengthCm") || 0,
    widthCm: formData.get("widthCm") || 0,
    heightCm: formData.get("heightCm") || 0,
    weightKg: formData.get("weightKg") || 0,
    dimensionSource: formData.get("dimensionSource") || "carton",
    pieceLengthCm: formData.get("pieceLengthCm") || 0,
    pieceWidthCm: formData.get("pieceWidthCm") || 0,
    pieceHeightCm: formData.get("pieceHeightCm") || 0,
    pieceWeightKg: formData.get("pieceWeightKg") || 0,
    packingAllowancePct: formData.get("packingAllowancePct") ?? 15,
    cbmOverride: formData.get("cbmOverride") || undefined,
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
function resolveSupplierId(supplierId: number | undefined) {
  if (!supplierId) return null;
  const row = db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, supplierId), eq(contacts.type, "supplier")))
    .get();
  return row ? row.id : undefined;
}

/** Lineage is best-effort: a stale source product just means no link. */
function resolveDuplicatedFromId(duplicatedFromId: number | undefined) {
  if (!duplicatedFromId) return null;
  const row = db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, duplicatedFromId))
    .get();
  return row ? row.id : null;
}

type ProductInput = ReturnType<typeof formToProductInput>;

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
  const userId = await requireSession();

  let data;
  try {
    data = formToProductInput(formData);
  } catch {
    return "invalid";
  }

  const carton = resolveCartonFigures(data);

  const supplierId = resolveSupplierId(data.supplierId);
  if (supplierId === undefined) return "invalid";

  // Left blank on purpose, or cleared while entering products in a hurry.
  const sku = data.sku || (await suggestNextSku());
  if (db.select().from(products).where(eq(products.sku, sku)).get()) {
    return "duplicate-sku";
  }

  let uploaded: string[];
  try {
    uploaded = await saveUploadedImages(formData);
  } catch {
    return "image-error";
  }

  let inserted;
  try {
    inserted = db.insert(products)
    .values({
      sku,
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
      duplicatedFromId: resolveDuplicatedFromId(data.duplicatedFromId),
      active: data.active,
      createdBy: userId,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
      .run();
  } catch {
    // Two saves racing onto the same auto-assigned SKU: the loser retries by hand.
    for (const path of uploaded) await deleteUpload(path);
    return "duplicate-sku";
  }

  const newProductId = Number(inserted.lastInsertRowid);
  uploaded.forEach((path, i) => {
    db.insert(productImages)
      .values({ productId: newProductId, path, sortOrder: i })
      .run();
  });

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
  const userId = await requireSession();

  let data;
  try {
    data = formToProductInput(formData);
  } catch {
    return "invalid";
  }

  const carton = resolveCartonFigures(data);

  const supplierId = resolveSupplierId(data.supplierId);
  if (supplierId === undefined) return "invalid";

  const existing = db.select().from(products).where(eq(products.id, id)).get();
  if (!existing) return "not-found";

  const sku = data.sku || existing.sku;
  const clash = db
    .select()
    .from(products)
    .where(and(eq(products.sku, sku), ne(products.id, id)))
    .get();
  if (clash) return "duplicate-sku";

  // Images the user ticked for removal in the form.
  const removeIds = formData
    .getAll("removeImageIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  for (const imageId of removeIds) {
    const row = db
      .select()
      .from(productImages)
      .where(eq(productImages.id, imageId))
      .get();
    if (row && row.productId === id) {
      db.delete(productImages).where(eq(productImages.id, imageId)).run();
      await deleteUpload(row.path);
    }
  }

  let uploaded: string[];
  try {
    uploaded = await saveUploadedImages(formData);
  } catch {
    return "image-error";
  }

  const remaining = db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, id))
    .all();
  uploaded.forEach((path, i) => {
    db.insert(productImages)
      .values({ productId: id, path, sortOrder: remaining.length + i })
      .run();
  });

  db.update(products)
    .set({
      sku,
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
    .where(eq(products.id, id))
    .run();

  revalidatePath("/catalog");
  redirect({ href: "/catalog", locale: (await getLocale()) as Locale });
}

export async function deleteProduct(id: number): Promise<string | undefined> {
  await requireSession();

  // A product on an order is history, not clutter: deleting it would strip
  // the name and SKU off every order that bought it (and the foreign key
  // blocks it anyway). Deactivating hides it from the catalog instead.
  const onOrder = db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.productId, id))
    .get();
  if (onOrder) return "on-orders";

  // Rows cascade, but the files on disk would be orphaned otherwise.
  const images = db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, id))
    .all();

  db.delete(products).where(eq(products.id, id)).run();
  for (const image of images) {
    await deleteUpload(image.path);
  }

  revalidatePath("/catalog");
  return undefined;
}

export async function createCategory(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireSession();

  let data;
  try {
    data = categorySchema.parse({
      nameEn: formData.get("nameEn"),
      nameZh: formData.get("nameZh"),
    });
  } catch {
    return "invalid";
  }

  db.insert(categories).values(data).run();
  revalidatePath("/catalog");
  return undefined;
}

export async function deleteCategory(id: number) {
  await requireSession();
  db.delete(categories).where(eq(categories.id, id)).run();
  revalidatePath("/catalog");
}
