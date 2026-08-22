"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db, one } from "@/db";
import { users, companies } from "@/db/schema";
import { eq, ne, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/authz";

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
  | "owner-locked";

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

  // Emails are globally unique — one account, one company.
  if (await db.select().from(users).where(eq(users.email, email)).limit(1).then(one)) {
    return { error: "duplicate-email" };
  }

  await db.insert(users).values({
    companyId: admin.companyId,
    name,
    email,
    role,
    passwordHash: await bcrypt.hash(password, 10),
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
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.companyId, admin.companyId), eq(users.id, id)))
    .limit(1)
    .then(one);
  if (!target) {
    return { error: "not-found" };
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
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
    })
    .where(eq(users.id, id));

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

  revalidatePath("/users");
  return {};
}
