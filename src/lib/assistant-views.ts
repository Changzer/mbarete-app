import type { FollowupStage } from "@/lib/followup-stages";

/**
 * What the assistant API says, shaped for a chat assistant rather than a
 * page: plain names in both languages, ids and versions it needs to act,
 * and no money unless the admin ticked "prices". Pure functions, so what
 * leaves the app is tested without a database.
 */

export const STAGE_NAMES: Record<FollowupStage, { en: string; zh: string }> = {
  deposit: { en: "Deposit due", zh: "待付定金" },
  production: { en: "In production", zh: "生产中" },
  qc: { en: "Quality check", zh: "验货" },
  to_warehouse: { en: "To warehouse", zh: "发往仓库" },
  at_warehouse: { en: "At warehouse", zh: "已入仓" },
};

type Person = { id: number; name: string };
type Money = { currency: string; amount: number }[];

export type CardInput = {
  id: number;
  version: number;
  kind: "supplier" | "unassigned" | "shipment";
  stage: FollowupStage;
  orderId: number;
  orderNumber: string;
  clientName: string;
  nextStep: string;
  nextDue: string | null;
  nextOwnerId: number | null;
  problem: string;
  comments: number;
  checklistDone: number;
  checklistTotal: number;
  touchedAt: string;
  // supplier and unassigned cards
  supplierName?: string;
  supplierNameAlt?: string;
  mainProductName?: string;
  otherLines?: number;
  pieces?: number;
  cost?: Money;
  // shipment cards
  shippedOn?: string | null;
  productNames?: string[];
  supplierNames?: string[];
  docsDone?: number;
  docsRequired?: number;
  complete?: boolean;
};

export function cardView(card: CardInput, people: Map<number, string>, prices: boolean) {
  const owner: Person | null =
    card.nextOwnerId === null ? null : { id: card.nextOwnerId, name: people.get(card.nextOwnerId) ?? "?" };
  const common = {
    id: card.id,
    version: card.version,
    order: { id: card.orderId, number: card.orderNumber },
    client: card.clientName,
    nextStep: card.nextStep,
    nextDue: card.nextDue,
    nextOwner: owner,
    problem: card.problem,
    checklist: { done: card.checklistDone, total: card.checklistTotal },
    updates: card.comments,
    lastActivity: card.touchedAt,
  };
  if (card.kind === "shipment") {
    return {
      ...common,
      type: "shipment" as const,
      shippedOn: card.shippedOn ?? null,
      products: card.productNames ?? [],
      suppliers: card.supplierNames ?? [],
      documents: { done: card.docsDone ?? 0, required: card.docsRequired ?? 0, complete: Boolean(card.complete) },
    };
  }
  return {
    ...common,
    type: card.kind,
    stage: card.stage,
    stageName: STAGE_NAMES[card.stage],
    supplier: { name: card.supplierName ?? "", alt: card.supplierNameAlt ?? "" },
    product: card.mainProductName ?? "",
    otherProducts: card.otherLines ?? 0,
    pieces: card.pieces ?? 0,
    ...(prices ? { cost: card.cost ?? [] } : {}),
  };
}

/** Lowercased, whitespace-collapsed text for "does this card mention q". */
export function haystack(parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function matchesQuery(text: string, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => text.includes(w));
}

/** A LIKE pattern that matches q literally, wherever it sits. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export type ContactRow = {
  id: number;
  type: "supplier" | "client";
  companyName: string;
  companyNameZh: string;
  contactPerson: string;
  phone: string;
  email: string;
  whatsapp: string;
  wechat: string;
  boothLocation: string;
  province: string;
  city: string;
  taxId: string;
  notes: string;
  active: boolean;
};

/** Bank details never leave through the assistant API, whatever it is allowed. */
export function contactView(c: ContactRow) {
  return {
    id: c.id,
    type: c.type,
    name: c.companyName,
    nameZh: c.companyNameZh,
    person: c.contactPerson,
    phone: c.phone,
    email: c.email,
    whatsapp: c.whatsapp,
    wechat: c.wechat,
    booth: c.boothLocation,
    province: c.province,
    city: c.city,
    taxId: c.taxId,
    notes: c.notes,
    active: c.active,
  };
}

/** The JSON fields an assistant may write on a contact, and the form field each fills. */
export const CONTACT_FIELDS = {
  name: "companyName",
  nameZh: "companyNameZh",
  person: "contactPerson",
  phone: "phone",
  email: "email",
  whatsapp: "whatsapp",
  wechat: "wechat",
  booth: "boothLocation",
  province: "province",
  city: "city",
  taxId: "taxId",
  notes: "notes",
} as const satisfies Record<string, keyof ContactRow>;
