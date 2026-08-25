"use server";

import { revalidatePath } from "next/cache";
import { db, one } from "@/db";
import { contacts, contactImages, orders, products } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { contactSchema } from "@/lib/validators";
import { saveUploadedImage, deleteUpload } from "@/lib/uploads";
import { requireUser, requireAdmin } from "@/lib/authz";
import { logEntityEvent, diffContactEdit } from "@/lib/entity-log";

async function requireSession() {
  return await requireUser();
}

function formToContactInput(formData: FormData) {
  const data = contactSchema.parse({
    type: formData.get("type"),
    companyName: formData.get("companyName"),
    companyNameZh: formData.get("companyNameZh") ?? "",
    taxId: formData.get("taxId") ?? "",
    contactPerson: formData.get("contactPerson") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    whatsapp: formData.get("whatsapp") ?? "",
    wechat: formData.get("wechat") ?? "",
    boothLocation: formData.get("boothLocation") ?? "",
    bankInfo: formData.get("bankInfo") ?? "",
    notes: formData.get("notes") ?? "",
  });
  // A capture may arrive with only a Chinese name or only a person — the
  // stored English slot is backfilled so no list ever shows a blank row.
  if (!data.companyName) data.companyName = data.companyNameZh || data.contactPerson;
  return data;
}

/** Saves every non-empty file under `cardImages`, preserving the chosen order. */
async function saveCardImages(companyId: number, formData: FormData) {
  const files = formData
    .getAll("cardImages")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const paths: string[] = [];
  for (const file of files) {
    paths.push(await saveUploadedImage(companyId, file));
  }
  return paths;
}

/** The WeChat QR cropped out of a card in the browser, if one was found. */
async function saveQrImage(companyId: number, formData: FormData) {
  const file = formData.get("qrImage");
  if (!(file instanceof File) || file.size === 0) return null;
  return saveUploadedImage(companyId, file);
}

function contactLogName(row: { companyName: string; companyNameZh: string }) {
  return row.companyName || row.companyNameZh;
}

/** `id` is returned so a caller can immediately select what it just created. */
export type ContactActionResult = { error?: string; id?: number };

export async function createContact(
  _prevState: ContactActionResult | undefined,
  formData: FormData,
): Promise<ContactActionResult> {
  const user = await requireSession();

  let data;
  try {
    data = formToContactInput(formData);
  } catch {
    return { error: "invalid" };
  }

  let uploaded: string[];
  try {
    uploaded = await saveCardImages(user.companyId, formData);
  } catch {
    return { error: "image-error" };
  }

  let qrPath: string | null;
  try {
    qrPath = await saveQrImage(user.companyId, formData);
  } catch {
    return { error: "image-error" };
  }

  const [inserted] = await db
    .insert(contacts)
    .values({ ...data, companyId: user.companyId })
    .returning({ id: contacts.id });
  const contactId = inserted.id;
  for (const [i, path] of uploaded.entries()) {
    await db
      .insert(contactImages)
      .values({ companyId: user.companyId, contactId, path, sortOrder: i });
  }
  if (qrPath) {
    await db
      .insert(contactImages)
      .values({ companyId: user.companyId, contactId, path: qrPath, kind: "qr" });
  }

  await logEntityEvent(user.companyId, "contact", contactId, user.id, "created", {
    name: contactLogName(data),
  });

  revalidatePath("/contacts");
  revalidatePath("/orders");
  return { id: contactId };
}

export async function updateContact(
  id: number,
  _prevState: ContactActionResult | undefined,
  formData: FormData,
): Promise<ContactActionResult> {
  const user = await requireSession();

  let data;
  try {
    data = formToContactInput(formData);
  } catch {
    return { error: "invalid" };
  }

  const existing = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.companyId, user.companyId), eq(contacts.id, id)))
    .limit(1)
    .then(one);
  if (!existing) return { error: "invalid" };

  // Card photos the user ticked for removal in the form.
  const removeIds = formData
    .getAll("removeImageIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  for (const imageId of removeIds) {
    const row = await db
      .select()
      .from(contactImages)
      .where(eq(contactImages.id, imageId))
      .limit(1)
      .then(one);
    if (row && row.contactId === id) {
      await db.delete(contactImages).where(eq(contactImages.id, imageId));
      await deleteUpload(row.path);
    }
  }

  let uploaded: string[];
  try {
    uploaded = await saveCardImages(user.companyId, formData);
  } catch {
    return { error: "image-error" };
  }

  let qrPath: string | null;
  try {
    qrPath = await saveQrImage(user.companyId, formData);
  } catch {
    return { error: "image-error" };
  }
  if (qrPath) {
    // A contact has one current QR: a re-scan replaces the previous crop.
    const oldQrs = await db
      .select()
      .from(contactImages)
      .where(and(eq(contactImages.contactId, id), eq(contactImages.kind, "qr")));
    for (const old of oldQrs) {
      await db.delete(contactImages).where(eq(contactImages.id, old.id));
      await deleteUpload(old.path);
    }
    await db
      .insert(contactImages)
      .values({ companyId: user.companyId, contactId: id, path: qrPath, kind: "qr" });
  }

  const remaining = await db
    .select()
    .from(contactImages)
    .where(eq(contactImages.contactId, id));
  for (const [i, path] of uploaded.entries()) {
    await db
      .insert(contactImages)
      .values({ companyId: user.companyId, contactId: id, path, sortOrder: remaining.length + i });
  }

  await db
    .update(contacts)
    .set(data)
    .where(and(eq(contacts.companyId, user.companyId), eq(contacts.id, id)));

  const changes = diffContactEdit(existing, data);
  if (changes.length > 0) {
    await logEntityEvent(user.companyId, "contact", id, user.id, "edited", {
      name: contactLogName(data),
      changes,
    });
  }

  revalidatePath("/contacts");
  revalidatePath("/orders");
  return { id };
}

export async function deleteContact(id: number): Promise<string | undefined> {
  const admin = await requireAdmin();

  const existing = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.companyId, admin.companyId), eq(contacts.id, id)))
    .limit(1)
    .then(one);
  if (!existing) return undefined;

  // A client with orders is part of the books; deleting the row would tear
  // the name off every one of them (and the foreign key blocks it anyway).
  const hasOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.clientId, id))
    .limit(1)
    .then(one);
  if (hasOrders) return "has-orders";

  // Same for a supplier the catalog points at: unlinking dozens of products
  // from the vendor you still need to pay and find is not a tidy-up.
  const hasProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.supplierId, id))
    .limit(1)
    .then(one);
  if (hasProducts) return "has-products";

  // Rows cascade, but the card photos on disk would be orphaned otherwise.
  const images = await db
    .select()
    .from(contactImages)
    .where(eq(contactImages.contactId, id));

  await db.delete(contacts).where(and(eq(contacts.companyId, admin.companyId), eq(contacts.id, id)));
  for (const image of images) {
    await deleteUpload(image.path);
  }

  await logEntityEvent(admin.companyId, "contact", id, admin.id, "deleted", {
    name: contactLogName(existing),
  });

  revalidatePath("/contacts");
  return undefined;
}
