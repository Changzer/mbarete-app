"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db, one } from "@/db";
import { companies, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/authz";
import { PLANS, type PlanId } from "@/lib/plans";
import { platformReauth } from "@/lib/platform/reauth";
import { makeLimiter } from "@/lib/rate-limit";

/**
 * Every cross-tenant WRITE here demands step-up authentication: a session
 * alone may look at the panel, but changing what a tenant has additionally
 * requires the operator's password again, recently (reauth.ts). The check
 * lives server-side in each action — the panel UI only mirrors it.
 */
export type PlatformWriteResult = { ok: boolean; error?: "reauth" };

async function freshOperatorOr(): Promise<{ id: number } | null> {
  const operator = await requirePlatformAdmin();
  return platformReauth.isFresh(operator.id) ? operator : null;
}

/** Brute-force brake on the unlock prompt — it is a password oracle. */
const unlockLimiter = makeLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

export type UnlockResult = { ok: boolean; error?: "wrong-password" | "rate-limited" };

/** Confirms the operator's password and opens the 15-minute write window. */
export async function unlockPlatform(password: string): Promise<UnlockResult> {
  const operator = await requirePlatformAdmin();
  if (typeof password !== "string" || !password) return { ok: false, error: "wrong-password" };
  if (unlockLimiter.hit(`u${operator.id}`)) return { ok: false, error: "rate-limited" };
  const row = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, operator.id))
    .limit(1)
    .then(one);
  if (!row || !(await bcrypt.compare(password, row.passwordHash))) {
    return { ok: false, error: "wrong-password" };
  }
  unlockLimiter.clear(`u${operator.id}`);
  platformReauth.mark(operator.id);
  return { ok: true };
}

/**
 * Flips one company's module switch. The write lands on `companies`, which
 * carries no RLS — the tenant walls guard tenant data, and which modules a
 * tenant HAS is platform data about them, not data of theirs.
 */
export async function setCompanyModule(
  companyId: number,
  module: "orders" | "finance",
  enabled: boolean,
): Promise<PlatformWriteResult> {
  if (!(await freshOperatorOr())) return { ok: false, error: "reauth" };
  const column = module === "orders" ? { moduleOrders: enabled } : { moduleFinance: enabled };
  await db.update(companies).set(column).where(eq(companies.id, companyId));
  revalidatePath("/16015975/mbarete-admin");
  return { ok: true };
}

/**
 * Puts a company on a plan and applies that plan's module defaults, so the
 * switches match the tier from the next request. They stay individually
 * overridable afterwards — the plan is a preset, not a cage.
 */
export async function setCompanyPlan(companyId: number, plan: PlanId): Promise<PlatformWriteResult> {
  if (!(await freshOperatorOr())) return { ok: false, error: "reauth" };
  const entitlements = PLANS[plan];
  if (!entitlements) return { ok: false };
  await db
    .update(companies)
    .set({
      plan,
      moduleOrders: entitlements.modules.orders,
      moduleFinance: entitlements.modules.finance,
    })
    .where(eq(companies.id, companyId));
  revalidatePath("/16015975/mbarete-admin");
  return { ok: true };
}

/**
 * Seats bought beyond the plan's cap — billing is manual for now, so the
 * operator collects payment however it happens and records the seats here.
 * Stacks on any plan and survives plan changes.
 */
export async function setExtraSeats(companyId: number, extraSeats: number): Promise<PlatformWriteResult> {
  if (!(await freshOperatorOr())) return { ok: false, error: "reauth" };
  const seats = Math.max(0, Math.min(999, Math.trunc(extraSeats)));
  if (!Number.isFinite(seats)) return { ok: false };
  await db.update(companies).set({ extraSeats: seats }).where(eq(companies.id, companyId));
  revalidatePath("/16015975/mbarete-admin");
  return { ok: true };
}

/**
 * Lets a pending company (a referral signup) into service. Best-effort
 * email tells the owner; without SMTP the operator passes the word along
 * however the referral itself travelled.
 */
export async function approveCompany(companyId: number): Promise<PlatformWriteResult> {
  if (!(await freshOperatorOr())) return { ok: false, error: "reauth" };
  const [row] = await db
    .update(companies)
    .set({ status: "active" })
    .where(and(eq(companies.id, companyId), eq(companies.status, "pending")))
    .returning({ ownerUserId: companies.ownerUserId, name: companies.name });
  if (row?.ownerUserId) {
    const { isMailConfigured, sendMail } = await import("@/lib/mail");
    if (isMailConfigured()) {
      const owner = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, row.ownerUserId))
        .limit(1)
        .then(one);
      if (owner) {
        const origin = process.env.APP_ORIGIN || "http://localhost:3000";
        await sendMail({
          to: owner.email,
          subject: `${row.name} — account approved / 账号已开通`,
          text:
            `Your Mbarete account has been approved. Sign in and get to work:
${origin}/en/login

` +
            `您的 Mbarete 账号已开通，点击登录：
${origin}/zh/login`,
        }).catch(() => {});
      }
    }
  }
  revalidatePath("/16015975/mbarete-admin");
  return { ok: true };
}

/**
 * The brake. Freezing keeps the tenant's logins and data intact but yields
 * every page to the suspended screen — where the data export stays open,
 * because a pause must never be a hostage situation. Unfreezing restores
 * service as if nothing happened.
 */
export async function setCompanySuspended(
  companyId: number,
  suspended: boolean,
): Promise<PlatformWriteResult> {
  if (!(await freshOperatorOr())) return { ok: false, error: "reauth" };
  await db
    .update(companies)
    .set({ status: suspended ? "suspended" : "active" })
    // Freezing a pending company is meaningless — approval is the only door
    // out of pending, so only active companies can be frozen.
    .where(
      and(
        eq(companies.id, companyId),
        eq(companies.status, suspended ? "active" : "suspended"),
      ),
    );
  revalidatePath("/16015975/mbarete-admin");
  return { ok: true };
}

export type ResetLinkResult = { ok: boolean; error?: "reauth" | "no-user"; link?: string };

/**
 * A one-time password-reset link for any tenant user, handed to the
 * operator instead of an inbox — the recovery path while a tenant's email
 * is broken, or before SMTP exists at all. Exactly the mailed link: same
 * hashed single-use token, same 30 minutes, same session-killing reset
 * flow at the other end. The operator never sees or sets the password.
 */
export async function makePasswordResetLink(email: string): Promise<ResetLinkResult> {
  if (!(await freshOperatorOr())) return { ok: false, error: "reauth" };
  const normalized = String(email ?? "").toLowerCase().trim();
  if (!normalized || normalized.length > 200) return { ok: false, error: "no-user" };
  const user = await db
    .select({ id: users.id, active: users.active })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1)
    .then(one);
  // The panel is operator-only, so honesty beats an existence oracle here.
  if (!user || !user.active) return { ok: false, error: "no-user" };

  const { newInviteToken, hashInviteToken, isoIn } = await import("@/lib/invites");
  const { authTokens } = await import("@/db/schema");
  const token = newInviteToken();
  await db.insert(authTokens).values({
    userId: user.id,
    kind: "reset",
    tokenHash: hashInviteToken(token),
    expiresAt: isoIn(30 * 60 * 1000),
  });
  const origin = process.env.APP_ORIGIN || "http://localhost:3000";
  return { ok: true, link: `${origin}/en/reset/${token}` };
}

/**
 * An on-demand backup from the panel — the "before I touch anything" button.
 * The same run the scheduler makes; see src/lib/backups.ts.
 */
export async function backupNow(): Promise<{ ok: boolean; detail: string }> {
  if (!(await freshOperatorOr())) return { ok: false, detail: "reauth" };
  const { runBackup } = await import("@/lib/backups");
  const result = await runBackup();
  revalidatePath("/16015975/mbarete-admin");
  return result.ok
    ? { ok: true, detail: `${result.name}: ${result.rows} rows, ${result.files} files` }
    : { ok: false, detail: result.error };
}

/**
 * Sends a real email to the operator, reporting the SMTP error verbatim
 * when it fails. Diagnosing "no email arrived" otherwise means shelling
 * into the container — the first live deployment burned half an hour on
 * exactly that. Step-up gated like every other panel action: it spends
 * the operator's own mailbox, and the error text is server detail.
 */
export async function sendTestEmail(): Promise<{ ok: boolean; detail: string }> {
  const operator = await requirePlatformAdmin();
  if (!platformReauth.isFresh(operator.id)) return { ok: false, detail: "reauth" };

  const { isMailConfigured, sendMail } = await import("@/lib/mail");
  if (!isMailConfigured()) {
    return { ok: false, detail: "SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS)" };
  }
  const to = process.env.ALERT_EMAIL || operator.email;
  try {
    await sendMail({
      to,
      subject: "Mbarete test email",
      text:
        "This is the platform panel's test email.\n\n" +
        "If you are reading it, outbound mail works: password resets, " +
        "invitations and error alerts can all reach you.",
    });
    return { ok: true, detail: `accepted for delivery to ${to}` };
  } catch (err) {
    // The real reason — "Invalid login", "550 no such user", a timeout —
    // is the whole point of this button.
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
