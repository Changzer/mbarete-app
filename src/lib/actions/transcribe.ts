"use server";

import { auth } from "@/lib/auth";
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
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");

  if (!isTranscriptionEnabled()) return { ok: false, error: "not-configured" };

  const images = await collectImages(formData, "images");
  if (images.length === 0) return { ok: false, error: "no-photos" };

  const categories = await getCategories();

  try {
    return await transcribeProductPhotos(
      images,
      categories.map((c) => ({ id: c.id, nameEn: c.nameEn, nameZh: c.nameZh })),
    );
  } catch {
    // Network trouble, a refused request, malformed output — the form still
    // works by hand, so every failure collapses to one retryable message.
    return { ok: false, error: "failed" };
  }
}

/** Reads the business-card photos picked in the contact form into draft fields. */
export async function transcribeCard(formData: FormData): Promise<CardTranscribeResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");

  if (!isTranscriptionEnabled()) return { ok: false, error: "not-configured" };

  const images = await collectImages(formData, "cardImages");
  if (images.length === 0) return { ok: false, error: "no-photos" };

  try {
    return await transcribeBusinessCard(images);
  } catch {
    return { ok: false, error: "failed" };
  }
}
