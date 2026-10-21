import { db, one } from "@/db";
import { contacts, contactImages } from "@/db/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { goodsOriginOf } from "@/lib/china-regions";

export async function getContactsByType(companyId: number, type: "supplier" | "client") {
  return db
    .select()
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), eq(contacts.type, type)))
    .orderBy(asc(contacts.companyName));
}

export async function getContactById(companyId: number, id: number) {
  return await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), eq(contacts.id, id)))
    .limit(1)
    .then(one);
}

/**
 * Suppliers for the product form's picker, newest first: at the market, the
 * supplier being assigned is almost always the one registered minutes ago.
 */
export async function getSuppliersForPicker(companyId: number) {
  return db
    .select({
      id: contacts.id,
      companyName: contacts.companyName,
      companyNameZh: contacts.companyNameZh,
      phone: contacts.phone,
      boothLocation: contacts.boothLocation,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.companyId, companyId),
        eq(contacts.type, "supplier"),
        eq(contacts.active, true),
      ),
    )
    .orderBy(desc(contacts.id));
}

/** All card photos for the given contacts, grouped by contact id and ordered. */
export async function getImagesByContact(contactIds: number[]) {
  const grouped = new Map<number, { id: number; path: string; kind: "card" | "qr" }[]>();
  if (contactIds.length === 0) return grouped;

  const rows = await db
    .select()
    .from(contactImages)
    .where(inArray(contactImages.contactId, contactIds))
    .orderBy(asc(contactImages.sortOrder), asc(contactImages.id));

  for (const row of rows) {
    const list = grouped.get(row.contactId) ?? [];
    list.push({ id: row.id, path: row.path, kind: row.kind });
    grouped.set(row.contactId, list);
  }
  return grouped;
}

/** Each supplier's 境内货源地 ("浙江省义乌市"), for the customs pack and the order's dossier. */
export async function getSupplierOrigins(companyId: number, supplierIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(supplierIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: contacts.id, province: contacts.province, city: contacts.city })
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), inArray(contacts.id, ids)));
  return new Map(rows.map((r) => [r.id, goodsOriginOf(r.province, r.city)]));
}
