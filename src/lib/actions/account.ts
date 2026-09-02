"use server";

import { z } from "zod";
import { and, eq, isNull, gt, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getLocale } from "next-intl/server";
import { db, one } from "@/db";
import { users, companies, authTokens } from "@/db/schema";
import { requireUser, requireAdmin } from "@/lib/authz";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { makeLimiter, clientIp } from "@/lib/rate-limit";
import { platformReauth } from "@/lib/platform/reauth";
import { recordError } from "@/lib/monitoring";
import { sendVerificationEmail, appOrigin } from "@/lib/verification-mail";
import { hashInviteToken as hashToken, newInviteToken as newToken, isoNow, isoIn } from "@/lib/invites";

/**
 * Account hygiene: password reset by email, email verification, change
 * password while signed in, and ownership transfer.
 *
 * auth_tokens rows are single-use, expiring, and stored only as sha256 —
 * the same discipline as invite links. Reset links prove control of the
 * mailbox, which is why the flow never says whether an email exists.
 */

const RESET_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------- forgot ---

export type ForgotResult = { done?: true; error?: "rate-limited" | "mail-unavailable" };

const forgotLimiter = makeLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
const forgotEmailLimiter = makeLimiter({ max: 3, windowMs: 60 * 60 * 1000 });

export async function requestPasswordReset(
  _prev: ForgotResult | undefined,
  formData: FormData,
): Promise<ForgotResult> {
  if (!isMailConfigured()) return { error: "mail-unavailable" };
  if (forgotLimiter.hit(await clientIp())) return { error: "rate-limited" };

  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const locale = await getLocale();
  // Whatever happens below, the answer is the same "if that address exists,
  // we sent a link" — the form must never reveal which emails have accounts.
  if (!email || email.length > 200) return { done: true };
  if (forgotEmailLimiter.hit(email)) return { done: true };

  const user = await db.select().from(users).where(eq(users.email, email)).limit(1).then(one);
  if (!user || !user.active) return { done: true };

  const token = newToken();
  await db.insert(authTokens).values({
    userId: user.id,
    kind: "reset",
    tokenHash: hashToken(token),
    expiresAt: isoIn(RESET_TTL_MS),
  });

  const link = `${appOrigin()}/${locale}/reset/${token}`;
  const subject = locale === "zh" ? "重置您的 Mbarete 密码" : "Reset your Mbarete password";
  const text =
    locale === "zh"
      ? `您（或某人）请求重置此账户的密码。\n\n30 分钟内有效，仅可使用一次：\n${link}\n\n如果不是您本人操作，忽略此邮件即可，密码不会改变。`
      : `You (or someone) asked to reset this account's password.\n\nThe link works once, for 30 minutes:\n${link}\n\nIf this wasn't you, ignore this email and nothing changes.`;
  // The ANSWER stays constant whatever happens — a delivery error must not
  // become an existence oracle. The SERVER, however, records it: an SMTP
  // that silently eats every reset link is invisible otherwise, which is
  // exactly how it hid on the first real deployment.
  await sendMail({ to: email, subject, text }).catch((err) =>
    recordError("mail:password-reset", err),
  );
  return { done: true };
}

// ----------------------------------------------------------------- reset ---

export type ResetError = "invalid-link" | "password-mismatch" | "invalid" | "failed";
export type ResetResult = { done?: true; error?: ResetError };

const resetSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
  confirm: z.string(),
});

export async function lookupResetToken(token: string): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const row = await db
    .select({ id: authTokens.id })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.kind, "reset"),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, isoNow()),
      ),
    )
    .limit(1)
    .then(one);
  return Boolean(row);
}

export async function resetPassword(
  _prev: ResetResult | undefined,
  formData: FormData,
): Promise<ResetResult> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: "invalid" };
  const { token, password, confirm } = parsed.data;
  if (password !== confirm) return { error: "password-mismatch" };

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const changed = await db.transaction(async (tx) => {
      // Claim the token atomically; the WHERE re-checks live-ness so a link
      // can never be spent twice.
      const [claimed] = await tx
        .update(authTokens)
        .set({ usedAt: isoNow() })
        .where(
          and(
            eq(authTokens.tokenHash, hashToken(token)),
            eq(authTokens.kind, "reset"),
            isNull(authTokens.usedAt),
            gt(authTokens.expiresAt, isoNow()),
          ),
        )
        .returning({ userId: authTokens.userId });
      if (!claimed) return false;
      await tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: new Date().toISOString() })
        .where(eq(users.id, claimed.userId));
      // A reset proves email control, not the old password — either way the
      // old credential's step-up window must not survive it.
      platformReauth.clear(claimed.userId);
      // Every other outstanding reset link for this account dies with it.
      await tx
        .update(authTokens)
        .set({ usedAt: isoNow() })
        .where(
          and(
            eq(authTokens.userId, claimed.userId),
            eq(authTokens.kind, "reset"),
            isNull(authTokens.usedAt),
          ),
        );
      return true;
    });
    if (!changed) return { error: "invalid-link" };
  } catch {
    return { error: "failed" };
  }
  return { done: true };
}

// ---------------------------------------------------------------- verify ---

export async function verifyEmailToken(token: string): Promise<boolean> {
  if (!token || token.length > 200) return false;
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(authTokens)
      .set({ usedAt: isoNow() })
      .where(
        and(
          eq(authTokens.tokenHash, hashToken(token)),
          eq(authTokens.kind, "verify"),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, isoNow()),
        ),
      )
      .returning({ userId: authTokens.userId });
    if (!claimed) return false;
    await tx.update(users).set({ emailVerifiedAt: isoNow() }).where(eq(users.id, claimed.userId));
    return true;
  });
}

export type ResendVerificationResult = { done?: true; error?: "mail-unavailable" | "rate-limited" };

const resendLimiter = makeLimiter({ max: 3, windowMs: 60 * 60 * 1000 });

export async function resendVerification(): Promise<ResendVerificationResult> {
  const user = await requireUser();
  if (!isMailConfigured()) return { error: "mail-unavailable" };
  if (resendLimiter.hit(`u${user.id}`)) return { error: "rate-limited" };
  await sendVerificationEmail(user.id, user.email, await getLocale());
  return { done: true };
}

// -------------------------------------------------------- change password ---

export type ChangePasswordError = "wrong-password" | "password-mismatch" | "invalid" | "failed";
export type ChangePasswordResult = { done?: true; error?: ChangePasswordError };

const changeSchema = z.object({
  current: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
  confirm: z.string(),
});

export async function changePassword(
  _prev: ChangePasswordResult | undefined,
  formData: FormData,
): Promise<ChangePasswordResult> {
  const me = await requireUser();
  const parsed = changeSchema.safeParse({
    current: formData.get("current"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: "invalid" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "password-mismatch" };

  const row = await db.select().from(users).where(eq(users.id, me.id)).limit(1).then(one);
  if (!row) return { error: "failed" };
  const ok = await bcrypt.compare(parsed.data.current, row.passwordHash);
  if (!ok) return { error: "wrong-password" };

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await db
    .update(users)
    .set({ passwordHash, passwordChangedAt: new Date().toISOString() })
    .where(eq(users.id, me.id));
  // Any step-up window opened with the OLD password dies with it.
  platformReauth.clear(me.id);
  return { done: true };
}

// ------------------------------------------------------ transfer ownership ---

export type TransferError = "not-owner" | "wrong-password" | "bad-target" | "failed";
export type TransferResult = { done?: true; error?: TransferError };

/**
 * The one deliberate way ownership moves. Only the current owner may do it,
 * it needs their password fresh (a stolen unlocked session must not be
 * enough), and the target must be an ACTIVE ADMIN of the same company.
 */
export async function transferOwnership(
  targetUserId: number,
  formData: FormData,
): Promise<TransferResult> {
  const me = await requireAdmin();
  const password = String(formData.get("password") ?? "");

  const company = await db
    .select({ ownerUserId: companies.ownerUserId })
    .from(companies)
    .where(eq(companies.id, me.companyId))
    .limit(1)
    .then(one);
  if (!company || company.ownerUserId !== me.id) return { error: "not-owner" };

  const myRow = await db.select().from(users).where(eq(users.id, me.id)).limit(1).then(one);
  if (!myRow || !(await bcrypt.compare(password, myRow.passwordHash))) {
    return { error: "wrong-password" };
  }

  const target = await db
    .select({ id: users.id, role: users.role, active: users.active })
    .from(users)
    .where(and(eq(users.id, targetUserId), eq(users.companyId, me.companyId), ne(users.id, me.id)))
    .limit(1)
    .then(one);
  if (!target || !target.active || target.role !== "admin") return { error: "bad-target" };

  await db
    .update(companies)
    .set({ ownerUserId: target.id })
    .where(and(eq(companies.id, me.companyId), eq(companies.ownerUserId, me.id)));
  return { done: true };
}
