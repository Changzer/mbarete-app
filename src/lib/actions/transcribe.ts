"use server";

import { requireUser } from "@/lib/authz";
import { makeLimiter } from "@/lib/rate-limit";

/**
 * A cost brake, not a security wall: every call here is a paid vision-model
 * request, so one account (or one stolen session) must not be able to burn
 * the API budget. Generous against real use — a buyer photographing a market
 * hall all morning stays far under it.
 */
const aiLimiter = makeLimiter({ max: 120, windowMs: 60 * 60 * 1000 });
import { db } from "@/db";
import { categories as categoriesTable } from "@/db/schema";
import { getCategories } from "@/lib/queries/catalog";
import { recordError } from "@/lib/monitoring";
import { recordAiUsage } from "@/lib/ai-usage";
import {
  isTranscriptionEnabled,
  transcribeProductPhotos,
  MAX_TRANSCRIBE_IMAGES,
  type TranscribeImage,
  type TranscribeResult,
} from "@/lib/transcribe-product";
import { transcribeBusinessCard, type CardTranscribeResult } from "@/lib/transcribe-card";
import { productImages } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { uploadsDir, isSafeUploadName } from "@/lib/uploads";
import { cropAndSaveThumb } from "@/lib/thumb-crop";
import fs from "node:fs/promises";
import path from "node:path";

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

const EXT_TYPES: Record<string, TranscribeImage["mediaType"]> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Editing an existing product: its photos live on the uploads volume, not in
 * the form's file input, so the client sends their stored paths instead.
 * Every path is verified against this company's product_images rows before
 * anything is read from disk — a posted path is a claim, not a right.
 */
async function collectStoredImages(
  companyId: number,
  formData: FormData,
): Promise<TranscribeImage[]> {
  const requested = formData
    .getAll("existingPaths")
    .filter((p): p is string => typeof p === "string" && p.length > 0 && p.length < 300)
    .slice(0, MAX_TRANSCRIBE_IMAGES);
  if (requested.length === 0) return [];

  const owned = await db
    .select({ path: productImages.path })
    .from(productImages)
    .where(and(eq(productImages.companyId, companyId), inArray(productImages.path, requested)));
  const allowed = new Set(owned.map((r) => r.path));

  const images: TranscribeImage[] = [];
  for (const publicPath of requested) {
    if (!allowed.has(publicPath)) continue;
    const filename = publicPath.replace(/^\/uploads\//, "");
    if (!isSafeUploadName(filename)) continue;
    const mediaType = EXT_TYPES[filename.split(".").pop() ?? ""];
    if (!mediaType) continue;
    const bytes = await fs
      .readFile(path.join(/* turbopackIgnore: true */ uploadsDir(), filename))
      .catch(() => null);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) continue;
    images.push({ mediaType, data: bytes.toString("base64") });
  }
  return images;
}

export async function transcribeProduct(formData: FormData): Promise<TranscribeResult> {
  const user = await requireUser();

  if (!isTranscriptionEnabled()) return { ok: false, error: "not-configured" };
  if (aiLimiter.hit(`u${user.id}`)) return { ok: false, error: "failed" };

  let images = await collectImages(formData, "images");
  if (images.length === 0) images = await collectStoredImages(user.companyId, formData);
  if (images.length === 0) return { ok: false, error: "no-photos" };

  const categories = await getCategories(user.companyId);

  let result: TranscribeResult;
  try {
    result = await transcribeProductPhotos(
      images,
      categories.map((c) => ({ id: c.id, nameEn: c.nameEn, nameZh: c.nameZh })),
      (usage) =>
        recordAiUsage({
          companyId: user.companyId,
          userId: user.id,
          kind: "product",
          images: images.length,
          ...usage,
        }),
    );
  } catch (error) {
    // Network trouble, a refused request, malformed output — the form still
    // works by hand, so every failure collapses to one retryable message.
    // The cause goes to the error log, which the platform panel shows and
    // alerts on: "could not read the photos" on a phone in a booth is
    // undebuggable otherwise, and nobody reads container logs in time.
    recordError("transcribe:product", error);
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

  // The model located the main product in one of the photos: crop it out and
  // save it as the product's thumbnail.
  if (result.ok && result.thumb) {
    result.thumbPath = await cropAndSaveThumb(user.companyId, images, result.thumb);
  }

  return result;
}

/** Reads the business-card photos picked in the contact form into draft fields. */
export async function transcribeCard(formData: FormData): Promise<CardTranscribeResult> {
  const user = await requireUser();

  if (!isTranscriptionEnabled()) return { ok: false, error: "not-configured" };
  if (aiLimiter.hit(`u${user.id}`)) return { ok: false, error: "failed" };

  const images = await collectImages(formData, "cardImages");
  if (images.length === 0) return { ok: false, error: "no-photos" };

  try {
    return await transcribeBusinessCard(images, (usage) =>
      recordAiUsage({
        companyId: user.companyId,
        userId: user.id,
        kind: "card",
        images: images.length,
        ...usage,
      }),
    );
  } catch (error) {
    recordError("transcribe:card", error);
    return { ok: false, error: "failed" };
  }
}
