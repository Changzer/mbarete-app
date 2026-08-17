"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contacts } from "@/db/schema";
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

export async function createContact(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireSession();

  let data;
  try {
    data = formToContactInput(formData);
  } catch {
    return "invalid";
  }

  db.insert(contacts).values(data).run();
  revalidatePath("/contacts");
  return undefined;
}

export async function updateContact(
  id: number,
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireSession();

  let data;
  try {
    data = formToContactInput(formData);
  } catch {
    return "invalid";
  }

  db.update(contacts).set(data).where(eq(contacts.id, id)).run();
  revalidatePath("/contacts");
  return undefined;
}

export async function deleteContact(id: number) {
  await requireSession();
  db.delete(contacts).where(eq(contacts.id, id)).run();
  revalidatePath("/contacts");
}
