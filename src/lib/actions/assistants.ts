"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db, one } from "@/db";
import { assistantKeys, users } from "@/db/schema";
import { requireAdmin, type SessionUser } from "@/lib/authz";
import { ASSISTANT_SCOPES, newAssistantKey, scopesText } from "@/lib/assistant-keys";
import { recordAdminEvent } from "@/lib/admin-events";

/**
 * The Team page's Assistants section: admins add a chat assistant, decide
 * what it may do, hand it a key, and switch it off. The key is returned once
 * and never again (only its hash is stored); a lost key is replaced, not
 * recovered. Every step lands in the admin trail.
 */

export type AssistantActionResult = { error?: "invalid" | "limit" | "not-found"; key?: string };

/** Enough for a few tools; a company that wants more is doing something odd. */
const MAX_ASSISTANTS = 5;

const nameInput = z.string().trim().min(1).max(60);
const scopesInput = z.array(z.enum(ASSISTANT_SCOPES)).max(ASSISTANT_SCOPES.length);
const idInput = z.number().int().positive();

const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

function refresh() {
  revalidatePath("/[locale]/users", "page");
}

/** An assistant account of the admin's company, or null. */
async function findAssistant(admin: SessionUser, id: number) {
  if (!idInput.safeParse(id).success) return null;
  return db
    .select({ id: users.id, active: users.active, name: users.name })
    .from(users)
    .where(and(eq(users.companyId, admin.companyId), eq(users.id, id), eq(users.kind, "assistant")))
    .limit(1)
    .then(one);
}

export async function createAssistant(name: string, scopes: string[]): Promise<AssistantActionResult> {
  const admin = await requireAdmin();
  const parsedName = nameInput.safeParse(name);
  const parsedScopes = scopesInput.safeParse(scopes);
  if (!parsedName.success || !parsedScopes.success) return { error: "invalid" };

  const [{ n }] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.companyId, admin.companyId), eq(users.kind, "assistant"), eq(users.active, true)));
  if (n >= MAX_ASSISTANTS) return { error: "limit" };

  const allowed = scopesText(parsedScopes.data);
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        companyId: admin.companyId,
        // Emails are unique and required; an assistant has none, and .invalid
        // can never receive mail (RFC 2606).
        email: `assistant-${crypto.randomBytes(8).toString("hex")}@assistant.invalid`,
        // No bcrypt hash: no password can ever match. Sign-in refuses assistants anyway.
        passwordHash: "!",
        name: parsedName.data,
        role: "collaborator",
        kind: "assistant",
      })
      .returning({ id: users.id });
    const fresh = newAssistantKey(row.id);
    await tx.insert(assistantKeys).values({
      companyId: admin.companyId,
      userId: row.id,
      tokenHash: fresh.hash,
      scopes: allowed,
      createdBy: admin.id,
    });
    return { id: row.id, key: fresh.key };
  });

  await recordAdminEvent({
    companyId: admin.companyId,
    actorUserId: admin.id,
    action: "assistant-created",
    targetUserId: created.id,
    detail: allowed || "read",
  });
  refresh();
  return { key: created.key };
}

export async function setAssistantScopes(id: number, scopes: string[]): Promise<AssistantActionResult> {
  const admin = await requireAdmin();
  const parsed = scopesInput.safeParse(scopes);
  if (!parsed.success) return { error: "invalid" };
  if (!(await findAssistant(admin, id))) return { error: "not-found" };
  const allowed = scopesText(parsed.data);
  await db
    .update(assistantKeys)
    .set({ scopes: allowed })
    .where(and(eq(assistantKeys.companyId, admin.companyId), eq(assistantKeys.userId, id)));
  await recordAdminEvent({
    companyId: admin.companyId,
    actorUserId: admin.id,
    action: "assistant-allowed",
    targetUserId: id,
    detail: allowed || "read",
  });
  refresh();
  return {};
}

/**
 * A new key: the old one stops working at once. Also how a switched-off
 * assistant comes back — never with the key it had, which may be why it
 * was switched off.
 */
export async function issueAssistantKey(id: number): Promise<AssistantActionResult> {
  const admin = await requireAdmin();
  const target = await findAssistant(admin, id);
  if (!target) return { error: "not-found" };
  if (!target.active) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.companyId, admin.companyId), eq(users.kind, "assistant"), eq(users.active, true)));
    if (n >= MAX_ASSISTANTS) return { error: "limit" };
  }
  const fresh = newAssistantKey(id);
  await db.transaction(async (tx) => {
    await tx
      .update(assistantKeys)
      .set({ tokenHash: fresh.hash, keyIssuedAt: stamp(), lastUsedAt: null })
      .where(and(eq(assistantKeys.companyId, admin.companyId), eq(assistantKeys.userId, id)));
    if (!target.active) {
      await tx.update(users).set({ active: true }).where(and(eq(users.companyId, admin.companyId), eq(users.id, id)));
    }
  });
  await recordAdminEvent({
    companyId: admin.companyId,
    actorUserId: admin.id,
    action: target.active ? "assistant-key" : "assistant-on",
    targetUserId: id,
  });
  refresh();
  return { key: fresh.key };
}

/** Off at once: its next request is refused. Its history keeps its name. */
export async function switchOffAssistant(id: number): Promise<AssistantActionResult> {
  const admin = await requireAdmin();
  const target = await findAssistant(admin, id);
  if (!target) return { error: "not-found" };
  if (target.active) {
    await db.update(users).set({ active: false }).where(and(eq(users.companyId, admin.companyId), eq(users.id, id)));
    await recordAdminEvent({ companyId: admin.companyId, actorUserId: admin.id, action: "assistant-off", targetUserId: id });
  }
  refresh();
  return {};
}
