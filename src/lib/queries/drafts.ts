import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { captureDrafts, captureDraftImages, users } from "@/db/schema";
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
};

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
export async function getOpenDrafts(): Promise<DraftListItem[]> {
  const rows = db
    .select({
      draft: captureDrafts,
      userName: users.name,
    })
    .from(captureDrafts)
    .leftJoin(users, eq(captureDrafts.userId, users.id))
    .where(inArray(captureDrafts.status, ["pending", "read"]))
    .orderBy(desc(captureDrafts.capturedAt))
    .all();

  if (rows.length === 0) return [];

  const images = db
    .select()
    .from(captureDraftImages)
    .where(
      inArray(
        captureDraftImages.draftId,
        rows.map((r) => r.draft.id),
      ),
    )
    .all();

  return rows.map(({ draft, userName }) => ({
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
  }));
}

/** How many drafts are waiting — the number on the catalog page's chip. */
export async function countOpenDrafts(): Promise<number> {
  return db
    .select({ id: captureDrafts.id })
    .from(captureDrafts)
    .where(inArray(captureDrafts.status, ["pending", "read"]))
    .all().length;
}

export async function getDraftById(id: number): Promise<DraftListItem | undefined> {
  const draft = db.select().from(captureDrafts).where(eq(captureDrafts.id, id)).get();
  if (!draft) return undefined;

  const images = db
    .select()
    .from(captureDraftImages)
    .where(eq(captureDraftImages.draftId, id))
    .all();

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
  };
}
