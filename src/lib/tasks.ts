import { defaultNextKey, dueState, type DefaultNextKey, type FollowupKind } from "@/lib/followup";
import type { FollowupStage } from "@/lib/followup-stages";

/**
 * The task bell: what is waiting on one person across the follow-up board —
 * the cards whose next step is theirs and the checklist items given to them.
 * Read from the board itself, so a step done, moved on or handed to someone
 * else leaves the bell without anything to dismiss. "New" is what someone
 * else handed them since they last opened the bell.
 */

/** A card as the bell needs it; the board's card views carry all of this. */
export type TaskCardInput = {
  id: number;
  orderId: number;
  orderNumber: string;
  kind: FollowupKind;
  stage: FollowupStage;
  nextStep: string;
  nextDue: string | null;
  nextOwnerId: number | null;
  nextAssignedBy: number | null;
  /** ISO instant, or null when nobody has set the step since the card was made. */
  nextAssignedAt: string | null;
  /** Shipment cards only: every export document is in. */
  complete?: boolean;
  supplierName: string;
  supplierNameAlt: string;
  productName: string;
  otherLines: number;
};

export type TaskItemInput = {
  id: number;
  cardId: number;
  text: string;
  assignedBy: number | null;
  assignedAt: string | null;
};

export type MyTask = {
  /** Stable across reloads: "step:12" or "check:34". */
  key: string;
  source: "step" | "check";
  cardId: number;
  orderId: number;
  orderNumber: string;
  cardKind: FollowupKind;
  /** What to do, in whoever's words; "" means the stage's default, named by defaultKey. */
  text: string;
  defaultKey: DefaultNextKey | null;
  due: string | null;
  supplierName: string;
  supplierNameAlt: string;
  productName: string;
  otherLines: number;
  /** Who handed it over, when that was someone else. */
  fromId: number | null;
  assignedAt: string | null;
  isNew: boolean;
};

function pendingStep(card: TaskCardInput): boolean {
  if (card.nextStep.trim() !== "") return true;
  if (card.kind === "shipment") return !card.complete;
  return defaultNextKey(card.kind, card.stage) !== null;
}

function handedOver(by: number | null, at: string | null, userId: number, seenAt: string | null) {
  const fromId = by !== null && by !== userId ? by : null;
  return { fromId, isNew: fromId !== null && at !== null && (seenAt === null || at > seenAt) };
}

/**
 * One person's tasks from the cards on the board and the open checklist
 * items they own. Items on a card that has left the board (its order
 * shipped, its supplier taken off) are not work any more and are dropped.
 */
export function collectTasks(
  cards: TaskCardInput[],
  items: TaskItemInput[],
  userId: number,
  seenAt: string | null,
): MyTask[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const context = (card: TaskCardInput) => ({
    cardId: card.id,
    orderId: card.orderId,
    orderNumber: card.orderNumber,
    cardKind: card.kind,
    supplierName: card.supplierName,
    supplierNameAlt: card.supplierNameAlt,
    productName: card.productName,
    otherLines: card.otherLines,
  });
  const tasks: MyTask[] = [];
  for (const card of cards) {
    if (card.nextOwnerId !== userId || !pendingStep(card)) continue;
    const typed = card.nextStep.trim();
    tasks.push({
      key: `step:${card.id}`,
      source: "step",
      ...context(card),
      text: typed,
      defaultKey: typed ? null : defaultNextKey(card.kind, card.stage),
      due: card.nextDue,
      assignedAt: card.nextAssignedAt,
      ...handedOver(card.nextAssignedBy, card.nextAssignedAt, userId, seenAt),
    });
  }
  for (const item of items) {
    const card = byId.get(item.cardId);
    if (!card) continue;
    tasks.push({
      key: `check:${item.id}`,
      source: "check",
      ...context(card),
      text: item.text,
      defaultKey: null,
      due: null,
      assignedAt: item.assignedAt,
      ...handedOver(item.assignedBy, item.assignedAt, userId, seenAt),
    });
  }
  return tasks;
}

const URGENCY = { overdue: 0, today: 1, soon: 2, later: 3, none: 4 } as const;

/**
 * New first (latest handed over on top), then by date: overdue, today, the
 * next days, undated last. Ties keep the board's order of cards.
 */
export function sortTasks(tasks: MyTask[], today: string): MyTask[] {
  return tasks
    .map((task, i) => ({ task, i, urgency: URGENCY[dueState(task.due, today).state] }))
    .sort(
      (a, b) =>
        Number(b.task.isNew) - Number(a.task.isNew) ||
        (a.task.isNew ? (b.task.assignedAt ?? "").localeCompare(a.task.assignedAt ?? "") : 0) ||
        a.urgency - b.urgency ||
        (a.task.due ?? "").localeCompare(b.task.due ?? "") ||
        a.i - b.i,
    )
    .map((x) => x.task);
}

/** The number on the bell: tasks that are new or past their date. */
export function bellCount(tasks: MyTask[], today: string): number {
  return tasks.filter((t) => t.isNew || dueState(t.due, today).state === "overdue").length;
}
