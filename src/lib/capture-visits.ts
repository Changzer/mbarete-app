import { and, desc, eq, sql } from "drizzle-orm";
import { db, one } from "@/db";
import { captureDrafts, captureDraftImages, captureVisits, contacts } from "@/db/schema";
import { findSimilarContact, type MatchCandidate } from "@/lib/contact-match";
import { transcribeBusinessCard, type TranscribedContactFields } from "@/lib/transcribe-card";
import { reserveAiRead } from "@/lib/ai-budget";
import { recordAiUsage } from "@/lib/ai-usage";
import { loadStoredImages } from "@/lib/drafts";
import { logEntityEvent } from "@/lib/entity-log";

/** `db` or a transaction: both select and insert the same way. */
type Queryer = Pick<typeof db, "select" | "insert">;

/**
 * Booth visits and the supplier decision that lives on them.
 *
 * The rule the whole feature rests on: a capture's supplier is its OWN
 * supplier when one was set on it, else its visit's. That is a join, not a
 * copy — so approving a visit's supplier today applies to the three captures
 * still on a phone that arrive tomorrow, without anyone re-running
 * anything. Every read of "which supplier" goes through effectiveSupplierId.
 */

export function effectiveSupplierId(
  draft: { supplierId: number | null },
  visit: { supplierId: number | null } | null | undefined,
): number | null {
  return draft.supplierId ?? visit?.supplierId ?? null;
}

/** An active supplier contact of this company, or nothing. */
export async function supplierVisibleTo(
  companyId: number,
  supplierId: number,
  q: Queryer = db,
): Promise<boolean> {
  const row = await q
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.companyId, companyId),
        eq(contacts.id, supplierId),
        eq(contacts.type, "supplier"),
        eq(contacts.active, true),
      ),
    )
    .limit(1)
    .then(one);
  return Boolean(row);
}

/**
 * The visit row for a delivered capture — created by whichever capture of
 * the visit lands first. A supplier the phone knew is recorded only when
 * the visit has none yet: a decision already made on the server is never
 * overwritten by a late delivery from the field.
 */
export async function upsertVisit(
  q: Queryer,
  input: {
    companyId: number;
    clientVisitId: string;
    startedAt: string;
    supplierId: number | null;
    userId: number | null;
  },
): Promise<void> {
  await q
    .insert(captureVisits)
    .values({
      companyId: input.companyId,
      clientVisitId: input.clientVisitId,
      startedAt: input.startedAt,
      supplierId: input.supplierId,
      createdBy: input.userId,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [captureVisits.companyId, captureVisits.clientVisitId],
      set: {
        supplierId: sql`COALESCE(${captureVisits.supplierId}, EXCLUDED.supplier_id)`,
        updatedAt: new Date().toISOString(),
      },
    });
}

export type VisitRow = typeof captureVisits.$inferSelect;

export async function getVisit(companyId: number, clientVisitId: string): Promise<VisitRow | undefined> {
  return db
    .select()
    .from(captureVisits)
    .where(and(eq(captureVisits.companyId, companyId), eq(captureVisits.clientVisitId, clientVisitId)))
    .limit(1)
    .then(one);
}

/**
 * The reviewer's decision for a visit. Null clears it — the correction
 * path for a supplier assigned by mistake. Captures with their own
 * supplier are untouched by either; that is what "override" means.
 */
export async function setVisitSupplier(input: {
  companyId: number;
  clientVisitId: string;
  supplierId: number | null;
  userId: number;
}): Promise<"ok" | "no-visit" | "no-supplier"> {
  if (input.supplierId !== null && !(await supplierVisibleTo(input.companyId, input.supplierId))) {
    return "no-supplier";
  }
  const updated = await db
    .update(captureVisits)
    .set({
      supplierId: input.supplierId,
      decidedBy: input.userId,
      decidedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(captureVisits.companyId, input.companyId),
        eq(captureVisits.clientVisitId, input.clientVisitId),
      ),
    )
    .returning({ id: captureVisits.id });
  return updated.length ? "ok" : "no-visit";
}

/** A supplier on one capture, overriding its visit; null returns it to the visit. */
export async function setDraftSupplier(input: {
  companyId: number;
  draftId: number;
  supplierId: number | null;
}): Promise<"ok" | "no-draft" | "no-supplier"> {
  if (input.supplierId !== null && !(await supplierVisibleTo(input.companyId, input.supplierId))) {
    return "no-supplier";
  }
  const updated = await db
    .update(captureDrafts)
    .set({ supplierId: input.supplierId, updatedAt: new Date().toISOString() })
    .where(and(eq(captureDrafts.companyId, input.companyId), eq(captureDrafts.id, input.draftId)))
    .returning({ id: captureDrafts.id });
  return updated.length ? "ok" : "no-draft";
}

export type SupplierReading = {
  fields: TranscribedContactFields;
  notes: string | null;
  /** An existing supplier the reading matches by phone or name, if any. */
  match: MatchCandidate | null;
  /** The image the reading came from — kept as the evidence reference. */
  imageId: number;
  draftId: number;
};

/**
 * Reads a supplier off one of a capture's photos — the card lying beside
 * the product, or the booth sign. Nothing is written: the reading and a
 * possible match against existing suppliers come back for a person to
 * approve, because an uncertain match must never quietly attach a visit's
 * products to the wrong vendor. The photo itself stays where it is, the
 * original evidence untouched.
 */
export async function identifySupplierFromImage(input: {
  companyId: number;
  userId: number;
  imageId: number;
}): Promise<{ ok: true; reading: SupplierReading } | { ok: false; error: "no-image" | "limit" | "failed" }> {
  const image = await db
    .select({
      id: captureDraftImages.id,
      path: captureDraftImages.path,
      draftId: captureDraftImages.draftId,
    })
    .from(captureDraftImages)
    .where(
      and(eq(captureDraftImages.companyId, input.companyId), eq(captureDraftImages.id, input.imageId)),
    )
    .limit(1)
    .then(one);
  if (!image) return { ok: false, error: "no-image" };

  const payload = await loadStoredImages([image.path]);
  if (payload.length === 0) return { ok: false, error: "no-image" };

  const budget = await reserveAiRead({ companyId: input.companyId, userId: input.userId });
  if (budget !== "ok") return { ok: false, error: "limit" };

  let result;
  try {
    result = await transcribeBusinessCard(payload, (usage) =>
      recordAiUsage({
        companyId: input.companyId,
        userId: input.userId,
        kind: "card",
        images: 1,
        ...usage,
      }),
    );
  } catch {
    return { ok: false, error: "failed" };
  }
  if (!result.ok) return { ok: false, error: "failed" };

  const candidates: MatchCandidate[] = await db
    .select({
      id: contacts.id,
      companyName: contacts.companyName,
      companyNameZh: contacts.companyNameZh,
      phone: contacts.phone,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.companyId, input.companyId),
        eq(contacts.type, "supplier"),
        eq(contacts.active, true),
      ),
    )
    .orderBy(desc(contacts.id));
  const match = findSimilarContact(candidates, result.fields) ?? null;

  return {
    ok: true,
    reading: { fields: result.fields, notes: result.notes, match, imageId: image.id, draftId: image.draftId },
  };
}

/**
 * A new supplier from an approved reading. The evidence photo is not
 * copied: it stays on the capture it was taken with, and the contact's
 * notes say where the details came from, so the original is always one
 * click away and never exists twice on disk.
 */
export async function createSupplierFromReading(input: {
  companyId: number;
  userId: number;
  fields: TranscribedContactFields;
  evidenceDraftId: number;
}): Promise<number> {
  const f = input.fields;
  const companyName =
    f.companyName?.trim() || f.companyNameZh?.trim() || `Supplier ${new Date().toISOString().slice(0, 10)}`;
  const [row] = await db
    .insert(contacts)
    .values({
      companyId: input.companyId,
      type: "supplier",
      companyName,
      companyNameZh: f.companyNameZh ?? "",
      contactPerson: f.contactPerson ?? "",
      phone: f.phone ?? "",
      email: f.email ?? "",
      whatsapp: f.whatsapp ?? "",
      wechat: f.wechat ?? "",
      boothLocation: f.boothLocation ?? "",
      bankInfo: f.bankInfo ?? "",
      notes: `Identified from capture photo (draft #${input.evidenceDraftId}).`,
    })
    .returning({ id: contacts.id });
  await logEntityEvent(input.companyId, "contact", row.id, input.userId, "created", {
    name: companyName,
  });
  return row.id;
}
