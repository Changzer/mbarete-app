"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { db } from "@/db";
import { products, categories, productImages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { productSchema, categorySchema } from "@/lib/validators";
import { computeCbm } from "@/lib/calculations";
import { saveUploadedImage, deleteUpload } from "@/lib/uploads";

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

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");
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
    currency: formData.get("currency"),
    moq: formData.get("moq"),
    qtyPerBox: formData.get("qtyPerBox"),
    lengthCm: formData.get("lengthCm") || 0,
    widthCm: formData.get("widthCm") || 0,
    heightCm: formData.get("heightCm") || 0,
    weightKg: formData.get("weightKg") || 0,
    cbmOverride: formData.get("cbmOverride") || undefined,
    active: formData.get("active") === "on",
  });
}

export async function createProduct(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireSession();

  let data;
  try {
    data = formToProductInput(formData);
  } catch {
    return "invalid";
  }

  const cbm =
    data.cbmOverride && data.cbmOverride > 0
      ? data.cbmOverride
      : computeCbm(data.lengthCm, data.widthCm, data.heightCm);

  let uploaded: string[];
  try {
    uploaded = await saveUploadedImages(formData);
  } catch {
    return "image-error";
  }

  const inserted = db.insert(products)
    .values({
      sku: data.sku,
      nameEn: data.nameEn,
      nameZh: data.nameZh,
      categoryId: data.categoryId,
      descriptionEn: data.descriptionEn,
      descriptionZh: data.descriptionZh,
      price: data.price,
      currency: data.currency,
      moq: data.moq,
      qtyPerBox: data.qtyPerBox,
      lengthCm: data.lengthCm,
      widthCm: data.widthCm,
      heightCm: data.heightCm,
      weightKg: data.weightKg,
      cbm,
      active: data.active,
      updatedAt: new Date().toISOString(),
    })
    .run();

  const newProductId = Number(inserted.lastInsertRowid);
  uploaded.forEach((path, i) => {
    db.insert(productImages)
      .values({ productId: newProductId, path, sortOrder: i })
      .run();
  });

  revalidatePath("/catalog");
  redirect({ href: "/catalog", locale: (await getLocale()) as Locale });
}

export async function updateProduct(
  id: number,
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireSession();

  let data;
  try {
    data = formToProductInput(formData);
  } catch {
    return "invalid";
  }

  const cbm =
    data.cbmOverride && data.cbmOverride > 0
      ? data.cbmOverride
      : computeCbm(data.lengthCm, data.widthCm, data.heightCm);

  const existing = db.select().from(products).where(eq(products.id, id)).get();
  if (!existing) return "not-found";

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
      sku: data.sku,
      nameEn: data.nameEn,
      nameZh: data.nameZh,
      categoryId: data.categoryId,
      descriptionEn: data.descriptionEn,
      descriptionZh: data.descriptionZh,
      price: data.price,
      currency: data.currency,
      moq: data.moq,
      qtyPerBox: data.qtyPerBox,
      lengthCm: data.lengthCm,
      widthCm: data.widthCm,
      heightCm: data.heightCm,
      weightKg: data.weightKg,
      cbm,
      active: data.active,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(products.id, id))
    .run();

  revalidatePath("/catalog");
  redirect({ href: "/catalog", locale: (await getLocale()) as Locale });
}

export async function deleteProduct(id: number) {
  await requireSession();

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
