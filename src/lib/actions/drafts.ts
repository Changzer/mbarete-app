"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, one } from "@/db";
import { captureDrafts, captureDraftImages, contacts, contactImages } from "@/db/schema";
import { requireUser } from "@/lib/authz";
import { readDraft } from "@/lib/drafts";
import { logEntityEvent } from "@/lib/entity-log";

async function requireSession() {
  return await requireUser();
}

/**
 * Runs the AI over a draft's photos again — for drafts that arrived while no
 * provider was reachable, or whose first read failed. Also the manual "read
 * again" after new categories were added that the first read didn't know.
 */
export async function retryReadDraft(id: number): Promise<void> {
  const user = await requireSession();
  await readDraft(user.companyId, id);
  revalidatePath("/catalog/drafts");
}

/**
 * Puts a draft out of the review queue by hand.
 *
 * The row and its photos stay: "discarded" is a state, not a deletion,
 * because the one thing this whole feature promises is that a capture that
 * reached the server is never lost to a slip of the thumb.
 */
export async function discardDraft(id: number): Promise<void> {
  const user = await requireSession();
  await db
    .update(captureDrafts)
    .set({ status: "discarded", updatedAt: new Date().toISOString() })
    .where(and(eq(captureDrafts.companyId, user.companyId), eq(captureDrafts.id, id)));
  revalidatePath("/catalog/drafts");
}

/**
 * Turns a contact draft into a real contact in one step.
 *
 * Contacts are simple enough not to need a review form: the AI transcript
 * fills what it read off the card, the typed fields win where both exist, and
 * the card photos move across as the system of record — exactly what saving
 * the live contact form would have produced. Anything misread is fixed
 * afterwards in the normal contact editor, with the card right there.
 */
export async function importContactDraft(id: number): Promise<string | undefined> {
  const user = await requireSession();

  const draft = await db
    .select()
    .from(captureDrafts)
    .where(and(eq(captureDrafts.companyId, user.companyId), eq(captureDrafts.id, id)))
    .limit(1)
    .then(one);
  if (!draft || draft.kind !== "contact") return "invalid";
  if (draft.status !== "pending" && draft.status !== "read") return "invalid";

  const fields = parseRecord(draft.fields);
  const transcript = parseRecord(draft.transcript);
  // What was typed at the booth beats what the AI read off the card; an
  // empty typed field falls through to the reading (`||`, not `??` — the
  // form posts "" for every field nobody filled in).
  const merged = (name: string) => fields[name] || transcript[name] || "";

  const type = fields.type === "client" ? "client" : "supplier";
  const companyName =
    merged("companyName") ||
    merged("companyNameZh") ||
    // The card was captured but nothing legible came back: the contact still
    // gets created — the photos are the point — under a name that says what
    // it is and when it was photographed, for the human to fix.
    `Card ${draft.capturedAt.slice(0, 10)}`;

  const [insertedContact] = await db
    .insert(contacts)
    .values({
      companyId: user.companyId,
      type,
      companyName,
      companyNameZh: merged("companyNameZh"),
      contactPerson: merged("contactPerson"),
      phone: merged("phone"),
      email: merged("email"),
      whatsapp: merged("whatsapp"),
      wechat: merged("wechat"),
      boothLocation: merged("boothLocation"),
      bankInfo: merged("bankInfo"),
      notes: merged("notes"),
    })
    .returning({ id: contacts.id });
  const contactId = insertedContact.id;

  // The photos move across rather than being copied: after this the contact
  // owns the files, the same as if the card had been saved online.
  const imageRows = await db
    .select()
    .from(captureDraftImages)
    .where(eq(captureDraftImages.draftId, id));
  const images = imageRows.sort((a, b) => a.sortOrder - b.sortOrder);
  for (const [i, image] of images.entries()) {
    await db.insert(contactImages).values({
      companyId: user.companyId,
      contactId,
      path: image.path,
      kind: image.role === "qr" ? "qr" : "card",
      sortOrder: i,
    });
  }

  await logEntityEvent(user.companyId, "contact", contactId, user.id, "created", {
    name: companyName,
  });
  await db.delete(captureDraftImages).where(eq(captureDraftImages.draftId, id));

  await db.update(captureDrafts)
    .set({ status: "imported", updatedAt: new Date().toISOString() })
    .where(eq(captureDrafts.id, id));

  revalidatePath("/catalog/drafts");
  revalidatePath("/contacts");
  return undefined;
}

function parseRecord(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
  } catch {
    return {};
  }
}

// ------------------------------------------------------------ suppliers ---

import {
  createSupplierFromReading,
  identifySupplierFromImage,
  setDraftSupplier,
  setVisitSupplier,
  type SupplierReading,
} from "@/lib/capture-visits";
import { z } from "zod";

/**
 * The reviewer's decision for a booth visit. Every capture of the visit
 * that has no supplier of its own resolves to it — the ones already here
 * and the ones still on a phone. Null clears a mistaken assignment.
 */
export async function assignVisitSupplier(
  clientVisitId: string,
  supplierId: number | null,
): Promise<string | undefined> {
  const user = await requireSession();
  const result = await setVisitSupplier({
    companyId: user.companyId,
    clientVisitId,
    supplierId,
    userId: user.id,
  });
  if (result !== "ok") return result;
  revalidatePath("/catalog/drafts");
  return undefined;
}

/** A supplier on one capture, overriding its visit; null returns it to the visit. */
export async function assignDraftSupplier(
  draftId: number,
  supplierId: number | null,
): Promise<string | undefined> {
  const user = await requireSession();
  const result = await setDraftSupplier({ companyId: user.companyId, draftId, supplierId });
  if (result !== "ok") return result;
  revalidatePath("/catalog/drafts");
  return undefined;
}

/** Reads a supplier off one capture photo. Nothing is written; see capture-visits.ts. */
export async function identifySupplier(
  imageId: number,
): Promise<{ ok: true; reading: SupplierReading } | { ok: false; error: string }> {
  const user = await requireSession();
  const result = await identifySupplierFromImage({
    companyId: user.companyId,
    userId: user.id,
    imageId,
  });
  return result;
}

const readingSchema = z.object({
  companyName: z.string().trim().max(200).optional(),
  companyNameZh: z.string().trim().max(200).optional(),
  contactPerson: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(200).optional(),
  email: z.string().trim().max(200).optional(),
  whatsapp: z.string().trim().max(200).optional(),
  wechat: z.string().trim().max(200).optional(),
  boothLocation: z.string().trim().max(400).optional(),
  bankInfo: z.string().trim().max(1000).optional(),
});

/**
 * The person approved a reading: use the matched supplier, or create one
 * from the reading, then attach it to the visit (or to the one capture,
 * when it has no visit). The approval is the only path from a reading to
 * an association — the AI never makes it on its own.
 */
export async function approveSupplierReading(input: {
  clientVisitId: string | null;
  draftId: number;
  useExistingId: number | null;
  fields: unknown;
}): Promise<{ supplierId?: number; error?: string }> {
  const user = await requireSession();
  let supplierId = input.useExistingId;
  if (supplierId === null) {
    const parsed = readingSchema.safeParse(input.fields ?? {});
    if (!parsed.success) return { error: "invalid" };
    supplierId = await createSupplierFromReading({
      companyId: user.companyId,
      userId: user.id,
      fields: parsed.data,
      evidenceDraftId: input.draftId,
    });
  }
  const result = input.clientVisitId
    ? await setVisitSupplier({
        companyId: user.companyId,
        clientVisitId: input.clientVisitId,
        supplierId,
        userId: user.id,
      })
    : await setDraftSupplier({ companyId: user.companyId, draftId: input.draftId, supplierId });
  if (result !== "ok") return { error: result };
  revalidatePath("/catalog/drafts");
  revalidatePath("/contacts");
  return { supplierId };
}
