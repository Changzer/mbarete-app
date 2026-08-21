import { db, one } from "@/db";
import { contacts, contactImages } from "@/db/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";

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
