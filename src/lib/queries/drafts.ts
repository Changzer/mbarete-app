import { and, desc, eq, inArray } from "drizzle-orm";
import { db, one } from "@/db";
import { captureDrafts, captureDraftImages, captureVisits, contacts, users } from "@/db/schema";
import { effectiveSupplierId } from "@/lib/capture-visits";
import type { TranscribedFields } from "@/lib/transcribe-product";
import type { TranscribedContactFields } from "@/lib/transcribe-card";

/** Either kind's AI reading; both sides are all-optional, so one type serves. */
export type DraftTranscript = TranscribedFields & TranscribedContactFields;

/** A draft as the drafts page shows it: row, photos, and who captured it. */
export type DraftListItem = {
  id: number;
  kind: "product" | "contact";
  status: "pending" | "read" | "imported" | "discarded";
  fields: Record<string, string>;
  transcript: DraftTranscript;
  transcriptNotes: string;
  transcriptError: string;
  productId: number | null;
  capturedAt: string;
  createdAt: string;
  userName: string | null;
  images: { id: number; path: string; role: "image" | "card" | "qr" }[];
  /** The booth visit (client id) this capture was taken under, if any. */
  visitId: string | null;
  /** A supplier set on this capture alone. */
  supplierId: number | null;
  /** The visit's approved supplier, if the visit has one. */
  visitSupplierId: number | null;
  /** What the capture resolves to: its own supplier, else the visit's. */
  effectiveSupplierId: number | null;
  effectiveSupplierName: string | null;
};

/** Supplier names for a set of ids, one query. */
async function supplierNames(companyId: number, ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: contacts.id, name: contacts.companyName, nameZh: contacts.companyNameZh })
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), inArray(contacts.id, unique)));
  return new Map(rows.map((r) => [r.id, r.name || r.nameZh]));
}

/** The visits behind a set of drafts, keyed by client visit id. */
async function visitsFor(companyId: number, visitIds: string[]): Promise<Map<string, { supplierId: number | null }>> {
  const unique = [...new Set(visitIds)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ clientVisitId: captureVisits.clientVisitId, supplierId: captureVisits.supplierId })
    .from(captureVisits)
    .where(and(eq(captureVisits.companyId, companyId), inArray(captureVisits.clientVisitId, unique)));
  return new Map(rows.map((r) => [r.clientVisitId, { supplierId: r.supplierId }]));
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Drafts still waiting for a decision — imported and discarded ones are done
 * and stay out of the way. Newest capture first: the agent reviewing tonight
 * cares about today.
 */
export async function getOpenDrafts(companyId: number): Promise<DraftListItem[]> {
  const rows = await db
    .select({
      draft: captureDrafts,
      userName: users.name,
    })
    .from(captureDrafts)
    .leftJoin(users, eq(captureDrafts.userId, users.id))
    .where(
      and(
        eq(captureDrafts.companyId, companyId),
        inArray(captureDrafts.status, ["pending", "read"]),
      ),
    )
    .orderBy(desc(captureDrafts.capturedAt));

  if (rows.length === 0) return [];

  const images = await db
    .select()
    .from(captureDraftImages)
    .where(
      inArray(
        captureDraftImages.draftId,
        rows.map((r) => r.draft.id),
      ),
    );

  const visits = await visitsFor(
    companyId,
    rows.map((r) => r.draft.visitId).filter((v): v is string => v !== null),
  );
  const names = await supplierNames(companyId, [
    ...rows.map((r) => r.draft.supplierId).filter((v): v is number => v !== null),
    ...[...visits.values()].map((v) => v.supplierId).filter((v): v is number => v !== null),
  ]);

  return rows.map(({ draft, userName }) => {
    const visit = draft.visitId ? visits.get(draft.visitId) : undefined;
    const effective = effectiveSupplierId(draft, visit);
    return {
      id: draft.id,
      kind: draft.kind,
      status: draft.status,
      fields: parseJson<Record<string, string>>(draft.fields, {}),
      transcript: parseJson<DraftTranscript>(draft.transcript, {}),
      transcriptNotes: draft.transcriptNotes,
      transcriptError: draft.transcriptError,
      productId: draft.productId,
      capturedAt: draft.capturedAt,
      createdAt: draft.createdAt,
      userName,
      images: images
        .filter((i) => i.draftId === draft.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({ id: i.id, path: i.path, role: i.role })),
      visitId: draft.visitId,
      supplierId: draft.supplierId,
      visitSupplierId: visit?.supplierId ?? null,
      effectiveSupplierId: effective,
      effectiveSupplierName: effective !== null ? (names.get(effective) ?? null) : null,
    };
  });
}

/** How many drafts are waiting — the number on the catalog page's chip. */
export async function countOpenDrafts(companyId: number): Promise<number> {
  const rows = await db
    .select({ id: captureDrafts.id })
    .from(captureDrafts)
    .where(
      and(
        eq(captureDrafts.companyId, companyId),
        inArray(captureDrafts.status, ["pending", "read"]),
      ),
    );
  return rows.length;
}

export async function getDraftById(
  companyId: number,
  id: number,
): Promise<DraftListItem | undefined> {
  const draft = await db
    .select()
    .from(captureDrafts)
    .where(and(eq(captureDrafts.companyId, companyId), eq(captureDrafts.id, id)))
    .limit(1)
    .then(one);
  if (!draft) return undefined;

  const images = await db
    .select()
    .from(captureDraftImages)
    .where(eq(captureDraftImages.draftId, id));
  const visits = await visitsFor(companyId, draft.visitId ? [draft.visitId] : []);
  const visit = draft.visitId ? visits.get(draft.visitId) : undefined;
  const effective = effectiveSupplierId(draft, visit);
  const names = await supplierNames(companyId, effective !== null ? [effective] : []);

  return {
    id: draft.id,
    kind: draft.kind,
    status: draft.status,
    fields: parseJson<Record<string, string>>(draft.fields, {}),
    transcript: parseJson<DraftTranscript>(draft.transcript, {}),
    transcriptNotes: draft.transcriptNotes,
    transcriptError: draft.transcriptError,
    productId: draft.productId,
    capturedAt: draft.capturedAt,
    createdAt: draft.createdAt,
    userName: null,
    images: images
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({ id: i.id, path: i.path, role: i.role })),
    visitId: draft.visitId,
    supplierId: draft.supplierId,
    visitSupplierId: visit?.supplierId ?? null,
    effectiveSupplierId: effective,
    effectiveSupplierName: effective !== null ? (names.get(effective) ?? null) : null,
  };
}
