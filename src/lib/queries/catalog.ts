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
  supplierId?: number;
  sort?: "price-asc" | "default";
  activeOnly?: boolean;
};

export async function getProducts(filters: ProductFilters = {}) {
  const conditions = [];
  if (filters.categoryId) {
    conditions.push(eq(products.categoryId, filters.categoryId));
  }
  if (filters.supplierId) {
    conditions.push(eq(products.supplierId, filters.supplierId));
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

/**
 * Ids of suppliers that actually have products in the catalog, so the filter
 * only ever offers a supplier that can return something. Suppliers registered
 * at a booth whose products were never saved would otherwise be dead ends.
 */
export async function getSupplierIdsInCatalog() {
  const rows = await db
    .selectDistinct({ supplierId: products.supplierId })
    .from(products)
    .all();
  return new Set(
    rows.map((r) => r.supplierId).filter((id): id is number => id !== null),
  );
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

/**
 * The next unused numeric SKU, padded to the width already in use.
 *
 * Purely a suggestion for the form: SKUs stay free-form, and anything that is
 * not a plain number is ignored when working out the next one.
 */
export async function suggestNextSku() {
  const rows = await db.select({ sku: products.sku }).from(products).all();
  const numeric = rows
    .map((r) => r.sku.trim())
    .filter((sku) => /^\d+$/.test(sku));

  if (numeric.length === 0) return "000001";

  const width = Math.max(...numeric.map((sku) => sku.length));
  const next = Math.max(...numeric.map((sku) => Number(sku))) + 1;
  return String(next).padStart(width, "0");
}
