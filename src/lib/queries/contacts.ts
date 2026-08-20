import { db } from "@/db";
import { contacts, contactImages } from "@/db/schema";
import { eq, desc, asc, inArray } from "drizzle-orm";

export async function getContactsByType(type: "supplier" | "client") {
  return db
    .select()
    .from(contacts)
    .where(eq(contacts.type, type))
    .orderBy(asc(contacts.companyName))
    .all();
}

export async function getContactById(id: number) {
  return db.select().from(contacts).where(eq(contacts.id, id)).get();
}

/**
 * Suppliers for the product form's picker, newest first: at the market, the
 * supplier being assigned is almost always the one registered minutes ago.
 */
export async function getSuppliersForPicker() {
  return db
    .select({
      id: contacts.id,
      companyName: contacts.companyName,
      companyNameZh: contacts.companyNameZh,
      phone: contacts.phone,
      boothLocation: contacts.boothLocation,
    })
    .from(contacts)
    .where(eq(contacts.type, "supplier"))
    .orderBy(desc(contacts.id))
    .all();
}

/** All card photos for the given contacts, grouped by contact id and ordered. */
export async function getImagesByContact(contactIds: number[]) {
  const grouped = new Map<number, { id: number; path: string }[]>();
  if (contactIds.length === 0) return grouped;

  const rows = db
    .select()
    .from(contactImages)
    .where(inArray(contactImages.contactId, contactIds))
    .orderBy(asc(contactImages.sortOrder), asc(contactImages.id))
    .all();

  for (const row of rows) {
    const list = grouped.get(row.contactId) ?? [];
    list.push({ id: row.id, path: row.path });
    grouped.set(row.contactId, list);
  }
  return grouped;
}
