import { auth } from "@/lib/auth";
import { db, one } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export type Role = "admin" | "collaborator";

export type SessionUser = {
  id: number;
  companyId: number;
  role: Role;
  name: string;
  email: string;
};

/**
 * The signed-in user with their CURRENT role and active flag, read from the
 * database rather than the JWT. A demotion or deactivation therefore applies
 * on the next request, not the next sign-in — with a session that lives in a
 * cookie for days, "next sign-in" could otherwise be weeks away.
 */
export async function sessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = Number(session?.user?.id);
  if (!id) return null;
  const row = await db.select().from(users).where(eq(users.id, id)).limit(1).then(one);
  if (!row || !row.active) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    role: row.role,
    name: row.name,
    email: row.email,
  };
}

/** Any signed-in, still-active account. */
export async function requireUser(): Promise<SessionUser> {
  const user = await sessionUser();
  if (!user) throw new Error("unauthorized");
  return user;
}

/**
 * Admin only. Server actions behind this are the actual security boundary;
 * hiding the buttons in the UI is only politeness.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("forbidden");
  return user;
}
