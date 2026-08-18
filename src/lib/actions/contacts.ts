"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contacts, orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { contactSchema } from "@/lib/validators";
import { auth } from "@/lib/auth";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");
}

function formToContactInput(formData: FormData) {
  return contactSchema.parse({
    type: formData.get("type"),
    companyName: formData.get("companyName"),
    contactPerson: formData.get("contactPerson") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    whatsapp: formData.get("whatsapp") ?? "",
    wechat: formData.get("wechat") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

/** `id` is returned so a caller can immediately select what it just created. */
export type ContactActionResult = { error?: string; id?: number };

export async function createContact(
  _prevState: ContactActionResult | undefined,
  formData: FormData,
): Promise<ContactActionResult> {
  await requireSession();

  let data;
  try {
    data = formToContactInput(formData);
  } catch {
    return { error: "invalid" };
  }

  const inserted = db.insert(contacts).values(data).run();
  revalidatePath("/contacts");
  revalidatePath("/orders");
  return { id: Number(inserted.lastInsertRowid) };
}

export async function updateContact(
  id: number,
  _prevState: ContactActionResult | undefined,
  formData: FormData,
): Promise<ContactActionResult> {
  await requireSession();

  let data;
  try {
    data = formToContactInput(formData);
  } catch {
    return { error: "invalid" };
  }

  db.update(contacts).set(data).where(eq(contacts.id, id)).run();
  revalidatePath("/contacts");
  revalidatePath("/orders");
  return { id };
}

export async function deleteContact(id: number): Promise<string | undefined> {
  await requireSession();

  // A client with orders is part of the books; deleting the row would tear
  // the name off every one of them (and the foreign key blocks it anyway).
  const hasOrders = db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.clientId, id))
    .get();
  if (hasOrders) return "has-orders";

  db.delete(contacts).where(eq(contacts.id, id)).run();
  revalidatePath("/contacts");
  return undefined;
}
