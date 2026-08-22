"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { db, one } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { signIn } from "@/lib/auth";
import { createCompanyWithOwner } from "@/lib/company";
import { isSaas, signupCode } from "@/lib/deploy";
import { makeLimiter, clientIp } from "@/lib/rate-limit";

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
  });
  if (!parsed.success) return { error: "invalid" };
  const { companyName, ownerName, email, password, confirm, code } = parsed.data;

  if (password !== confirm) return { error: "password-mismatch" };

  // The invite code gates who may create a company. An unset code closes
  // signup entirely rather than opening it (see deploy.ts).
  const expected = signupCode();
  if (!expected || code !== expected) return { error: "bad-code" };

  // Emails are globally unique — one account, one company. Check first for a
  // clean message instead of a raw unique-constraint error.
  const clash = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1).then(one);
  if (clash) return { error: "email-taken" };

  try {
    await createCompanyWithOwner({ companyName, ownerName, ownerEmail: email, ownerPassword: password });
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
