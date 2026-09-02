"use server";

import { z } from "zod";
import { canAddUser, seatAvailableLocked } from "@/lib/entitlements";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db, one } from "@/db";
import { users, companies } from "@/db/schema";
import { eq, ne, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/authz";
import { platformReauth } from "@/lib/platform/reauth";
import { recordAdminEvent } from "@/lib/admin-events";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { recordError } from "@/lib/monitoring";

/**
 * Team management is admin ground: an admin adds accounts, resets passwords
 * and assigns roles; a collaborator never sees this page and every action
 * here rejects them anyway.
 */
async function requireSession() {
  return await requireAdmin();
}

const roleSchema = z.enum(["admin", "collaborator"]);

export type UserActionError =
  | "invalid"
  | "duplicate-email"
  | "not-found"
  | "self-deactivate"
  | "self-demote"
  | "last-admin"
  | "last-user"
  | "owner-locked"
  | "limit";

export type UserActionResult = { error?: UserActionError };

/**
 * The company owner is the account that created the company at signup. They are
 * the permanent super-admin: they can never be demoted or deactivated, so a
 * company can never be left without its owner. (Ownership can be transferred
 * later — a separate, deliberate action — but not stripped by accident here.)
 */
async function isCompanyOwner(companyId: number, userId: number): Promise<boolean> {
  const company = await db
    .select({ ownerUserId: companies.ownerUserId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
    .then(one);
  return company?.ownerUserId === userId;
}

const newUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  role: roleSchema,
});

const editUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  // Blank means "leave the current password alone".
  password: z.union([z.string().min(8), z.literal("")]).default(""),
});

export async function createUser(
  _prevState: UserActionResult | undefined,
  formData: FormData,
): Promise<UserActionResult> {
  const admin = await requireSession();

  const parsed = newUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: "invalid" };
  const { name, email, password, role } = parsed.data;

  // The seat cap binds here exactly as on the invite path — a limit only
  // one of two doors enforces is advisory, not a limit.
  if (!(await canAddUser(admin.companyId))) return { error: "limit" };

  // Emails are globally unique — one account, one company.
  if (await db.select().from(users).where(eq(users.email, email)).limit(1).then(one)) {
    return { error: "duplicate-email" };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  // Cap re-checked under the company's row lock, in the same transaction as
  // the insert — two admins racing for the last seat get exactly one yes.
  const created = await db.transaction(async (tx) => {
    if (!(await seatAvailableLocked(tx, admin.companyId))) return null;
    const [row] = await tx
      .insert(users)
      .values({
        companyId: admin.companyId,
        name,
        email,
        role,
        passwordHash,
      })
      .returning({ id: users.id });
    return row.id;
  });
  if (created === null) return { error: "limit" };
  await recordAdminEvent({
    companyId: admin.companyId,
    actorUserId: admin.id,
    action: "user-created",
    targetUserId: created,
    detail: `${email} · ${role}`,
  });

  revalidatePath("/users");
  return {};
}

export async function updateUser(
  id: number,
  _prevState: UserActionResult | undefined,
  formData: FormData,
): Promise<UserActionResult> {
  const admin = await requireSession();

  const parsed = editUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  const { name, email, password } = parsed.data;

  const target = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.companyId, admin.companyId), eq(users.id, id)))
    .limit(1)
    .then(one);
  if (!target) {
    return { error: "not-found" };
  }

  // The owner's credentials belong to the owner alone. Another admin
  // rewriting the owner's email or password IS an account takeover, however
  // it is dressed — the guard that already covers demotion covers this too.
  if (admin.id !== id && (await isCompanyOwner(admin.companyId, id))) {
    return { error: "owner-locked" };
  }

  // Somebody else already signs in with this address.
  const clash = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, id)))
    .limit(1)
    .then(one);
  if (clash) return { error: "duplicate-email" };

  await db.update(users)
    .set({
      name,
      email,
      ...(password
        ? {
            passwordHash: await bcrypt.hash(password, 10),
            passwordChangedAt: new Date().toISOString(),
          }
        : {}),
    })
    .where(eq(users.id, id));
  // A new password ends any step-up window the old one had opened.
  if (password) platformReauth.clear(id);

  // The trail, then the notice. A credential rewritten from this page is
  // exactly what an account takeover looks like from the inside, so the
  // account hears about it (the OLD address, for an email change — the new
  // one belongs to whoever typed it) and every admin can see it here.
  const emailChanged = target.email !== email;
  const event = { companyId: admin.companyId, actorUserId: admin.id, targetUserId: id };
  if (password) await recordAdminEvent({ ...event, action: "password-set" });
  if (emailChanged) {
    await recordAdminEvent({
      ...event,
      action: "email-changed",
      detail: `${target.email} → ${email}`,
    });
  }
  if (!password && !emailChanged) await recordAdminEvent({ ...event, action: "user-updated" });

  if (admin.id !== id && isMailConfigured() && (password || emailChanged)) {
    const when = new Date().toISOString().slice(0, 16).replace("T", " ");
    const by = admin.email;
    if (password) {
      await sendMail({
        to: email,
        subject: "Mbarete: your password was changed by an admin / 管理员已更改您的密码",
        text:
          `An admin of your company (${by}) set a new password on your Mbarete account at ${when} UTC. ` +
          "If you asked for this, sign in with the password they gave you and change it. " +
          "If you did not, tell your company's owner now.\n\n" +
          `贵公司的管理员（${by}）于 ${when}（UTC）为您的 Mbarete 账号设置了新密码。` +
          "如果这是您要求的，请使用管理员提供的密码登录并尽快修改。如果不是，请立即联系贵公司的负责人。",
      }).catch((err) => recordError("mail:admin-password-notice", err));
    }
    if (emailChanged) {
      await sendMail({
        to: target.email,
        subject: "Mbarete: your sign-in email was changed / 您的登录邮箱已更改",
        text:
          `An admin of your company (${by}) changed the sign-in email of your Mbarete account ` +
          `from ${target.email} to ${email} at ${when} UTC. This address no longer signs in. ` +
          "If you did not expect this, tell your company's owner now.\n\n" +
          `贵公司的管理员（${by}）于 ${when}（UTC）将您的 Mbarete 登录邮箱从 ${target.email} 更改为 ${email}。` +
          "此地址已无法登录。如果这不在您的预期之内，请立即联系贵公司的负责人。",
      }).catch((err) => recordError("mail:admin-email-notice", err));
    }
  }

  revalidatePath("/users");
  revalidatePath("/catalog");
  revalidatePath("/orders");
  return {};
}

/**
 * Turn an account's access on or off.
 *
 * Accounts are never deleted. Products and orders record who entered them, so
 * removing the row would either fail against the foreign key or erase the
 * history the attribution exists to keep.
 */
export async function setUserActive(
  id: number,
  active: boolean,
): Promise<UserActionResult> {
  const admin = await requireSession();
  const currentUserId = admin.id;

  const exists = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.companyId, admin.companyId), eq(users.id, id)))
    .limit(1)
    .then(one);
  if (!exists) {
    return { error: "not-found" };
  }

  if (!active) {
    // Locking yourself out, or locking out the last way in, is never intended.
    if (id === currentUserId) return { error: "self-deactivate" };
    // The owner account can never be deactivated by anyone.
    if (await isCompanyOwner(admin.companyId, id)) return { error: "owner-locked" };
    const activeUsers = await db
      .select()
      .from(users)
      .where(and(eq(users.companyId, admin.companyId), eq(users.active, true)));
    if (activeUsers.length <= 1) return { error: "last-user" };
    const target = activeUsers.find((u) => u.id === id);
    // Deactivating the only active admin would leave nobody able to manage
    // roles, settings or this page — the same lockout as deleting yourself.
    if (
      target?.role === "admin" &&
      !activeUsers.some((u) => u.id !== id && u.role === "admin")
    ) {
      return { error: "last-admin" };
    }
  }

  await db.update(users).set({ active }).where(eq(users.id, id));
  await recordAdminEvent({
    companyId: admin.companyId,
    actorUserId: admin.id,
    action: active ? "user-activated" : "user-deactivated",
    targetUserId: id,
  });

  revalidatePath("/users");
  return {};
}

/**
 * Assign a role from the team list. Guarded the same way deactivation is:
 * demoting yourself or the only active admin would leave the team with
 * nobody who can get back into this page to undo it.
 */
export async function setUserRole(
  id: number,
  role: "admin" | "collaborator",
): Promise<UserActionResult> {
  const admin = await requireSession();
  const currentUserId = admin.id;

  if (!roleSchema.safeParse(role).success) return { error: "invalid" };

  const target = await db
    .select()
    .from(users)
    .where(and(eq(users.companyId, admin.companyId), eq(users.id, id)))
    .limit(1)
    .then(one);
  if (!target) return { error: "not-found" };
  if (target.role === role) return {};

  if (role === "collaborator") {
    if (id === currentUserId) return { error: "self-demote" };
    // The owner is the permanent super-admin and can never be demoted.
    if (await isCompanyOwner(admin.companyId, id)) return { error: "owner-locked" };
    const otherAdmin = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.companyId, admin.companyId),
          eq(users.role, "admin"),
          eq(users.active, true),
          ne(users.id, id),
        ),
      )
      .limit(1)
      .then(one);
    if (!otherAdmin) return { error: "last-admin" };
  }

  await db.update(users).set({ role }).where(eq(users.id, id));
  await recordAdminEvent({
    companyId: admin.companyId,
    actorUserId: admin.id,
    action: "role-changed",
    targetUserId: id,
    detail: `${target.role} → ${role}`,
  });

  revalidatePath("/users");
  return {};
}
