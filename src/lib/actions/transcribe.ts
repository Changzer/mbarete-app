"use server";

import { requireUser } from "@/lib/authz";
import { db } from "@/db";
import { categories as categoriesTable } from "@/db/schema";
import { getCategories } from "@/lib/queries/catalog";
import {
  isTranscriptionEnabled,
  transcribeProductPhotos,
  MAX_TRANSCRIBE_IMAGES,
  type TranscribeImage,
  type TranscribeResult,
} from "@/lib/transcribe-product";
import { transcribeBusinessCard, type CardTranscribeResult } from "@/lib/transcribe-card";

// The formats Claude's vision accepts — the same set the catalog stores, so
// anything the photo picker produces can also be transcribed.
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Reads the photos already picked in the product form and returns draft field
 * values. Nothing is saved here — the draft lands in the form for proofreading
 * and goes through the normal create/update action.
 */
async function collectImages(formData: FormData, field: string): Promise<TranscribeImage[]> {
  const files = formData
    .getAll(field)
    .filter(
      (f): f is File =>
        f instanceof File && f.size > 0 && f.size <= MAX_IMAGE_BYTES && IMAGE_TYPES.has(f.type),
    )
    .slice(0, MAX_TRANSCRIBE_IMAGES);

  return Promise.all(
    files.map(async (file) => ({
      mediaType: file.type as TranscribeImage["mediaType"],
      data: Buffer.from(await file.arrayBuffer()).toString("base64"),
    })),
  );
}

export async function transcribeProduct(formData: FormData): Promise<TranscribeResult> {
  const user = await requireUser();

  if (!isTranscriptionEnabled()) return { ok: false, error: "not-configured" };

  const images = await collectImages(formData, "images");
  if (images.length === 0) return { ok: false, error: "no-photos" };

  const categories = await getCategories(user.companyId);

  let result: TranscribeResult;
  try {
    result = await transcribeProductPhotos(
      images,
      categories.map((c) => ({ id: c.id, nameEn: c.nameEn, nameZh: c.nameZh })),
    );
  } catch (error) {
    // Network trouble, a refused request, malformed output — the form still
    // works by hand, so every failure collapses to one retryable message.
    // The cause goes to the server log: "could not read the photos" on the
    // phone is undebuggable without it.
    console.error("[transcribe] failed:", error);
    return { ok: false, error: "failed" };
  }

  // The model proposed a category the list was missing. Match it against the
  // existing names first (case-insensitive, either language) so re-scans never
  // multiply categories; create it only when genuinely new. Creating a
  // category is the one write transcription makes — it is cheap, visible on
  // the categories page, and deletable there.
  if (result.ok && result.fields.categoryId === undefined && result.proposedCategory) {
    const proposal = result.proposedCategory;
    const existing = categories.find(
      (c) =>
        c.nameEn.trim().toLowerCase() === proposal.nameEn.toLowerCase() ||
        c.nameZh.trim() === proposal.nameZh,
    );
    if (existing) {
      result.fields.categoryId = existing.id;
    } else {
      const [inserted] = await db
        .insert(categoriesTable)
        .values({ companyId: user.companyId, nameEn: proposal.nameEn, nameZh: proposal.nameZh })
        .returning({ id: categoriesTable.id });
      result.fields.categoryId = inserted.id;
      result.newCategory = { id: inserted.id, nameEn: proposal.nameEn, nameZh: proposal.nameZh };
    }
  }

  return result;
}

/** Reads the business-card photos picked in the contact form into draft fields. */
export async function transcribeCard(formData: FormData): Promise<CardTranscribeResult> {
  await requireUser();

  if (!isTranscriptionEnabled()) return { ok: false, error: "not-configured" };

  const images = await collectImages(formData, "cardImages");
  if (images.length === 0) return { ok: false, error: "no-photos" };

  try {
    return await transcribeBusinessCard(images);
  } catch (error) {
    console.error("[transcribe] card failed:", error);
    return { ok: false, error: "failed" };
  }
}
