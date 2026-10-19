import { z } from "zod";
import { FOLLOWUP_STAGES, type FollowupStage } from "@/lib/followup-stages";

/**
 * The follow-up board's rules, kept pure so the board, the card panel and
 * the server actions read them the same way.
 *
 * One card per supplier on a confirmed order moves through five stages on
 * its own. The order then ships as one, and from that point a single card
 * per order tracks the export paperwork. Who does the next step is a person,
 * not a role: payments tend to be the owner's, chasing factories the
 * assistant's, and the card shows whose turn it is.
 */

export { FOLLOWUP_STAGES, type FollowupStage };

export type FollowupKind = "supplier" | "unassigned" | "shipment";

/**
 * What the next step is when nobody has typed one: the stage's ordinary
 * action, so a fresh card already says something useful and nobody has to
 * write "pay deposit" forty times. null means nothing is pending.
 */
export type DefaultNextKey =
  | "deposit"
  | "production"
  | "qc"
  | "to_warehouse"
  | "unassigned"
  | "shipment";

export function defaultNextKey(kind: FollowupKind, stage: FollowupStage): DefaultNextKey | null {
  if (kind === "shipment") return "shipment";
  if (kind === "unassigned") return "unassigned";
  return stage === "at_warehouse" ? null : stage;
}

export function nextStageOf(stage: FollowupStage): FollowupStage | null {
  const i = FOLLOWUP_STAGES.indexOf(stage);
  return i >= 0 && i < FOLLOWUP_STAGES.length - 1 ? FOLLOWUP_STAGES[i + 1] : null;
}

export type DueState = "none" | "overdue" | "today" | "soon" | "later";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

/** A local calendar date as YYYY-MM-DD: the date the person at the screen is living. */
export function localIsoDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * How urgent a due date is, against the viewer's today. "Soon" is the next
 * two days — close enough to plan around, not yet late. A missing date is
 * "none", never "overdue": an unpaid balance with no agreed date is not late.
 */
export function dueState(due: string | null | undefined, today: string): { state: DueState; days: number } {
  if (!due || !ISO_DATE.test(due) || !ISO_DATE.test(today)) return { state: "none", days: 0 };
  const diff = dayNumber(due) - dayNumber(today);
  if (diff < 0) return { state: "overdue", days: -diff };
  if (diff === 0) return { state: "today", days: 0 };
  if (diff <= 2) return { state: "soon", days: diff };
  return { state: "later", days: diff };
}

const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_ZH = "日一二三四五六";

/**
 * "Wed 21 Oct" / "10月21日周三" — a date someone agreed, read in the UI language.
 * Spelled out by hand: Node's and the browser's Intl disagree on the comma
 * ("Wed 21 Oct" vs "Wed, 21 Oct"), and the board is rendered by both.
 */
export function formatDay(iso: string, locale: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.getUTCDate();
  const month = date.getUTCMonth();
  const weekday = date.getUTCDay();
  return locale === "zh"
    ? `${month + 1}月${day}日周${WEEKDAYS_ZH[weekday]}`
    : `${WEEKDAYS_EN[weekday]} ${day} ${MONTHS_EN[month]}`;
}

/**
 * A face's letters: two initials for a Latin full name, else the Chinese
 * name's character that people call each other by — 李 for "小李", 王 for
 * "王伟" — skipping the 小/老/阿 that only says how close you are.
 */
export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const latin = trimmed.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  if (latin.length >= 2) return (latin[0][0] + latin[1][0]).toUpperCase();
  const cjk = [...trimmed].filter((ch) => /[\u3400-\u9fff]/.test(ch));
  if (cjk.length) return cjk.length > 1 && "小老阿".includes(cjk[0]) ? cjk[1] : cjk[0];
  return trimmed[0].toUpperCase();
}

export type AttentionInput = {
  kind: FollowupKind;
  nextDue: string | null;
  problem: string;
};

/**
 * Needs attention: a next step past its date, a flagged problem, or lines
 * nobody can follow up because they have no supplier. Missing figures and
 * unpaid balances are not on the list by themselves — they are normal until
 * a date says otherwise.
 */
export function needsAttention(card: AttentionInput, today: string): boolean {
  if (card.problem.trim() !== "") return true;
  if (card.kind === "unassigned") return true;
  return dueState(card.nextDue, today).state === "overdue";
}

/** Whether someone has something to do on this card right now. */
export function hasPendingStep(card: { kind: FollowupKind; stage: FollowupStage; nextStep: string; complete?: boolean }): boolean {
  if (card.nextStep.trim() !== "") return true;
  if (card.kind === "shipment") return !card.complete;
  return defaultNextKey(card.kind, card.stage) !== null;
}

// --- grouping an order's lines under its cards -------------------------------

export type FollowupLine = {
  orderId: number;
  supplierId: number | null;
  supplierNameEn: string;
  supplierNameZh: string;
  productId: number;
  name: string;
  quantity: number;
  lineTotal: number;
  currency: string;
};

export type LineGroup = {
  orderId: number;
  supplierId: number | null;
  /** The name to lead with: Chinese when the order recorded one. */
  supplierName: string;
  /** The other language's name, when it differs; "" otherwise. */
  supplierNameAlt: string;
  /** The line the most money goes to: what this card is "about". */
  mainProductId: number;
  mainProductName: string;
  otherLines: number;
  pieces: number;
  /** Cost per currency, in the order the currencies first appear. */
  cost: { currency: string; amount: number }[];
};

export function groupKey(orderId: number, supplierId: number | null): string {
  return `${orderId}:${supplierId ?? "none"}`;
}

/**
 * The order's lines as the board sees them: one group per order and saved
 * supplier, led by the line worth the most (ties go to the bigger quantity,
 * then the name) because a factory is remembered by what it makes for you.
 */
export function groupLines(lines: FollowupLine[]): Map<string, LineGroup> {
  const buckets = new Map<string, FollowupLine[]>();
  for (const line of lines) {
    const key = groupKey(line.orderId, line.supplierId);
    const list = buckets.get(key);
    if (list) list.push(line);
    else buckets.set(key, [line]);
  }
  const groups = new Map<string, LineGroup>();
  for (const [key, list] of buckets) {
    const main = [...list].sort(
      (a, b) => b.lineTotal - a.lineTotal || b.quantity - a.quantity || a.name.localeCompare(b.name) || a.productId - b.productId,
    )[0];
    const named = list.find((l) => l.supplierNameZh || l.supplierNameEn) ?? list[0];
    const zh = named.supplierNameZh.trim();
    const en = named.supplierNameEn.trim();
    const cost: { currency: string; amount: number }[] = [];
    for (const line of list) {
      const entry = cost.find((c) => c.currency === line.currency);
      if (entry) entry.amount = Math.round((entry.amount + line.lineTotal) * 100) / 100;
      else cost.push({ currency: line.currency, amount: line.lineTotal });
    }
    groups.set(key, {
      orderId: list[0].orderId,
      supplierId: list[0].supplierId,
      supplierName: zh || en,
      supplierNameAlt: zh && en && zh !== en ? en : "",
      mainProductId: main.productId,
      mainProductName: main.name,
      otherLines: list.length - 1,
      pieces: list.reduce((sum, l) => sum + l.quantity, 0),
      cost,
    });
  }
  return groups;
}

// --- input validation ---------------------------------------------------------

const isoDateOrBlank = z
  .union([z.string().trim().regex(ISO_DATE), z.literal(""), z.null()])
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "date");

const oneLine = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

export const nextStepInput = z.object({
  nextStep: oneLine(200),
  nextDue: isoDateOrBlank,
  nextOwnerId: z.number().int().positive().nullable(),
});
export type NextStepInput = z.infer<typeof nextStepInput>;

export const problemInput = oneLine(200);

export const checklistTextInput = oneLine(200).pipe(z.string().min(1));

/** An update keeps its line breaks; only the ends are trimmed. */
export const updateBodyInput = z
  .string()
  .transform((v) => v.replace(/\r\n?/g, "\n").trim())
  .pipe(z.string().max(4000));

export const clientKeyInput = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

export const MAX_UPDATE_FILES = 6;

// --- feed payloads -----------------------------------------------------------

/** What each kind of feed entry carries, so the panel can say what happened. */
export type EntryPayload =
  | { kind: "stage"; from: FollowupStage; to: FollowupStage }
  | { kind: "next_step"; text: string; due: string | null; ownerId: number | null }
  | { kind: "problem"; text: string }
  | { kind: "check_added" | "check_done" | "check_undone" | "check_removed"; text: string };

export function parsePayload(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Stored "YYYY-MM-DD HH:MM:SS" UTC (or ISO) as a real ISO instant for the browser. */
export function utcStampToIso(stamp: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp) ? `${stamp.replace(" ", "T")}Z` : stamp;
}
