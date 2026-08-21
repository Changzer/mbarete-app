"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contacts, contactImages, orders, products } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { contactSchema } from "@/lib/validators";
import { saveUploadedImage, deleteUpload } from "@/lib/uploads";
import { requireUser, requireAdmin } from "@/lib/authz";
import { logEntityEvent, diffContactEdit } from "@/lib/entity-log";

async function requireSession() {
  return (await requireUser()).id;
}

function formToContactInput(formData: FormData) {
  return contactSchema.parse({
    type: formData.get("type"),
    companyName: formData.get("companyName"),
    companyNameZh: formData.get("companyNameZh") ?? "",
    contactPerson: formData.get("contactPerson") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    whatsapp: formData.get("whatsapp") ?? "",
    wechat: formData.get("wechat") ?? "",
    boothLocation: formData.get("boothLocation") ?? "",
    bankInfo: formData.get("bankInfo") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

/** Saves every non-empty file under `cardImages`, preserving the chosen order. */
async function saveCardImages(formData: FormData) {
  const files = formData
    .getAll("cardImages")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const paths: string[] = [];
  for (const file of files) {
    paths.push(await saveUploadedImage(file));
  }
  return paths;
}

/** The WeChat QR cropped out of a card in the browser, if one was found. */
async function saveQrImage(formData: FormData) {
  const file = formData.get("qrImage");
  if (!(file instanceof File) || file.size === 0) return null;
  return saveUploadedImage(file);
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
  const userId = await requireSession();

  let data;
  try {
    data = formToContactInput(formData);
  } catch {
    return { error: "invalid" };
  }

  let uploaded: string[];
  try {
    uploaded = await saveCardImages(formData);
  } catch {
    return { error: "image-error" };
  }

  let qrPath: string | null;
  try {
    qrPath = await saveQrImage(formData);
  } catch {
    return { error: "image-error" };
  }

  const inserted = db.insert(contacts).values(data).run();
  const contactId = Number(inserted.lastInsertRowid);
  uploaded.forEach((path, i) => {
    db.insert(contactImages).values({ contactId, path, sortOrder: i }).run();
  });
  if (qrPath) {
    db.insert(contactImages).values({ contactId, path: qrPath, kind: "qr" }).run();
  }

  logEntityEvent("contact", contactId, userId, "created", { name: contactLogName(data) });

  revalidatePath("/contacts");
  revalidatePath("/orders");
  return { id: contactId };
}

export async function updateContact(
  id: number,
  _prevState: ContactActionResult | undefined,
  formData: FormData,
): Promise<ContactActionResult> {
  const userId = await requireSession();

  let data;
  try {
    data = formToContactInput(formData);
  } catch {
    return { error: "invalid" };
  }

  const existing = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!existing) return { error: "invalid" };

  // Card photos the user ticked for removal in the form.
  const removeIds = formData
    .getAll("removeImageIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  for (const imageId of removeIds) {
    const row = db
      .select()
      .from(contactImages)
      .where(eq(contactImages.id, imageId))
      .get();
    if (row && row.contactId === id) {
      db.delete(contactImages).where(eq(contactImages.id, imageId)).run();
      await deleteUpload(row.path);
    }
  }

  let uploaded: string[];
  try {
    uploaded = await saveCardImages(formData);
  } catch {
    return { error: "image-error" };
  }

  let qrPath: string | null;
  try {
    qrPath = await saveQrImage(formData);
  } catch {
    return { error: "image-error" };
  }
  if (qrPath) {
    // A contact has one current QR: a re-scan replaces the previous crop.
    const oldQrs = db
      .select()
      .from(contactImages)
      .where(and(eq(contactImages.contactId, id), eq(contactImages.kind, "qr")))
      .all();
    for (const old of oldQrs) {
      db.delete(contactImages).where(eq(contactImages.id, old.id)).run();
      await deleteUpload(old.path);
    }
    db.insert(contactImages).values({ contactId: id, path: qrPath, kind: "qr" }).run();
  }

  const remaining = db
    .select()
    .from(contactImages)
    .where(eq(contactImages.contactId, id))
    .all();
  uploaded.forEach((path, i) => {
    db.insert(contactImages)
      .values({ contactId: id, path, sortOrder: remaining.length + i })
      .run();
  });

  db.update(contacts).set(data).where(eq(contacts.id, id)).run();

  const changes = diffContactEdit(existing, data);
  if (changes.length > 0) {
    logEntityEvent("contact", id, userId, "edited", {
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

  const existing = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!existing) return undefined;

  // A client with orders is part of the books; deleting the row would tear
  // the name off every one of them (and the foreign key blocks it anyway).
  const hasOrders = db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.clientId, id))
    .get();
  if (hasOrders) return "has-orders";

  // Same for a supplier the catalog points at: unlinking dozens of products
  // from the vendor you still need to pay and find is not a tidy-up.
  const hasProducts = db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.supplierId, id))
    .get();
  if (hasProducts) return "has-products";

  // Rows cascade, but the card photos on disk would be orphaned otherwise.
  const images = db
    .select()
    .from(contactImages)
    .where(eq(contactImages.contactId, id))
    .all();

  db.delete(contacts).where(eq(contacts.id, id)).run();
  for (const image of images) {
    await deleteUpload(image.path);
  }

  logEntityEvent("contact", id, admin.id, "deleted", { name: contactLogName(existing) });

  revalidatePath("/contacts");
  return undefined;
}
