"use server";

import { z } from "zod";
import { db } from "@/db";
import { waitlistSignups } from "@/db/schema";
import { makeLimiter, clientIp } from "@/lib/rate-limit";
import { getLocale } from "next-intl/server";

export type WaitlistError = "invalid" | "invalid-mobile" | "rate-limited" | "failed";

export type WaitlistResult = { ok?: boolean; error?: WaitlistError };

/**
 * Mainland-China mobile: optional +86 / 86 prefix, then 1[3-9] and nine more
 * digits. Spaces and dashes are stripped before matching so "138 0013 8000"
 * and "+86-138-0013-8000" both pass.
 */
const cnMobile = /^(?:\+?86)?1[3-9]\d{9}$/;

const waitlistSchema = z.object({
  name: z.string().trim().min(1).max(120),
  companyName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  mobile: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(cnMobile)),
});

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
    mobile: formData.get("mobile"),
  });
  if (!parsed.success) {
    const mobileOnly = parsed.error.issues.every((i) => i.path[0] === "mobile");
    return { error: mobileOnly ? "invalid-mobile" : "invalid" };
  }

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
