"use server";

import { db } from "@/db";
import { waitlistSignups } from "@/db/schema";
import { waitlistSchema } from "@/lib/waitlist-schema";
import { makeLimiter, clientIp } from "@/lib/rate-limit";
import { getLocale } from "next-intl/server";

export type WaitlistError = "invalid" | "rate-limited" | "failed";

export type WaitlistResult = { ok?: boolean; error?: WaitlistError };

/** A brake on the public form: a handful of signups per IP per hour. */
const waitlistLimiter = makeLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

export async function joinWaitlist(
  _prev: WaitlistResult | undefined,
  formData: FormData,
): Promise<WaitlistResult> {
  if (waitlistLimiter.hit(await clientIp())) return { error: "rate-limited" };

  const parsed = waitlistSchema.safeParse({
    name: formData.get("name"),
    companyName: formData.get("companyName"),
    email: formData.get("email"),
    preferredContact: formData.get("preferredContact"),
  });
  if (!parsed.success) return { error: "invalid" };

  try {
    // A repeat email hits the lower(email) unique index; that's not an error
    // to the visitor — they're on the list, which is all they asked for.
    await db.insert(waitlistSignups).values({ ...parsed.data, locale: await getLocale() });
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (error as { code?: string })?.code;
    if (code !== "23505") return { error: "failed" };
  }
  return { ok: true };
}
