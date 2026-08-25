"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, one } from "@/db";
import { invites, users, companies } from "@/db/schema";
import { requireAdmin } from "@/lib/authz";
import { canAddUser, seatAvailableLocked } from "@/lib/entitlements";

/** Thrown inside the accept transaction so the invite claim rolls back. */
class SeatLimitError extends Error {}
import { signIn } from "@/lib/auth";
import { makeLimiter, clientIp } from "@/lib/rate-limit";
import { INVITE_TTL_MS, hashInviteToken, newInviteToken, isoNow, isoIn } from "@/lib/invites";
import { sendVerificationEmail } from "@/lib/actions/account";
import { getLocale } from "next-intl/server";

/**
 * Invite links: an admin mints a link and shares it over WeChat/WhatsApp;
 * whoever opens it creates their own account in the admin's company with the
 * invited role. No email delivery involved — the link IS the invitation.
 *
 * Tokens leave the server exactly once, in the create response; the table
 * stores only their sha256. Links are single-use and expire after 7 days.
 * The invites table is auth-bootstrap (read before any session exists), so
 * it sits outside RLS and every query here scopes by company explicitly.
 */

export type CreateInviteResult = { path?: string; error?: "invalid" | "failed" | "limit" };

export async function createInvite(role: "admin" | "collaborator"): Promise<CreateInviteResult> {
  const admin = await requireAdmin();
  if (role !== "admin" && role !== "collaborator") return { error: "invalid" };
  // No point minting a link the acceptor would bounce off: the seat check
  // runs here for a clear message, and again at accept as the real gate.
  if (!(await canAddUser(admin.companyId))) return { error: "limit" };

  const token = newInviteToken();
  try {
    await db.insert(invites).values({
      companyId: admin.companyId,
      tokenHash: hashInviteToken(token),
      role,
      createdBy: admin.id,
      expiresAt: isoIn(INVITE_TTL_MS),
    });
  } catch {
    return { error: "failed" };
  }
  revalidatePath("/[locale]/users", "page");
  // The one and only time the raw token exists outside this request.
  return { path: `/invite/${token}` };
}

export type RevokeInviteResult = { error?: "failed" };

export async function revokeInvite(inviteId: number): Promise<RevokeInviteResult> {
  const admin = await requireAdmin();
  await db
    .delete(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.companyId, admin.companyId)));
  revalidatePath("/[locale]/users", "page");
  return {};
}

/** Pending (unused, unexpired) invites for the admin's own company. */
export async function listPendingInvites(companyId: number) {
  return db
    .select({
      id: invites.id,
      role: invites.role,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
      createdByName: users.name,
    })
    .from(invites)
    .leftJoin(users, eq(invites.createdBy, users.id))
    .where(
      and(
        eq(invites.companyId, companyId),
        isNull(invites.usedAt),
        gt(invites.expiresAt, isoNow()),
      ),
    )
    .orderBy(invites.createdAt);
}

/**
 * What the public accept page needs to render: is this link good, and whose
 * team is it for. Reveals only the company name, and only to someone who
 * holds a live link.
 */
export type InviteLookup =
  | { ok: true; companyName: string; role: "admin" | "collaborator" }
  | { ok: false };

export async function lookupInvite(token: string): Promise<InviteLookup> {
  if (!token || token.length > 200) return { ok: false };
  const row = await db
    .select({
      usedAt: invites.usedAt,
      expiresAt: invites.expiresAt,
      role: invites.role,
      companyName: companies.name,
    })
    .from(invites)
    .innerJoin(companies, eq(invites.companyId, companies.id))
    .where(eq(invites.tokenHash, hashInviteToken(token)))
    .limit(1)
    .then(one);
  if (!row || row.usedAt || row.expiresAt <= isoNow()) return { ok: false };
  return { ok: true, companyName: row.companyName, role: row.role };
}

export type AcceptInviteError =
  | "invalid-link"
  | "invalid"
  | "password-mismatch"
  | "email-taken"
  | "rate-limited"
  | "limit"
  | "failed";

export type AcceptInviteResult = { error?: AcceptInviteError };

const acceptSchema = z.object({
  token: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  confirm: z.string(),
});

/** A public endpoint: the same brake budget as signup. */
const acceptLimiter = makeLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

export async function acceptInvite(
  _prev: AcceptInviteResult | undefined,
  formData: FormData,
): Promise<AcceptInviteResult> {
  if (acceptLimiter.hit(await clientIp())) return { error: "rate-limited" };

  const parsed = acceptSchema.safeParse({
    token: formData.get("token"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: "invalid" };
  const { token, name, email, password, confirm } = parsed.data;
  if (password !== confirm) return { error: "password-mismatch" };

  const clash = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
    .then(one);
  if (clash) return { error: "email-taken" };

  // The real seat gate: links can outlive the plan's room. Look the invite up
  // (without claiming it) to learn whose company needs the seat.
  const pending = await db
    .select({ companyId: invites.companyId })
    .from(invites)
    .where(eq(invites.tokenHash, hashInviteToken(token)))
    .limit(1)
    .then(one);
  if (pending && !(await canAddUser(pending.companyId))) return { error: "limit" };

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const accepted = await db.transaction(async (tx) => {
      // Claim the invite first, atomically: the WHERE re-checks unused +
      // unexpired inside the transaction, so two people racing the same
      // link cannot both get an account out of it.
      const [claimed] = await tx
        .update(invites)
        .set({ usedAt: isoNow() })
        .where(
          and(
            eq(invites.tokenHash, hashInviteToken(token)),
            isNull(invites.usedAt),
            gt(invites.expiresAt, isoNow()),
          ),
        )
        .returning({ id: invites.id, companyId: invites.companyId, role: invites.role });
      if (!claimed) return null;

      // The advisory check above ran outside this transaction; under the
      // company's row lock it becomes binding — two invites racing for the
      // last seat get one account. Thrown, not returned: the rollback must
      // un-claim the link so the invite survives for when a seat opens up.
      if (!(await seatAvailableLocked(tx, claimed.companyId))) throw new SeatLimitError();

      const [created] = await tx
        .insert(users)
        .values({ companyId: claimed.companyId, email, passwordHash, name, role: claimed.role })
        .returning({ id: users.id });
      await tx
        .update(invites)
        .set({ usedByUserId: created.id })
        .where(eq(invites.id, claimed.id));
      return created.id;
    });
    if (!accepted) return { error: "invalid-link" };
    // Best-effort verify link for the new account; a no-op without SMTP.
    await sendVerificationEmail(accepted, email, await getLocale()).catch(() => {});
  } catch (error) {
    if (error instanceof SeatLimitError) return { error: "limit" };
    // A race can still lose the unique-email check; collapse to retryable.
    return { error: "failed" };
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/catalog" });
  } catch (error) {
    if (error instanceof AuthError) return { error: "failed" };
    throw error;
  }
  return {};
}
