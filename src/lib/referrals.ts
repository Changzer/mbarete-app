import crypto from "node:crypto";
import { and, count, eq, isNull, isNotNull } from "drizzle-orm";
import { db, one } from "@/db";
import { companies } from "@/db/schema";

/**
 * Company-to-company referrals: the growth loop.
 *
 * A tenant admin shares /signup?ref=<code> over WeChat; the code admits a new
 * company without the platform-wide SIGNUP_CODE and stamps who referred whom,
 * so the panel can see which companies bring others in. Codes are minted
 * lazily, once, and never rotated — the link a person shared last month must
 * keep working.
 *
 * The companies table has no RLS (it is auth-bootstrap), so these helpers
 * scope every query explicitly, same as invites do.
 */

/** Unambiguous alphabet: no 0/O or 1/I/L to mistype from a phone screen. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** The company's referral code, minting it on first use. */
export async function ensureReferralCode(companyId: number): Promise<string> {
  const row = await db
    .select({ code: companies.referralCode })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
    .then(one);
  if (row?.code) return row.code;

  // Retry on the astronomically unlikely collision rather than pre-checking.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomCode();
    try {
      await db
        .update(companies)
        .set({ referralCode: code })
        .where(and(eq(companies.id, companyId), isNull(companies.referralCode)));
      const check = await db
        .select({ code: companies.referralCode })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1)
        .then(one);
      if (check?.code) return check.code;
    } catch {
      // unique collision — next attempt
    }
  }
  throw new Error("could not mint referral code");
}

/** The company behind a shared code, or null for a bogus/revoked one. */
export async function companyByReferralCode(
  code: string,
): Promise<{ id: number; name: string } | null> {
  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z2-9]{6,12}$/.test(trimmed)) return null;
  const row = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.referralCode, trimmed))
    .limit(1)
    .then(one);
  return row ?? null;
}

/** How many companies joined through this company's link. */
export async function referralCount(companyId: number): Promise<number> {
  const row = await db
    .select({ n: count() })
    .from(companies)
    .where(
      and(eq(companies.referredByCompanyId, companyId), isNotNull(companies.referredByCompanyId)),
    )
    .then((rows) => rows[0]);
  return row?.n ?? 0;
}
