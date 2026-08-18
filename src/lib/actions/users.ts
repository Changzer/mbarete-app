"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, ne, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

/**
 * Every signed-in user can manage the team, because the tool has one role.
 * Adding a second role later means gating these actions, not rewriting them.
 */
async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  return Number(session.user.id);
}

export type UserActionError =
  | "invalid"
  | "duplicate-email"
  | "not-found"
  | "self-deactivate"
  | "last-user";

export type UserActionResult = { error?: UserActionError };

const newUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
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
  await requireSession();

  const parsed = newUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "invalid" };
  const { name, email, password } = parsed.data;

  if (db.select().from(users).where(eq(users.email, email)).get()) {
    return { error: "duplicate-email" };
  }

  db.insert(users)
    .values({ name, email, passwordHash: await bcrypt.hash(password, 10) })
    .run();

  revalidatePath("/users");
  return {};
}

export async function updateUser(
  id: number,
  _prevState: UserActionResult | undefined,
  formData: FormData,
): Promise<UserActionResult> {
  await requireSession();

  const parsed = editUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };
  const { name, email, password } = parsed.data;

  if (!db.select().from(users).where(eq(users.id, id)).get()) {
    return { error: "not-found" };
  }

  // Somebody else already signs in with this address.
  const clash = db
    .select()
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, id)))
    .get();
  if (clash) return { error: "duplicate-email" };

  db.update(users)
    .set({
      name,
      email,
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
    })
    .where(eq(users.id, id))
    .run();

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
  const currentUserId = await requireSession();

  if (!db.select().from(users).where(eq(users.id, id)).get()) {
    return { error: "not-found" };
  }

  if (!active) {
    // Locking yourself out, or locking out the last way in, is never intended.
    if (id === currentUserId) return { error: "self-deactivate" };
    const activeCount = db
      .select()
      .from(users)
      .where(eq(users.active, true))
      .all().length;
    if (activeCount <= 1) return { error: "last-user" };
  }

  db.update(users).set({ active }).where(eq(users.id, id)).run();

  revalidatePath("/users");
  return {};
}
