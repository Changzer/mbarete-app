"use server";

import { db } from "@/db";
import { serviceEnquiries } from "@/db/schema";
import { enquirySchema } from "@/lib/enquiry-schema";
import { makeLimiter, clientIp } from "@/lib/rate-limit";
import { getLocale } from "next-intl/server";

export type EnquiryError = "invalid" | "rate-limited" | "failed";

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
  });
  if (!parsed.success) return { error: "invalid" };

  // No duplicate-swallowing here, unlike the old waitlist: there is no unique
  // index to hit, because a second enquiry from the same buyer is a second
  // conversation and losing it would cost a sale.
  try {
    await db.insert(serviceEnquiries).values({ ...parsed.data, locale: await getLocale() });
  } catch {
    return { error: "failed" };
  }
  return { ok: true };
}
