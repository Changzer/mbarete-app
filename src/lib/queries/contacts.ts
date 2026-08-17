import { db } from "@/db";
import { contacts } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

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
