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
