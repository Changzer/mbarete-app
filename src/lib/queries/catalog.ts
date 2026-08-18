import { db } from "@/db";
import { products, categories, productImages } from "@/db/schema";
import { eq, asc, and, inArray } from "drizzle-orm";

export async function getCategories() {
  return db.select().from(categories).orderBy(asc(categories.nameEn)).all();
}

export async function getCategoryById(id: number) {
  return db.select().from(categories).where(eq(categories.id, id)).get();
}

export type ProductFilters = {
  categoryId?: number;
  sort?: "price-asc" | "default";
  activeOnly?: boolean;
};

export async function getProducts(filters: ProductFilters = {}) {
  const conditions = [];
  if (filters.categoryId) {
    conditions.push(eq(products.categoryId, filters.categoryId));
  }
  if (filters.activeOnly) {
    conditions.push(eq(products.active, true));
  }

  const query = db
    .select()
    .from(products)
    .where(conditions.length ? and(...conditions) : undefined);

  const rows = filters.sort === "price-asc"
    ? await query.orderBy(asc(products.price)).all()
    : await query.orderBy(asc(products.nameEn)).all();

  return rows;
}

export async function getProductById(id: number) {
  return db.select().from(products).where(eq(products.id, id)).get();
}

/** All images for the given products, grouped by product id and ordered. */
export async function getImagesByProduct(productIds: number[]) {
  const grouped = new Map<number, string[]>();
  if (productIds.length === 0) return grouped;

  const rows = await db
    .select()
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(asc(productImages.sortOrder), asc(productImages.id))
    .all();

  for (const row of rows) {
    const list = grouped.get(row.productId) ?? [];
    list.push(row.path);
    grouped.set(row.productId, list);
  }
  return grouped;
}

export async function getProductImages(productId: number) {
  return db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.sortOrder), asc(productImages.id))
    .all();
}
