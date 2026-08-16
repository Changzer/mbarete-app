import { db } from "@/db";
import { products, categories } from "@/db/schema";
import { eq, asc, and } from "drizzle-orm";

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
