"use server";

import { db } from "@/db";
import { serviceEnquiries, serviceEnquiryImages } from "@/db/schema";
import { enquirySchema } from "@/lib/enquiry-schema";
import {
  saveUploadedEnquiryImage,
  ENQUIRY_IMAGE_MAX,
  ENQUIRY_IMAGE_MAX_BYTES,
} from "@/lib/uploads";
import { makeLimiter, clientIp } from "@/lib/rate-limit";
import { getLocale } from "next-intl/server";

export type EnquiryError = "invalid" | "rate-limited" | "photos" | "failed";

export type EnquiryResult = { ok?: boolean; error?: EnquiryError };

/** A brake on the public form: a handful of enquiries per IP per hour. */
const enquiryLimiter = makeLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

export async function submitEnquiry(
  _prev: EnquiryResult | undefined,
  formData: FormData,
): Promise<EnquiryResult> {
  if (enquiryLimiter.hit(await clientIp())) return { error: "rate-limited" };

  const parsed = enquirySchema.safeParse({
    name: formData.get("name"),
    companyName: formData.get("companyName"),
    email: formData.get("email"),
    preferredContact: formData.get("preferredContact"),
    message: formData.get("message"),
    quantity: formData.get("quantity"),
    destination: formData.get("destination"),
    targetPrice: formData.get("targetPrice"),
  });
  if (!parsed.success) return { error: "invalid" };

  // Photos are checked and written BEFORE the row is inserted, so a rejected
  // file fails the whole submission rather than leaving an enquiry that
  // silently lost the picture it was about. The browser caps the count too,
  // but the browser is not the authority here — anyone can post this form.
  const photos = formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (photos.length > ENQUIRY_IMAGE_MAX) return { error: "photos" };
  if (photos.some((f) => f.size > ENQUIRY_IMAGE_MAX_BYTES)) return { error: "photos" };

  let paths: string[];
  try {
    // Sequentially, not in parallel: each one decodes and re-encodes a
    // multi-megapixel image, and four of those at once on a small VPS is a
    // memory spike a stranger gets to trigger at will.
    paths = [];
    for (const photo of photos) paths.push(await saveUploadedEnquiryImage(photo));
  } catch {
    return { error: "photos" };
  }

  // No duplicate-swallowing here, unlike the old waitlist: there is no unique
  // index to hit, because a second enquiry from the same buyer is a second
  // conversation and losing it would cost a sale.
  try {
    const locale = await getLocale();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(serviceEnquiries)
        .values({ ...parsed.data, locale })
        .returning({ id: serviceEnquiries.id });
      if (paths.length) {
        await tx
          .insert(serviceEnquiryImages)
          .values(paths.map((path) => ({ enquiryId: row.id, path })));
      }
    });
  } catch {
    return { error: "failed" };
  }
  return { ok: true };
}
