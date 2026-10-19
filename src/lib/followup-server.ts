import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, one } from "@/db";
import {
  contacts,
  followupAttachments,
  followupCards,
  followupChecklistItems,
  followupEntries,
  orderDocuments,
  orderEvents,
  orderItems,
  orders,
  products,
  users,
} from "@/db/schema";
import { getImagesByProduct } from "@/lib/queries/catalog";
import { localizeField } from "@/lib/localize";
import type { Locale } from "@/i18n/routing";
import { computeDossierStatus, DOSSIER_ITEMS, DOSSIER_KINDS, type Responsible, type TaxRegime } from "@/lib/dossier";
import { groupKey, groupLines, parsePayload, utcStampToIso, type FollowupLine } from "@/lib/followup";
import type { FollowupEntryKind, FollowupStage } from "@/lib/followup-stages";

/**
 * The board's reads, and the one write a read needs: making sure every
 * confirmed or shipped order has its cards.
 *
 * Cards are derived from the order's saved supplier identities (the line
 * snapshots), never from the live catalog, so a supplier's history cannot
 * move to another factory because a product was reassigned later.
 */

/**
 * One card per supplier on every confirmed or shipped order, one for the lines
 * with no supplier, and one shipment card per shipped order. Idempotent: the
 * unique index makes a second run (or two people opening the board at once)
 * a no-op. The next step starts with whoever created the order — usually the
 * person who pays the deposit — and anyone can hand it on.
 */
export async function ensureFollowupCards(companyId: number) {
  await db.execute(sql`
    INSERT INTO followup_cards (company_id, order_id, kind, supplier_id, next_owner_id)
    SELECT DISTINCT o.company_id, o.id,
      CASE WHEN i.supplier_id_snapshot IS NULL THEN 'unassigned' ELSE 'supplier' END,
      i.supplier_id_snapshot, o.created_by
    FROM orders o
    JOIN order_items i ON i.order_id = o.id AND i.company_id = o.company_id
    WHERE o.company_id = ${companyId} AND o.status IN ('confirmed', 'shipped')
    ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    INSERT INTO followup_cards (company_id, order_id, kind, supplier_id, next_owner_id)
    SELECT o.company_id, o.id, 'shipment', NULL, o.created_by
    FROM orders o
    WHERE o.company_id = ${companyId} AND o.status = 'shipped'
    ON CONFLICT DO NOTHING`);
}

type CardCommon = {
  id: number;
  orderId: number;
  orderNumber: string;
  clientName: string;
  nextStep: string;
  nextDue: string | null;
  nextOwnerId: number | null;
  problem: string;
  version: number;
  comments: number;
  checklistDone: number;
  checklistTotal: number;
  /** The card's last change or post, for "latest first" inside a column. */
  touchedAt: string;
};

export type SupplierCardView = CardCommon & {
  kind: "supplier" | "unassigned";
  stage: FollowupStage;
  supplierName: string;
  supplierNameAlt: string;
  mainProductName: string;
  mainProductThumb: string | null;
  otherLines: number;
  pieces: number;
  cost: { currency: string; amount: number }[];
};

export type ShipmentCardView = CardCommon & {
  kind: "shipment";
  stage: FollowupStage;
  shippedOn: string | null;
  productNames: string[];
  supplierNames: string[];
  docsDone: number;
  docsRequired: number;
  missing: { responsible: Responsible; count: number }[];
  complete: boolean;
  regimeUndecided: boolean;
};

export type FollowupCardView = SupplierCardView | ShipmentCardView;

export type FollowupUser = { id: number; name: string; active: boolean };

export type FollowupBoard = {
  cards: SupplierCardView[];
  shipments: ShipmentCardView[];
  users: FollowupUser[];
};

/** How long a fully documented shipment stays on the board after shipping. */
const COMPLETE_SHIPMENT_DAYS = 14;

async function companyUsers(companyId: number): Promise<FollowupUser[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, active: users.active })
    .from(users)
    .where(eq(users.companyId, companyId))
    .orderBy(asc(users.name));
  return rows;
}

async function lineRows(orderIds: number[], locale: Locale) {
  if (orderIds.length === 0) return { lines: [] as FollowupLine[], productIds: [] as number[] };
  const rows = await db
    .select({
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      quantity: orderItems.quantity,
      lineTotal: orderItems.lineTotal,
      currency: orderItems.currencySnapshot,
      supplierId: orderItems.supplierIdSnapshot,
      supplierNameEn: orderItems.supplierNameEnSnapshot,
      supplierNameZh: orderItems.supplierNameZhSnapshot,
      nameEn: orderItems.nameEnSnapshot,
      nameZh: orderItems.nameZhSnapshot,
      productEn: products.nameEn,
      productZh: products.nameZh,
    })
    .from(orderItems)
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.id));
  const lines: FollowupLine[] = rows.map((r) => ({
    orderId: r.orderId,
    supplierId: r.supplierId,
    supplierNameEn: r.supplierNameEn,
    supplierNameZh: r.supplierNameZh,
    productId: r.productId,
    name:
      localizeField(locale, r.nameEn, r.nameZh) ||
      localizeField(locale, r.productEn ?? "", r.productZh ?? "") ||
      `#${r.productId}`,
    quantity: r.quantity,
    lineTotal: r.lineTotal,
    currency: r.currency,
  }));
  return { lines, productIds: [...new Set(rows.map((r) => r.productId))] };
}

async function thumbsFor(productIds: number[]) {
  if (productIds.length === 0) return new Map<number, string | null>();
  const [rows, images] = await Promise.all([
    db.select({ id: products.id, thumbPath: products.thumbPath }).from(products).where(inArray(products.id, productIds)),
    getImagesByProduct(productIds),
  ]);
  return new Map(rows.map((p) => [p.id, p.thumbPath || images.get(p.id)?.[0] || null]));
}

async function cardCounts(cardIds: number[]) {
  const checklist = new Map<number, { done: number; total: number }>();
  const comments = new Map<number, { count: number; last: string }>();
  if (cardIds.length === 0) return { checklist, comments };
  const [checkRows, entryRows] = await Promise.all([
    db
      .select({
        cardId: followupChecklistItems.cardId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) FILTER (WHERE ${followupChecklistItems.done})::int`,
      })
      .from(followupChecklistItems)
      .where(inArray(followupChecklistItems.cardId, cardIds))
      .groupBy(followupChecklistItems.cardId),
    db
      .select({
        cardId: followupEntries.cardId,
        comments: sql<number>`count(*) FILTER (WHERE ${followupEntries.kind} = 'comment' AND ${followupEntries.removedAt} IS NULL)::int`,
        last: sql<string>`max(${followupEntries.createdAt})`,
      })
      .from(followupEntries)
      .where(inArray(followupEntries.cardId, cardIds))
      .groupBy(followupEntries.cardId),
  ]);
  for (const r of checkRows) checklist.set(r.cardId, { done: r.done, total: r.total });
  for (const r of entryRows) comments.set(r.cardId, { count: r.comments, last: r.last });
  return { checklist, comments };
}

/** When each order was last marked shipped, from its own history. */
async function shippedDates(orderIds: number[]) {
  const map = new Map<number, string>();
  if (orderIds.length === 0) return map;
  const rows = await db
    .select({ orderId: orderEvents.orderId, createdAt: orderEvents.createdAt, payload: orderEvents.payload })
    .from(orderEvents)
    .where(and(inArray(orderEvents.orderId, orderIds), eq(orderEvents.kind, "status")))
    .orderBy(asc(orderEvents.id));
  for (const r of rows) {
    if (parsePayload(r.payload).to === "shipped") map.set(r.orderId, r.createdAt.slice(0, 10));
  }
  return map;
}

async function dossierFor(orderIds: number[]) {
  const map = new Map<number, { kind: string; fapiaoType: string | null; originalName: string; path: string; sizeBytes: number; id: number }[]>();
  if (orderIds.length === 0) return map;
  const rows = await db
    .select({
      id: orderDocuments.id,
      orderId: orderDocuments.orderId,
      kind: orderDocuments.kind,
      fapiaoType: orderDocuments.fapiaoType,
      originalName: orderDocuments.originalName,
      path: orderDocuments.path,
      sizeBytes: orderDocuments.sizeBytes,
    })
    .from(orderDocuments)
    .where(and(inArray(orderDocuments.orderId, orderIds), inArray(orderDocuments.kind, DOSSIER_KINDS as never[])));
  for (const r of rows) {
    const list = map.get(r.orderId) ?? [];
    list.push(r);
    map.set(r.orderId, list);
  }
  return map;
}

function shipmentDocs(
  order: { taxRegime: TaxRegime; exportDate: string | null },
  hasLines: boolean,
  documents: Parameters<typeof computeDossierStatus>[1],
) {
  const status = computeDossierStatus({ taxRegime: order.taxRegime, exportDate: order.exportDate, hasLines }, documents);
  const missingBy = new Map<Responsible, number>();
  for (const item of status.items) {
    const def = DOSSIER_ITEMS[item.n - 1];
    if (def.optional) continue;
    if (item.status === "missing" || item.status === "risk") {
      missingBy.set(def.responsible, (missingBy.get(def.responsible) ?? 0) + 1);
    }
  }
  return { status, missing: [...missingBy].map(([responsible, count]) => ({ responsible, count })) };
}

type OrderRow = {
  id: number;
  orderNumber: string;
  clientId: number;
  status: string;
  taxRegime: TaxRegime;
  exportDate: string | null;
};

async function loadOrders(companyId: number, where: ReturnType<typeof and>) {
  const rows: OrderRow[] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      clientId: orders.clientId,
      status: orders.status,
      taxRegime: orders.taxRegime,
      exportDate: orders.exportDate,
    })
    .from(orders)
    .where(and(eq(orders.companyId, companyId), where));
  return rows;
}

async function clientNames(companyId: number, clientIds: number[], locale: Locale) {
  if (clientIds.length === 0) return new Map<number, string>();
  const rows = await db
    .select({ id: contacts.id, en: contacts.companyName, zh: contacts.companyNameZh, person: contacts.contactPerson })
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), inArray(contacts.id, clientIds)));
  return new Map(rows.map((c) => [c.id, localizeField(locale, c.en, c.zh) || c.person]));
}

type CardRow = typeof followupCards.$inferSelect;

function common(card: CardRow, order: OrderRow, client: string, counts: Awaited<ReturnType<typeof cardCounts>>): CardCommon {
  const check = counts.checklist.get(card.id) ?? { done: 0, total: 0 };
  const posted = counts.comments.get(card.id);
  const touched = [card.updatedAt, posted?.last ?? ""].sort().pop() ?? card.updatedAt;
  return {
    id: card.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    clientName: client,
    nextStep: card.nextStep,
    nextDue: card.nextDue,
    nextOwnerId: card.nextOwnerId,
    problem: card.problem,
    version: card.version,
    comments: posted?.count ?? 0,
    checklistDone: check.done,
    checklistTotal: check.total,
    touchedAt: utcStampToIso(touched),
  };
}

/** Builds the views for the given orders' cards; shared by the board and the panel. */
async function buildViews(companyId: number, orderRows: OrderRow[], cardRows: CardRow[], locale: Locale) {
  const orderIds = orderRows.map((o) => o.id);
  const shippedIds = orderRows.filter((o) => o.status === "shipped").map((o) => o.id);
  const [{ lines, productIds }, clients, counts, shipped, documents] = await Promise.all([
    lineRows(orderIds, locale),
    clientNames(companyId, [...new Set(orderRows.map((o) => o.clientId))], locale),
    cardCounts(cardRows.map((c) => c.id)),
    shippedDates(shippedIds),
    dossierFor(shippedIds),
  ]);
  const groups = groupLines(lines);
  const thumbs = await thumbsFor([...new Set([...groups.values()].map((g) => g.mainProductId))].filter((id) => productIds.includes(id)));
  const orderById = new Map(orderRows.map((o) => [o.id, o]));

  const cards: SupplierCardView[] = [];
  const shipments: ShipmentCardView[] = [];
  for (const card of cardRows) {
    const order = orderById.get(card.orderId);
    if (!order) continue;
    const base = common(card, order, clients.get(order.clientId) ?? "", counts);
    if (card.kind === "shipment") {
      if (order.status !== "shipped") continue;
      const orderGroups = [...groups.values()]
        .filter((g) => g.orderId === order.id)
        .sort((a, b) => (b.cost[0]?.amount ?? 0) - (a.cost[0]?.amount ?? 0));
      const { status, missing } = shipmentDocs(order, orderGroups.length > 0, documents.get(order.id) ?? []);
      shipments.push({
        ...base,
        kind: "shipment",
        stage: card.stage,
        shippedOn: shipped.get(order.id) ?? null,
        productNames: orderGroups.map((g) => g.mainProductName),
        supplierNames: orderGroups.map((g) => g.supplierName).filter(Boolean),
        docsDone: status.required - status.outstanding,
        docsRequired: status.required,
        missing,
        complete: status.complete,
        regimeUndecided: order.taxRegime === "undecided",
      });
      continue;
    }
    // Supplier work is over once the order ships: its shipment card takes over.
    if (order.status !== "confirmed") continue;
    const group = groups.get(groupKey(order.id, card.kind === "supplier" ? card.supplierId : null));
    // A supplier taken off the order keeps its history but leaves the board.
    if (!group) continue;
    cards.push({
      ...base,
      kind: card.kind,
      stage: card.stage,
      supplierName: group.supplierName,
      supplierNameAlt: group.supplierNameAlt,
      mainProductName: group.mainProductName,
      mainProductThumb: thumbs.get(group.mainProductId) ?? null,
      otherLines: group.otherLines,
      pieces: group.pieces,
      cost: group.cost,
    });
  }
  return { cards, shipments, groups, lines };
}

export async function getFollowupBoard(companyId: number, locale: Locale): Promise<FollowupBoard> {
  await ensureFollowupCards(companyId);
  const orderRows = await loadOrders(companyId, inArray(orders.status, ["confirmed", "shipped"]));
  const cardRows = orderRows.length
    ? await db
        .select()
        .from(followupCards)
        .where(and(eq(followupCards.companyId, companyId), inArray(followupCards.orderId, orderRows.map((o) => o.id))))
    : [];
  const [{ cards, shipments }, userRows] = await Promise.all([
    buildViews(companyId, orderRows, cardRows, locale),
    companyUsers(companyId),
  ]);
  const cutoff = new Date(Date.now() - COMPLETE_SHIPMENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  return {
    cards,
    // A shipment stays until its paperwork is complete, then for two weeks.
    shipments: shipments.filter((s) => !s.complete || (s.shippedOn ?? "9999") >= cutoff),
    users: userRows,
  };
}

export type FollowupEntryView = {
  id: number;
  kind: FollowupEntryKind | "order_status";
  userId: number | null;
  body: string;
  payload: Record<string, unknown>;
  createdAt: string;
  removed: boolean;
  attachments: { id: number; path: string; name: string; sizeBytes: number; image: boolean }[];
};

export type FollowupChecklistView = {
  id: number;
  text: string;
  ownerId: number | null;
  done: boolean;
  doneBy: number | null;
};

export type FollowupCardDetail = {
  card: FollowupCardView;
  orderStatus: string;
  lines: { name: string; quantity: number }[];
  suppliers: { name: string; alt: string; mainProduct: string }[];
  checklist: FollowupChecklistView[];
  entries: FollowupEntryView[];
  dossier: { key: string; zh: string; en: string; responsible: Responsible; optional: boolean; status: string; files: number }[];
  users: FollowupUser[];
};

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

export async function getFollowupCardDetail(
  companyId: number,
  cardId: number,
  locale: Locale,
): Promise<FollowupCardDetail | null> {
  const card = await db
    .select()
    .from(followupCards)
    .where(and(eq(followupCards.companyId, companyId), eq(followupCards.id, cardId)))
    .limit(1)
    .then(one);
  if (!card) return null;
  const orderRows = await loadOrders(companyId, eq(orders.id, card.orderId));
  const order = orderRows[0];
  if (!order) return null;

  const [{ cards, shipments, groups, lines }, checklist, entryRows, statusEvents, userRows] = await Promise.all([
    buildViews(companyId, orderRows, [card], locale),
    db
      .select()
      .from(followupChecklistItems)
      .where(and(eq(followupChecklistItems.companyId, companyId), eq(followupChecklistItems.cardId, cardId)))
      .orderBy(asc(followupChecklistItems.position), asc(followupChecklistItems.id)),
    db
      .select()
      .from(followupEntries)
      .where(and(eq(followupEntries.companyId, companyId), eq(followupEntries.cardId, cardId)))
      .orderBy(asc(followupEntries.id)),
    db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, order.id), eq(orderEvents.kind, "status")))
      .orderBy(asc(orderEvents.id)),
    companyUsers(companyId),
  ]);
  const view: FollowupCardView | undefined = card.kind === "shipment" ? shipments.at(0) : cards.at(0);
  if (!view) return null;

  const entryIds = entryRows.map((e) => e.id);
  const attachments = entryIds.length
    ? await db
        .select()
        .from(followupAttachments)
        .where(and(eq(followupAttachments.companyId, companyId), inArray(followupAttachments.entryId, entryIds)))
        .orderBy(asc(followupAttachments.id))
    : [];

  const entries: FollowupEntryView[] = [
    ...entryRows.map((e) => ({
      id: e.id,
      kind: e.kind,
      userId: e.userId,
      body: e.removedAt ? "" : e.body,
      payload: parsePayload(e.payload),
      createdAt: utcStampToIso(e.createdAt),
      removed: Boolean(e.removedAt),
      attachments: e.removedAt
        ? []
        : attachments
            .filter((a) => a.entryId === e.id)
            .map((a) => ({ id: a.id, path: a.path, name: a.originalName, sizeBytes: a.sizeBytes, image: IMAGE_EXT.test(a.path) })),
    })),
    // The order's own milestones belong in every card's story.
    ...statusEvents.map((e) => ({
      id: -e.id,
      kind: "order_status" as const,
      userId: e.userId,
      body: "",
      payload: parsePayload(e.payload),
      createdAt: utcStampToIso(e.createdAt),
      removed: false,
      attachments: [],
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);

  const ownLines =
    view.kind === "shipment"
      ? []
      : lines
          .filter((l) => l.supplierId === (card.kind === "supplier" ? card.supplierId : null))
          .sort((a, b) => b.lineTotal - a.lineTotal || a.name.localeCompare(b.name))
          .map((l) => ({ name: l.name, quantity: l.quantity }));
  const suppliers =
    view.kind === "shipment"
      ? [...groups.values()]
          .filter((g) => g.orderId === order.id)
          .map((g) => ({ name: g.supplierName, alt: g.supplierNameAlt, mainProduct: g.mainProductName }))
      : [];

  let dossier: FollowupCardDetail["dossier"] = [];
  if (view.kind === "shipment") {
    const documents = (await dossierFor([order.id])).get(order.id) ?? [];
    const { status } = shipmentDocs(order, lines.length > 0, documents);
    dossier = status.items.map((item) => {
      const def = DOSSIER_ITEMS[item.n - 1];
      return {
        key: def.key,
        zh: def.zh,
        en: def.en,
        responsible: def.responsible,
        optional: def.optional,
        status: item.status,
        files: item.files.length,
      };
    });
  }

  return {
    card: view,
    orderStatus: order.status,
    lines: ownLines,
    suppliers,
    checklist: checklist.map((c) => ({ id: c.id, text: c.text, ownerId: c.ownerId, done: c.done, doneBy: c.doneBy })),
    entries,
    dossier,
    users: userRows,
  };
}

/** A card of this company, for the actions; null when it is not ours. */
export async function findCard(companyId: number, cardId: number) {
  return db
    .select()
    .from(followupCards)
    .where(and(eq(followupCards.companyId, companyId), eq(followupCards.id, cardId)))
    .limit(1)
    .then(one);
}

/** Every stored follow-up file of an order, for deleting them with it. */
export async function followupFilesOfOrder(orderId: number) {
  const rows = await db
    .select({ path: followupAttachments.path })
    .from(followupAttachments)
    .innerJoin(followupEntries, eq(followupEntries.id, followupAttachments.entryId))
    .innerJoin(followupCards, eq(followupCards.id, followupEntries.cardId))
    .where(eq(followupCards.orderId, orderId));
  return rows.map((r) => r.path);
}
