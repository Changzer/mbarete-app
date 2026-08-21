import path from "node:path";
import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { captureDrafts, captureDraftImages } from "@/db/schema";
import { saveUploadedImage, deleteUpload, uploadsDir, CONTENT_TYPES } from "@/lib/uploads";
import { getCategories } from "@/lib/queries/catalog";
import {
  isTranscriptionEnabled,
  transcribeProductPhotos,
  MAX_TRANSCRIBE_IMAGES,
  type TranscribeImage,
} from "@/lib/transcribe-product";
import { transcribeBusinessCard } from "@/lib/transcribe-card";

/**
 * Storing a capture that came off a phone, and reading it once there is a
 * connection to read it with.
 *
 * The two halves are deliberately separate. Storing has to succeed on the
 * worst link the trip can offer, so it does nothing but write files and a row.
 * Reading talks to an AI provider over the internet — the very thing that was
 * missing at the booth — so it runs afterwards, is allowed to fail, and can be
 * retried without the capture ever being at risk.
 */

export type IngestResult =
  | { ok: true; draftId: number; duplicate: boolean }
  | { ok: false; error: "invalid" | "image-error" };

export type DraftImageRole = "image" | "card" | "qr";
export type IngestFile = { file: File; role: DraftImageRole };

/**
 * Writes one capture to disk and to the database, or hands back the row that
 * is already there.
 *
 * `clientId` carries the whole idempotency story. On a market network the
 * request that reached the server and whose response died on the way back is
 * routine, so the phone retries; the retry finds this row and is told the
 * capture is safe instead of making a second one. The lookup runs before any
 * file is written, so a replay does not litter the uploads directory either.
 */
export async function ingestDraft(input: {
  clientId: string;
  kind: "product" | "contact";
  capturedAt: string;
  fields: Record<string, string>;
  files: IngestFile[];
  userId: number;
}): Promise<IngestResult> {
  if (!input.clientId.trim()) return { ok: false, error: "invalid" };
  if (!input.capturedAt.trim()) return { ok: false, error: "invalid" };

  const existing = db
    .select({ id: captureDrafts.id })
    .from(captureDrafts)
    .where(eq(captureDrafts.clientId, input.clientId))
    .get();
  if (existing) return { ok: true, draftId: existing.id, duplicate: true };

  const paths: { path: string; role: DraftImageRole }[] = [];
  try {
    for (const { file, role } of input.files) {
      paths.push({ path: await saveUploadedImage(file), role });
    }
  } catch {
    for (const stored of paths) await deleteUpload(stored.path);
    return { ok: false, error: "image-error" };
  }

  let draftId: number;
  try {
    const inserted = db
      .insert(captureDrafts)
      .values({
        clientId: input.clientId,
        kind: input.kind,
        userId: input.userId,
        fields: JSON.stringify(input.fields),
        capturedAt: input.capturedAt,
        updatedAt: new Date().toISOString(),
      })
      .run();
    draftId = Number(inserted.lastInsertRowid);
  } catch {
    // Two deliveries of the same capture raced and the other won. The capture
    // is stored either way, which is all the phone needs to hear.
    for (const stored of paths) await deleteUpload(stored.path);
    const row = db
      .select({ id: captureDrafts.id })
      .from(captureDrafts)
      .where(eq(captureDrafts.clientId, input.clientId))
      .get();
    return row
      ? { ok: true, draftId: row.id, duplicate: true }
      : { ok: false, error: "invalid" };
  }

  paths.forEach((stored, i) => {
    db.insert(captureDraftImages)
      .values({ draftId, path: stored.path, role: stored.role, sortOrder: i })
      .run();
  });

  return { ok: true, draftId, duplicate: false };
}

/** Same ceiling the transcription action uses, so both refuse the same photos. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const VISION_TYPES = new Set<TranscribeImage["mediaType"]>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Runs the AI over a stored draft's photos and keeps the reading beside them.
 *
 * Never throws, and never touches the photos: a draft whose reading failed is
 * still a complete capture, and the failure is written down so the drafts page
 * can offer a retry rather than hide the problem. The reading only pre-fills
 * the product form later — nothing here decides anything about the catalog.
 */
export async function readDraft(draftId: number): Promise<void> {
  const draft = db.select().from(captureDrafts).where(eq(captureDrafts.id, draftId)).get();
  // "read" is allowed through again: re-reading picks up categories that were
  // created after the first pass. Imported and discarded drafts are settled.
  if (!draft || (draft.status !== "pending" && draft.status !== "read")) return;
  if (!isTranscriptionEnabled()) return;

  // The QR crop is a contact method, not something to read text out of, so
  // it never goes to the model — same as the live contact form.
  const images = db
    .select()
    .from(captureDraftImages)
    .where(eq(captureDraftImages.draftId, draftId))
    .all()
    .filter((i) => i.role !== "qr")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, MAX_TRANSCRIBE_IMAGES);
  if (images.length === 0) return;

  const payload = await loadStoredImages(images.map((i) => i.path));
  if (payload.length === 0) {
    recordReadFailure(draftId, "image-missing");
    return;
  }

  try {
    let fields: object;
    let notes: string | null;
    if (draft.kind === "contact") {
      const result = await transcribeBusinessCard(payload);
      if (!result.ok) {
        recordReadFailure(draftId, result.error);
        return;
      }
      fields = result.fields;
      notes = result.notes;
    } else {
      const categories = await getCategories();
      const result = await transcribeProductPhotos(
        payload,
        categories.map((c) => ({ id: c.id, nameEn: c.nameEn, nameZh: c.nameZh })),
      );
      if (!result.ok) {
        recordReadFailure(draftId, result.error);
        return;
      }
      fields = result.fields;
      notes = result.notes;
    }
    db.update(captureDrafts)
      .set({
        status: "read",
        transcript: JSON.stringify(fields),
        transcriptNotes: notes ?? "",
        transcriptError: "",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(captureDrafts.id, draftId))
      .run();
  } catch {
    // Network trouble, a refused request, malformed output — all the same to
    // the drafts page, which offers one retry button either way.
    recordReadFailure(draftId, "failed");
  }
}

function recordReadFailure(draftId: number, error: string) {
  db.update(captureDrafts)
    .set({ transcriptError: error, updatedAt: new Date().toISOString() })
    .where(eq(captureDrafts.id, draftId))
    .run();
}

/**
 * Reads stored photos back off the uploads volume as base64.
 *
 * A photo that will not load is skipped rather than fatal: four good photos
 * out of five still transcribe, and the missing one is visible on the draft.
 */
async function loadStoredImages(publicPaths: string[]): Promise<TranscribeImage[]> {
  const images: TranscribeImage[] = [];
  for (const publicPath of publicPaths) {
    const filename = publicPath.replace(/^\/uploads\//, "");
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mediaType = CONTENT_TYPES[ext] as TranscribeImage["mediaType"] | undefined;
    if (!mediaType || !VISION_TYPES.has(mediaType)) continue;

    const target = path.join(/* turbopackIgnore: true */ uploadsDir(), filename);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(/* turbopackIgnore: true */ target);
    } catch {
      continue;
    }
    if (buffer.byteLength > MAX_IMAGE_BYTES) continue;
    images.push({ mediaType, data: buffer.toString("base64") });
  }
  return images;
}
