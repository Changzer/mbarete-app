"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db, one } from "@/db";
import {
  followupAttachments,
  followupCards,
  followupChecklistItems,
  followupEntries,
  users,
} from "@/db/schema";
import { requireUser, requireModuleAction, type SessionUser } from "@/lib/authz";
import {
  deleteUpload,
  FileTooLargeError,
  saveUploadedDocument,
  StorageFullError,
  UnsupportedFileTypeError,
} from "@/lib/uploads";
import { findCard, getFollowupCardDetail, type FollowupCardDetail } from "@/lib/followup-server";
import {
  checklistTextInput,
  clientKeyInput,
  MAX_UPDATE_FILES,
  nextStepInput,
  problemInput,
  updateBodyInput,
} from "@/lib/followup";
import { FOLLOWUP_STAGES } from "@/lib/followup-stages";
import type { Locale } from "@/i18n/routing";

/**
 * The follow-up board's writes. Every one re-checks the session and the
 * orders module, and scopes by company in SQL on top of RLS.
 *
 * Card fields (stage, next step, problem) are guarded by the card's version:
 * a stale panel loses to a newer save and is told so, instead of quietly
 * undoing a colleague's change. Checklist ticks and posts are set-to-value
 * and keyed, so a double click or a retried request lands once.
 */

export type FollowupResult = { error?: string; version?: number };

async function requireSession() {
  const user = await requireUser();
  await requireModuleAction(user, "orders");
  return user;
}

function refresh() {
  revalidatePath("/[locale]/followup", "page");
}

/** A person of this company who can take work: active, same company, not an assistant. */
async function validOwner(user: SessionUser, ownerId: number | null): Promise<boolean> {
  if (ownerId === null) return true;
  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.companyId, user.companyId), eq(users.id, ownerId), eq(users.active, true), eq(users.kind, "person")))
    .limit(1)
    .then(one);
  return Boolean(row);
}

const idInput = z.number().int().positive();
const versionInput = z.number().int().min(1);

export async function moveFollowupCard(cardId: number, stage: string, expectedVersion: number): Promise<FollowupResult> {
  const user = await requireSession();
  const parsed = z
    .object({ cardId: idInput, stage: z.enum(FOLLOWUP_STAGES), version: versionInput })
    .safeParse({ cardId, stage, version: expectedVersion });
  if (!parsed.success) return { error: "invalid" };
  const card = await findCard(user.companyId, parsed.data.cardId);
  if (!card) return { error: "notFound" };
  // Only a supplier's goods move through production; the other cards have no stages.
  if (card.kind !== "supplier") return { error: "invalid" };
  if (card.version !== parsed.data.version) return { error: "conflict" };
  if (card.stage === parsed.data.stage) return { version: card.version };

  const version = await db.transaction(async (tx) => {
    const won = await tx
      .update(followupCards)
      .set({
        stage: parsed.data.stage,
        // The typed step belonged to the stage being left; the new stage
        // starts from its own default. Who holds it stays the same.
        nextStep: "",
        nextDue: null,
        // A new stage is a new step for whoever holds the card: their bell
        // says so unless they moved it themselves.
        nextAssignedBy: user.id,
        nextAssignedAt: sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`,
        version: card.version + 1,
        updatedBy: user.id,
        updatedAt: sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`,
      })
      .where(and(eq(followupCards.companyId, user.companyId), eq(followupCards.id, card.id), eq(followupCards.version, card.version)))
      .returning({ version: followupCards.version });
    if (won.length === 0) return null;
    await tx.insert(followupEntries).values({
      companyId: user.companyId,
      cardId: card.id,
      userId: user.id,
      kind: "stage",
      payload: JSON.stringify({ from: card.stage, to: parsed.data.stage }),
    });
    return won[0].version;
  });
  if (version === null) return { error: "conflict" };
  refresh();
  return { version };
}

export async function setFollowupNextStep(
  cardId: number,
  input: { nextStep: string; nextDue: string | null; nextOwnerId: number | null },
  expectedVersion: number,
): Promise<FollowupResult> {
  const user = await requireSession();
  const parsed = nextStepInput.safeParse(input);
  if (!parsed.success || !idInput.safeParse(cardId).success || !versionInput.safeParse(expectedVersion).success) {
    return { error: "invalid" };
  }
  const card = await findCard(user.companyId, cardId);
  if (!card) return { error: "notFound" };
  if (card.version !== expectedVersion) return { error: "conflict" };
  const next = parsed.data;
  // A new owner must be able to take work; keeping a since-deactivated one
  // while fixing the wording is not a new assignment.
  if (next.nextOwnerId !== card.nextOwnerId && !(await validOwner(user, next.nextOwnerId))) return { error: "owner" };
  if (card.nextStep === next.nextStep && card.nextDue === next.nextDue && card.nextOwnerId === next.nextOwnerId) {
    return { version: card.version };
  }

  const version = await db.transaction(async (tx) => {
    const won = await tx
      .update(followupCards)
      .set({
        nextStep: next.nextStep,
        nextDue: next.nextDue,
        nextOwnerId: next.nextOwnerId,
        nextAssignedBy: user.id,
        nextAssignedAt: sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`,
        version: card.version + 1,
        updatedBy: user.id,
        updatedAt: sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`,
      })
      .where(and(eq(followupCards.companyId, user.companyId), eq(followupCards.id, card.id), eq(followupCards.version, card.version)))
      .returning({ version: followupCards.version });
    if (won.length === 0) return null;
    await tx.insert(followupEntries).values({
      companyId: user.companyId,
      cardId: card.id,
      userId: user.id,
      kind: "next_step",
      payload: JSON.stringify({ text: next.nextStep, due: next.nextDue, ownerId: next.nextOwnerId }),
    });
    return won[0].version;
  });
  if (version === null) return { error: "conflict" };
  refresh();
  return { version };
}

export async function setFollowupProblem(cardId: number, problem: string, expectedVersion: number): Promise<FollowupResult> {
  const user = await requireSession();
  const parsed = problemInput.safeParse(problem);
  if (!parsed.success || !idInput.safeParse(cardId).success || !versionInput.safeParse(expectedVersion).success) {
    return { error: "invalid" };
  }
  const card = await findCard(user.companyId, cardId);
  if (!card) return { error: "notFound" };
  if (card.version !== expectedVersion) return { error: "conflict" };
  if (card.problem === parsed.data) return { version: card.version };

  const version = await db.transaction(async (tx) => {
    const won = await tx
      .update(followupCards)
      .set({
        problem: parsed.data,
        version: card.version + 1,
        updatedBy: user.id,
        updatedAt: sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`,
      })
      .where(and(eq(followupCards.companyId, user.companyId), eq(followupCards.id, card.id), eq(followupCards.version, card.version)))
      .returning({ version: followupCards.version });
    if (won.length === 0) return null;
    await tx.insert(followupEntries).values({
      companyId: user.companyId,
      cardId: card.id,
      userId: user.id,
      kind: "problem",
      payload: JSON.stringify({ text: parsed.data }),
    });
    return won[0].version;
  });
  if (version === null) return { error: "conflict" };
  refresh();
  return { version };
}

export async function addFollowupChecklistItem(cardId: number, text: string, ownerId: number | null): Promise<FollowupResult> {
  const user = await requireSession();
  const parsed = checklistTextInput.safeParse(text);
  const owner = idInput.nullable().safeParse(ownerId);
  if (!parsed.success || !owner.success || !idInput.safeParse(cardId).success) return { error: "invalid" };
  if (!(await validOwner(user, owner.data))) return { error: "owner" };
  const card = await findCard(user.companyId, cardId);
  if (!card) return { error: "notFound" };

  await db.transaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${followupChecklistItems.position}), -1)::int + 1` })
      .from(followupChecklistItems)
      .where(and(eq(followupChecklistItems.companyId, user.companyId), eq(followupChecklistItems.cardId, card.id)));
    await tx.insert(followupChecklistItems).values({
      companyId: user.companyId,
      cardId: card.id,
      text: parsed.data,
      ownerId: owner.data,
      assignedBy: owner.data === null ? null : user.id,
      assignedAt: owner.data === null ? null : sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`,
      position: next,
      createdBy: user.id,
    });
    await tx.insert(followupEntries).values({
      companyId: user.companyId,
      cardId: card.id,
      userId: user.id,
      kind: "check_added",
      payload: JSON.stringify({ text: parsed.data }),
    });
  });
  refresh();
  return {};
}

/** Sets, never toggles: a double click or a retried request cannot flip it back. */
export async function setFollowupChecklistDone(itemId: number, done: boolean): Promise<FollowupResult> {
  const user = await requireSession();
  if (!idInput.safeParse(itemId).success || typeof done !== "boolean") return { error: "invalid" };
  const changed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(followupChecklistItems)
      .set({
        done,
        doneBy: done ? user.id : null,
        doneAt: done ? sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')` : null,
      })
      .where(and(
        eq(followupChecklistItems.companyId, user.companyId),
        eq(followupChecklistItems.id, itemId),
        ne(followupChecklistItems.done, done),
      ))
      .returning({ cardId: followupChecklistItems.cardId, text: followupChecklistItems.text });
    if (rows.length === 0) return false;
    await tx.insert(followupEntries).values({
      companyId: user.companyId,
      cardId: rows[0].cardId,
      userId: user.id,
      kind: done ? "check_done" : "check_undone",
      payload: JSON.stringify({ text: rows[0].text }),
    });
    return true;
  });
  if (changed) refresh();
  return {};
}

export async function setFollowupChecklistOwner(itemId: number, ownerId: number | null): Promise<FollowupResult> {
  const user = await requireSession();
  const owner = idInput.nullable().safeParse(ownerId);
  if (!idInput.safeParse(itemId).success || !owner.success) return { error: "invalid" };
  if (!(await validOwner(user, owner.data))) return { error: "owner" };
  await db
    .update(followupChecklistItems)
    .set({
      ownerId: owner.data,
      assignedBy: owner.data === null ? null : user.id,
      assignedAt: owner.data === null ? null : sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`,
    })
    .where(and(eq(followupChecklistItems.companyId, user.companyId), eq(followupChecklistItems.id, itemId)));
  refresh();
  return {};
}

export async function removeFollowupChecklistItem(itemId: number): Promise<FollowupResult> {
  const user = await requireSession();
  if (!idInput.safeParse(itemId).success) return { error: "invalid" };
  await db.transaction(async (tx) => {
    const rows = await tx
      .delete(followupChecklistItems)
      .where(and(eq(followupChecklistItems.companyId, user.companyId), eq(followupChecklistItems.id, itemId)))
      .returning({ cardId: followupChecklistItems.cardId, text: followupChecklistItems.text });
    if (rows.length === 0) return;
    // The item goes; the feed keeps saying it existed.
    await tx.insert(followupEntries).values({
      companyId: user.companyId,
      cardId: rows[0].cardId,
      userId: user.id,
      kind: "check_removed",
      payload: JSON.stringify({ text: rows[0].text }),
    });
  });
  refresh();
  return {};
}

/**
 * An update: words, photos and files, posted together. The browser sends a
 * key it made for this post, so a retry after a lost response finds the
 * first save instead of making a second.
 */
export async function postFollowupUpdate(formData: FormData): Promise<FollowupResult> {
  const user = await requireSession();
  const cardId = Number(formData.get("cardId"));
  const body = updateBodyInput.safeParse(String(formData.get("body") ?? ""));
  const clientKey = clientKeyInput.safeParse(String(formData.get("clientKey") ?? ""));
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!idInput.safeParse(cardId).success || !body.success || !clientKey.success) return { error: "invalid" };
  if (body.data === "" && files.length === 0) return { error: "empty" };
  if (files.length > MAX_UPDATE_FILES) return { error: "tooManyFiles" };
  const card = await findCard(user.companyId, cardId);
  if (!card) return { error: "notFound" };

  const already = await db
    .select({ id: followupEntries.id })
    .from(followupEntries)
    .where(and(eq(followupEntries.companyId, user.companyId), eq(followupEntries.clientKey, clientKey.data)))
    .limit(1)
    .then(one);
  if (already) return {};

  const saved: { path: string; name: string; size: number }[] = [];
  try {
    for (const file of files) {
      saved.push({ path: await saveUploadedDocument(user.companyId, file), name: file.name || "file", size: file.size });
    }
  } catch (err) {
    for (const s of saved) await deleteUpload(s.path);
    if (err instanceof FileTooLargeError) return { error: "size" };
    if (err instanceof StorageFullError) return { error: "storageFull" };
    if (err instanceof UnsupportedFileTypeError) return { error: "fileType" };
    throw err;
  }

  let inserted = false;
  try {
    inserted = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(followupEntries)
        .values({
          companyId: user.companyId,
          cardId: card.id,
          userId: user.id,
          kind: "comment",
          body: body.data,
          clientKey: clientKey.data,
        })
        .onConflictDoNothing()
        .returning({ id: followupEntries.id });
      if (rows.length === 0) return false;
      for (const s of saved) {
        await tx.insert(followupAttachments).values({
          companyId: user.companyId,
          entryId: rows[0].id,
          path: s.path,
          originalName: s.name.slice(0, 200),
          sizeBytes: s.size,
        });
      }
      return true;
    });
  } catch (err) {
    for (const s of saved) await deleteUpload(s.path);
    throw err;
  }
  // A concurrent retry won the race: its files are the record, these are spares.
  if (!inserted) for (const s of saved) await deleteUpload(s.path);
  refresh();
  return {};
}

/**
 * Takes a post off the feed without erasing that it was there: the row stays,
 * marked removed, and the feed shows who removed it. Its author or an admin.
 */
export async function removeFollowupUpdate(entryId: number): Promise<FollowupResult> {
  const user = await requireSession();
  if (!idInput.safeParse(entryId).success) return { error: "invalid" };
  const entry = await db
    .select()
    .from(followupEntries)
    .where(and(eq(followupEntries.companyId, user.companyId), eq(followupEntries.id, entryId)))
    .limit(1)
    .then(one);
  if (!entry || entry.kind !== "comment") return { error: "notFound" };
  if (entry.userId !== user.id && user.role !== "admin") return { error: "forbidden" };
  await db
    .update(followupEntries)
    .set({ removedAt: sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`, removedBy: user.id })
    .where(and(eq(followupEntries.companyId, user.companyId), eq(followupEntries.id, entryId), isNull(followupEntries.removedAt)));
  refresh();
  return {};
}

/** The card panel's contents, read fresh each time it opens or changes. */
export async function loadFollowupCard(cardId: number): Promise<FollowupCardDetail | null> {
  const user = await requireSession();
  if (!idInput.safeParse(cardId).success) return null;
  return getFollowupCardDetail(user.companyId, cardId, (await getLocale()) as Locale);
}
