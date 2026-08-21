"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { captureDrafts, captureDraftImages, contacts, contactImages } from "@/db/schema";
import { auth } from "@/lib/auth";
import { readDraft } from "@/lib/drafts";

async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  return Number(session.user.id);
}

/**
 * Runs the AI over a draft's photos again — for drafts that arrived while no
 * provider was reachable, or whose first read failed. Also the manual "read
 * again" after new categories were added that the first read didn't know.
 */
export async function retryReadDraft(id: number): Promise<void> {
  await requireSession();
  await readDraft(id);
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
  await requireSession();
  db.update(captureDrafts)
    .set({ status: "discarded", updatedAt: new Date().toISOString() })
    .where(eq(captureDrafts.id, id))
    .run();
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
  await requireSession();

  const draft = db.select().from(captureDrafts).where(eq(captureDrafts.id, id)).get();
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

  const inserted = db
    .insert(contacts)
    .values({
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
    .run();
  const contactId = Number(inserted.lastInsertRowid);

  // The photos move across rather than being copied: after this the contact
  // owns the files, the same as if the card had been saved online.
  const images = db
    .select()
    .from(captureDraftImages)
    .where(eq(captureDraftImages.draftId, id))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  images.forEach((image, i) => {
    db.insert(contactImages)
      .values({
        contactId,
        path: image.path,
        kind: image.role === "qr" ? "qr" : "card",
        sortOrder: i,
      })
      .run();
  });
  db.delete(captureDraftImages).where(eq(captureDraftImages.draftId, id)).run();

  db.update(captureDrafts)
    .set({ status: "imported", updatedAt: new Date().toISOString() })
    .where(eq(captureDrafts.id, id))
    .run();

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
