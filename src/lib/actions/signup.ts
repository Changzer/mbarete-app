"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { db, one } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { signIn } from "@/lib/auth";
import { createCompanyWithOwner } from "@/lib/company";
import { isSaas, signupCode } from "@/lib/deploy";
import { companyByReferralCode } from "@/lib/referrals";
import { makeLimiter, clientIp } from "@/lib/rate-limit";
import { sendVerificationEmail } from "@/lib/actions/account";
import { getLocale } from "next-intl/server";

export type SignupError =
  | "closed"
  | "bad-code"
  | "invalid"
  | "password-mismatch"
  | "email-taken"
  | "rate-limited"
  | "failed";

export type SignupResult = { error?: SignupError };

const signupSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  ownerName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  confirm: z.string(),
  code: z.string().default(""),
  ref: z.string().default(""),
  // The literal the checkbox posts. Server-enforced so no account can be
  // created without agreeing to the terms and privacy policy — the checkbox
  // in the form is UX; this line is the consent record's guarantee (an
  // account's existence implies consent to the policy version of its day;
  // see docs/COMPLIANCE.md).
  consent: z.literal("on"),
});

/** A brake on a public signup form: a handful of attempts per IP per hour. */
const signupLimiter = makeLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

export async function signUp(
  _prev: SignupResult | undefined,
  formData: FormData,
): Promise<SignupResult> {
  // Signup exists only on a SaaS deployment; self-hosted has its one company.
  if (!isSaas()) return { error: "closed" };

  if (signupLimiter.hit(await clientIp())) return { error: "rate-limited" };

  const parsed = signupSchema.safeParse({
    companyName: formData.get("companyName"),
    ownerName: formData.get("ownerName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
    code: formData.get("code") ?? "",
    ref: formData.get("ref") ?? "",
    consent: formData.get("consent"),
  });
  if (!parsed.success) return { error: "invalid" };
  const { companyName, ownerName, email, password, confirm, code, ref } = parsed.data;

  if (password !== confirm) return { error: "password-mismatch" };

  // Two doors in, with different trust. The platform-wide code was handed
  // over personally, so it admits straight to service. A referral link only
  // queues the company as "pending" — the operator approves from the panel
  // before anything past the waiting screen exists for it. An unset code
  // closes the code door rather than opening it (see deploy.ts); a bogus
  // ref opens nothing.
  const referrer = ref ? await companyByReferralCode(ref) : null;
  const expected = signupCode();
  const codeOk = Boolean(expected) && code === expected;
  if (!codeOk && referrer === null) return { error: "bad-code" };

  // Emails are globally unique — one account, one company. Check first for a
  // clean message instead of a raw unique-constraint error.
  const clash = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1).then(one);
  if (clash) return { error: "email-taken" };

  try {
    const { ownerId } = await createCompanyWithOwner({
      companyName,
      ownerName,
      ownerEmail: email,
      ownerPassword: password,
      referredByCompanyId: referrer?.id,
      status: codeOk ? "active" : "pending",
    });
    // Best-effort: with SMTP configured the new owner gets a verify link;
    // without it, signup works exactly as before.
    await sendVerificationEmail(ownerId, email, await getLocale()).catch(() => {});
  } catch {
    // A race could still lose the unique-email check; collapse anything here
    // to a retryable failure rather than leaking internals.
    return { error: "failed" };
  }

  // Sign the new owner straight in. signIn throws a redirect on success, which
  // must propagate — only a real AuthError becomes a message.
  try {
    await signIn("credentials", { email, password, redirectTo: "/catalog" });
  } catch (error) {
    if (error instanceof AuthError) return { error: "failed" };
    throw error;
  }
  return {};
}
