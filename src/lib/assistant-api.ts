import crypto from "node:crypto";
import { and, asc, desc, eq, exists, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, one } from "@/db";
import { companies, contacts, orderItems, orders, products, users } from "@/db/schema";
import { companyLifecycleBlock, getCompanyModules, sessionUser, type SessionUser } from "@/lib/authz";
import type { AssistantIdentity } from "@/lib/assistant-context";
import { ASSISTANT_SCOPES, type AssistantScope } from "@/lib/assistant-keys";
import { overBudget } from "@/lib/assistant-auth";
import {
  CONTACT_FIELDS,
  cardView,
  contactView,
  haystack,
  likePattern,
  matchesQuery,
  STAGE_NAMES,
  type CardInput,
} from "@/lib/assistant-views";
import { findCard, getFollowupBoard, getFollowupCardDetail } from "@/lib/followup-server";
import {
  addFollowupChecklistItem,
  moveFollowupCard,
  postFollowupUpdate,
  setFollowupChecklistDone,
  setFollowupChecklistOwner,
  setFollowupNextStep,
  setFollowupProblem,
  type FollowupResult,
} from "@/lib/actions/followup";
import { createContact, updateContact } from "@/lib/actions/contacts";
import { getOrderView } from "@/lib/queries/order-view";
import { getContactById } from "@/lib/queries/contacts";
import { getImagesByProduct } from "@/lib/queries/catalog";
import { appOrigin } from "@/lib/verification-mail";
import { FOLLOWUP_STAGES } from "@/lib/followup-stages";
import type { Locale } from "@/i18n/routing";

/**
 * The assistant API (docs/ASSISTANT.md): what a chat assistant such as
 * OpenClaw may read and do, on behalf of a company, with a key.
 *
 * Every write goes through the same server action a person's click does,
 * running as the assistant's own account (assistant-context.ts): the same
 * validation, the same stale-save refusal, the same history — with the
 * assistant's name on it. Nothing here deletes, and nothing reaches
 * settings, the team, finance or the platform: those routes do not exist.
 */

export type Reply = { status: number; body: unknown };

type Ctx = {
  identity: AssistantIdentity;
  user: SessionUser;
  lang: Locale;
  query: URLSearchParams;
  body: Record<string, unknown>;
  prices: boolean;
};

type Route = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  /** What the admin must have allowed; reading needs nothing beyond the key. */
  scope?: Exclude<AssistantScope, "prices">;
  /** Lives with the orders module (orders, the board). */
  orders?: boolean;
  about: string;
  run: (ctx: Ctx, params: Record<string, string>) => Promise<Reply>;
};

const ok = (body: unknown): Reply => ({ status: 200, body });
const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}): Reply => ({
  status,
  body: { error, message, ...extra },
});

const notFound = (what: string) => fail(404, "not-found", `No ${what} with that id in this company.`);

function limitOf(query: URLSearchParams, fallback = 20, max = 50): number {
  const n = Number(query.get("limit"));
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

function idParam(value: string): number | null {
  return /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : null;
}

function str(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === "string" ? v : undefined;
}

/** A version the caller read, required on every card change. */
function versionOf(body: Record<string, unknown>): number | null {
  const v = body.version;
  return Number.isInteger(v) && (v as number) > 0 ? (v as number) : null;
}

/** `null` clears, a person id sets, anything else is refused (undefined = keep). */
function ownerOf(body: Record<string, unknown>): number | null | undefined | "bad" {
  if (!("ownerId" in body)) return undefined;
  const v = body.ownerId;
  if (v === null) return null;
  return Number.isInteger(v) && (v as number) > 0 ? (v as number) : "bad";
}

const FOLLOWUP_ERRORS: Record<string, [number, string]> = {
  invalid: [400, "That value is not accepted here (check lengths, dates as YYYY-MM-DD, the stage name)."],
  notFound: [404, "No such card or checklist item in this company."],
  conflict: [409, "Someone changed this card since you read it. Read it again, tell the user what changed, and retry with the new version."],
  owner: [400, "ownerId must be an active person on the team (GET team)."],
  empty: [400, "An update needs some text."],
};

function followupFailure(result: FollowupResult): Reply | null {
  if (!result.error) return null;
  const [status, message] = FOLLOWUP_ERRORS[result.error] ?? [400, "Not accepted."];
  return fail(status, result.error, message);
}

async function teamNames(companyId: number): Promise<Map<number, string>> {
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, companyId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function boardCards(ctx: Ctx): Promise<CardInput[]> {
  const board = await getFollowupBoard(ctx.user.companyId, ctx.lang);
  return [...board.cards, ...board.shipments] as CardInput[];
}

/** The card as the assistant sees it after a change, so it can read it back to the user. */
async function cardAfter(ctx: Ctx, cardId: number): Promise<Reply> {
  const detail = await getFollowupCardDetail(ctx.user.companyId, cardId, ctx.lang);
  if (!detail) return notFound("card");
  return ok({ ok: true, card: cardView(detail.card as CardInput, await teamNames(ctx.user.companyId), ctx.prices) });
}

function orderUrl(id: number, lang: Locale) {
  return `${appOrigin().replace(/\/$/, "")}/${lang}/orders/${id}`;
}

// --- routes --------------------------------------------------------------------

const routes: Route[] = [
  {
    method: "GET",
    path: "",
    about: "Who you are, what you may do, and this list.",
    run: async (ctx) => {
      const company = await db
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, ctx.user.companyId))
        .limit(1)
        .then(one);
      return ok({
        assistant: ctx.identity.name,
        company: company?.name ?? "",
        allowed: ["read", ...ASSISTANT_SCOPES.filter((s) => ctx.identity.scopes.has(s))],
        stages: FOLLOWUP_STAGES.map((s) => ({ id: s, ...STAGE_NAMES[s] })),
        endpoints: routes
          .filter((r) => !r.scope || ctx.identity.scopes.has(r.scope))
          .map((r) => `${r.method} /api/assistant/v1/${r.path} — ${r.about}`),
      });
    },
  },
  {
    method: "GET",
    path: "team",
    about: "The people on the team (ids for ownerId).",
    run: async (ctx) => {
      const rows = await db
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(and(eq(users.companyId, ctx.user.companyId), eq(users.active, true), eq(users.kind, "person")))
        .orderBy(asc(users.name));
      return ok({ people: rows });
    },
  },

  // --- orders --------------------------------------------------------------
  {
    method: "GET",
    path: "orders",
    orders: true,
    about: "Find orders: ?q= (number, client, supplier or product), ?status=draft|confirmed|shipped|cancelled, ?limit=.",
    run: async (ctx) => {
      const q = ctx.query.get("q")?.trim() ?? "";
      const status = ctx.query.get("status");
      const where: SQL[] = [eq(orders.companyId, ctx.user.companyId)];
      if (status && ["draft", "confirmed", "shipped", "cancelled"].includes(status)) {
        where.push(eq(orders.status, status as "draft"));
      }
      if (q) {
        const like = likePattern(q);
        where.push(
          or(
            ilike(orders.orderNumber, like),
            ilike(contacts.companyName, like),
            ilike(contacts.companyNameZh, like),
            exists(
              db
                .select({ one: sql`1` })
                .from(orderItems)
                .where(
                  and(
                    eq(orderItems.orderId, orders.id),
                    or(
                      ilike(orderItems.supplierNameEnSnapshot, like),
                      ilike(orderItems.supplierNameZhSnapshot, like),
                      ilike(orderItems.nameEnSnapshot, like),
                      ilike(orderItems.nameZhSnapshot, like),
                    ),
                  ),
                ),
            ),
          )!,
        );
      }
      const rows = await db
        .select({
          id: orders.id,
          number: orders.orderNumber,
          status: orders.status,
          createdAt: orders.createdAt,
          client: contacts.companyName,
          clientZh: contacts.companyNameZh,
        })
        .from(orders)
        .leftJoin(contacts, eq(orders.clientId, contacts.id))
        .where(and(...where))
        .orderBy(desc(orders.createdAt))
        .limit(limitOf(ctx.query));
      return ok({ orders: rows.map((r) => ({ ...r, client: r.client || r.clientZh || "", url: orderUrl(r.id, ctx.lang) })) });
    },
  },
  {
    method: "GET",
    path: "orders/:ref",
    orders: true,
    about: "One order by id or exact number: lines, suppliers, and its follow-up cards.",
    run: async (ctx, p) => {
      const byId = idParam(p.ref);
      const match = await db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.companyId, ctx.user.companyId),
            byId !== null ? eq(orders.id, byId) : sql`lower(${orders.orderNumber}) = lower(${p.ref})`,
          ),
        )
        .limit(1)
        .then(one);
      const view = match && (await getOrderView(ctx.user.companyId, match.id, ctx.lang));
      if (!view) return notFound("order");
      const { order, client, rows, totals } = view;
      const people = await teamNames(ctx.user.companyId);
      const cards = (await boardCards(ctx)).filter((c) => c.orderId === order.id);
      return ok({
        order: {
          id: order.id,
          number: order.orderNumber,
          status: order.status,
          createdAt: order.createdAt,
          client: client ? { id: client.id, name: client.companyName, nameZh: client.companyNameZh } : null,
          notes: order.notes,
          destination: { port: order.portOfDestination, country: order.destinationCountry },
          lines: rows.map((r) => ({
            product: r.name,
            sku: r.sku,
            supplier: r.supplierName,
            quantity: r.quantity,
            cartons: r.cartons,
            ...(ctx.prices
              ? { cost: r.unitPriceSnapshot, costCurrency: r.currencySnapshot, price: r.sellPrice, priceCurrency: r.sellCurrency }
              : {}),
          })),
          totals: {
            cartons: totals.totalCartons,
            cbm: totals.totalCbm,
            weightKg: totals.totalWeightKg,
            ...(ctx.prices ? { goods: totals.goods, cost: totals.cost, grandTotal: totals.grandTotal } : {}),
          },
          followup: cards.map((c) => cardView(c, people, ctx.prices)),
          url: orderUrl(order.id, ctx.lang),
        },
      });
    },
  },

  // --- follow-up board -----------------------------------------------------
  {
    method: "GET",
    path: "followup",
    orders: true,
    about: "Follow-up cards: ?q= (order, client, supplier, product), ?stage=, ?order= (number or id), ?ownerId=, ?limit=.",
    run: async (ctx) => {
      const q = ctx.query.get("q")?.trim() ?? "";
      const stage = ctx.query.get("stage");
      const orderRef = ctx.query.get("order")?.trim().toLowerCase() ?? "";
      const ownerId = idParam(ctx.query.get("ownerId") ?? "");
      const people = await teamNames(ctx.user.companyId);
      const cards = (await boardCards(ctx)).filter((c) => {
        if (stage && (c.kind === "shipment" || c.stage !== stage)) return false;
        if (orderRef && String(c.orderId) !== orderRef && !c.orderNumber.toLowerCase().includes(orderRef)) return false;
        if (ownerId !== null && c.nextOwnerId !== ownerId) return false;
        if (!q) return true;
        return matchesQuery(
          haystack([
            c.orderNumber,
            c.clientName,
            c.supplierName,
            c.supplierNameAlt,
            c.mainProductName,
            ...(c.productNames ?? []),
            ...(c.supplierNames ?? []),
            c.nextStep,
            c.problem,
          ]),
          q,
        );
      });
      return ok({ cards: cards.slice(0, limitOf(ctx.query)).map((c) => cardView(c, people, ctx.prices)) });
    },
  },
  {
    method: "GET",
    path: "followup/:id",
    orders: true,
    about: "One card: its products, checklist (item ids) and history.",
    run: async (ctx, p) => {
      const id = idParam(p.id);
      const detail = id === null ? null : await getFollowupCardDetail(ctx.user.companyId, id, ctx.lang);
      if (!detail) return notFound("card");
      const people = await teamNames(ctx.user.companyId);
      const name = (uid: number | null) => (uid === null ? null : (people.get(uid) ?? "?"));
      return ok({
        card: cardView(detail.card as CardInput, people, ctx.prices),
        orderStatus: detail.orderStatus,
        products: detail.lines,
        checklist: detail.checklist.map((c) => ({ id: c.id, text: c.text, owner: name(c.ownerId), ownerId: c.ownerId, done: c.done })),
        documents: detail.dossier.map((d) => ({ key: d.key, en: d.en, zh: d.zh, status: d.status, optional: d.optional })),
        history: detail.entries.slice(-30).map((e) => ({
          when: e.createdAt,
          who: name(e.userId),
          kind: e.kind,
          text: e.body,
          details: e.payload,
          files: e.attachments.length,
        })),
      });
    },
  },
  {
    method: "POST",
    path: "followup/:id/stage",
    orders: true,
    scope: "followup",
    about: 'Move a supplier card: {"stage": "production", "version": n}.',
    run: async (ctx, p) => {
      const id = idParam(p.id);
      const version = versionOf(ctx.body);
      const stage = str(ctx.body, "stage");
      if (id === null || version === null || !stage) return fail(400, "invalid", 'Send {"stage": "<stage id>", "version": <card version>}.');
      const result = await moveFollowupCard(id, stage, version);
      return followupFailure(result) ?? cardAfter(ctx, id);
    },
  },
  {
    method: "POST",
    path: "followup/:id/next-step",
    orders: true,
    scope: "followup",
    about: 'Set the next step: {"text": "...", "due": "YYYY-MM-DD" or null, "ownerId": id or null, "version": n}; omitted fields stay.',
    run: async (ctx, p) => {
      const id = idParam(p.id);
      const version = versionOf(ctx.body);
      const owner = ownerOf(ctx.body);
      if (id === null || version === null || owner === "bad") return fail(400, "invalid", 'Send {"text", "due", "ownerId", "version"}.');
      const card = await findCard(ctx.user.companyId, id);
      if (!card) return notFound("card");
      const due = "due" in ctx.body ? ctx.body.due : card.nextDue;
      if (due !== null && typeof due !== "string") return fail(400, "invalid", "due is a date YYYY-MM-DD or null.");
      const result = await setFollowupNextStep(
        id,
        {
          nextStep: str(ctx.body, "text") ?? card.nextStep,
          nextDue: due === "" ? null : due,
          nextOwnerId: owner === undefined ? card.nextOwnerId : owner,
        },
        version,
      );
      return followupFailure(result) ?? cardAfter(ctx, id);
    },
  },
  {
    method: "POST",
    path: "followup/:id/problem",
    orders: true,
    scope: "followup",
    about: 'Flag or clear a problem: {"problem": "..." or "", "version": n}.',
    run: async (ctx, p) => {
      const id = idParam(p.id);
      const version = versionOf(ctx.body);
      const problem = str(ctx.body, "problem");
      if (id === null || version === null || problem === undefined) return fail(400, "invalid", 'Send {"problem", "version"}.');
      const result = await setFollowupProblem(id, problem, version);
      return followupFailure(result) ?? cardAfter(ctx, id);
    },
  },
  {
    method: "POST",
    path: "followup/:id/updates",
    orders: true,
    scope: "followup",
    about: 'Post an update on a card: {"text": "...", "key": optional retry key}. Sending the same key twice posts once.',
    run: async (ctx, p) => {
      const id = idParam(p.id);
      const text = str(ctx.body, "text");
      if (id === null || text === undefined) return fail(400, "invalid", 'Send {"text"}.');
      const key = str(ctx.body, "key") ?? crypto.randomUUID();
      const form = new FormData();
      form.set("cardId", String(id));
      form.set("body", text);
      form.set("clientKey", key);
      const result = await postFollowupUpdate(form);
      return followupFailure(result) ?? cardAfter(ctx, id);
    },
  },
  {
    method: "POST",
    path: "followup/:id/checklist",
    orders: true,
    scope: "followup",
    about: 'Add a checklist item: {"text": "...", "ownerId": optional person id}.',
    run: async (ctx, p) => {
      const id = idParam(p.id);
      const text = str(ctx.body, "text");
      const owner = ownerOf(ctx.body);
      if (id === null || !text || owner === "bad") return fail(400, "invalid", 'Send {"text", "ownerId"}.');
      const result = await addFollowupChecklistItem(id, text, owner ?? null);
      return followupFailure(result) ?? cardAfter(ctx, id);
    },
  },
  {
    method: "PATCH",
    path: "checklist/:id",
    orders: true,
    scope: "followup",
    about: 'Tick or untick a checklist item, or hand it on: {"done": true} and/or {"ownerId": id or null}.',
    run: async (ctx, p) => {
      const id = idParam(p.id);
      const owner = ownerOf(ctx.body);
      const done = ctx.body.done;
      if (id === null || owner === "bad" || (done !== undefined && typeof done !== "boolean") || (done === undefined && owner === undefined)) {
        return fail(400, "invalid", 'Send {"done": true|false} and/or {"ownerId": id|null}.');
      }
      if (typeof done === "boolean") {
        const failed = followupFailure(await setFollowupChecklistDone(id, done));
        if (failed) return failed;
      }
      if (owner !== undefined) {
        const failed = followupFailure(await setFollowupChecklistOwner(id, owner));
        if (failed) return failed;
      }
      return ok({ ok: true });
    },
  },

  // --- contacts ------------------------------------------------------------
  {
    method: "GET",
    path: "contacts",
    about: "Find suppliers and clients: ?q= (name, person, phone, WeChat, booth), ?type=supplier|client, ?limit=.",
    run: async (ctx) => {
      const q = ctx.query.get("q")?.trim() ?? "";
      const type = ctx.query.get("type");
      const where: SQL[] = [eq(contacts.companyId, ctx.user.companyId)];
      if (type === "supplier" || type === "client") where.push(eq(contacts.type, type));
      if (q) {
        const like = likePattern(q);
        where.push(
          or(
            ilike(contacts.companyName, like),
            ilike(contacts.companyNameZh, like),
            ilike(contacts.contactPerson, like),
            ilike(contacts.phone, like),
            ilike(contacts.wechat, like),
            ilike(contacts.boothLocation, like),
          )!,
        );
      }
      const rows = await db
        .select()
        .from(contacts)
        .where(and(...where))
        .orderBy(asc(contacts.companyName))
        .limit(limitOf(ctx.query));
      return ok({ contacts: rows.map(contactView) });
    },
  },
  {
    method: "GET",
    path: "contacts/:id",
    about: "One supplier or client.",
    run: async (ctx, p) => {
      const id = idParam(p.id);
      const row = id === null ? null : await getContactById(ctx.user.companyId, id);
      return row ? ok({ contact: contactView(row) }) : notFound("contact");
    },
  },
  {
    method: "POST",
    path: "contacts",
    scope: "contacts",
    about: 'Add a contact: {"type": "supplier"|"client", "name", "nameZh", "person", "phone", "email", "whatsapp", "wechat", "booth", "province", "city", "taxId", "notes"}.',
    run: async (ctx) => {
      const type = str(ctx.body, "type");
      if (type !== "supplier" && type !== "client") return fail(400, "invalid", 'type is "supplier" or "client".');
      const form = contactForm(ctx.body, { type });
      if (!form) return fail(400, "invalid", "Text fields only, each under 500 characters (notes 4000).");
      const result = await createContact(undefined, form);
      if (result.error || !result.id) return fail(400, "invalid", "A contact needs a name in either language, or a person.");
      return ok({ ok: true, contact: contactView((await getContactById(ctx.user.companyId, result.id))!) });
    },
  },
  {
    method: "PATCH",
    path: "contacts/:id",
    scope: "contacts",
    about: "Change a contact's fields (same names as adding); omitted fields stay. The type cannot change.",
    run: async (ctx, p) => {
      const id = idParam(p.id);
      const existing = id === null ? null : await getContactById(ctx.user.companyId, id);
      if (!existing || id === null) return notFound("contact");
      const form = contactForm(ctx.body, existing);
      if (!form) return fail(400, "invalid", "Text fields only, each under 500 characters (notes 4000).");
      const result = await updateContact(id, undefined, form);
      if (result.error) return fail(400, "invalid", "A contact needs a name in either language, or a person.");
      return ok({ ok: true, contact: contactView((await getContactById(ctx.user.companyId, id))!) });
    },
  },

  // --- products ------------------------------------------------------------
  {
    method: "GET",
    path: "products",
    about: "Find products: ?q= (name, SKU, factory code), ?supplierId=, ?limit=.",
    run: async (ctx) => {
      const q = ctx.query.get("q")?.trim() ?? "";
      const supplierId = idParam(ctx.query.get("supplierId") ?? "");
      const where: SQL[] = [eq(products.companyId, ctx.user.companyId)];
      if (supplierId !== null) where.push(eq(products.supplierId, supplierId));
      if (q) {
        const like = likePattern(q);
        where.push(
          or(
            ilike(products.nameEn, like),
            ilike(products.nameZh, like),
            ilike(products.sku, like),
            ilike(products.supplierCode, like),
          )!,
        );
      }
      const rows = await db
        .select({ product: products, supplier: contacts.companyName, supplierZh: contacts.companyNameZh })
        .from(products)
        .leftJoin(contacts, eq(products.supplierId, contacts.id))
        .where(and(...where))
        .orderBy(asc(products.nameEn))
        .limit(limitOf(ctx.query));
      return ok({ products: rows.map((r) => productView(r.product, r.supplier ?? r.supplierZh ?? null, ctx.prices)) });
    },
  },
  {
    method: "GET",
    path: "products/:id",
    about: "One product, with its description and packing.",
    run: async (ctx, p) => {
      const id = idParam(p.id);
      const row =
        id === null
          ? null
          : await db
              .select({ product: products, supplier: contacts.companyName, supplierZh: contacts.companyNameZh })
              .from(products)
              .leftJoin(contacts, eq(products.supplierId, contacts.id))
              .where(and(eq(products.companyId, ctx.user.companyId), eq(products.id, id)))
              .limit(1)
              .then(one);
      if (!row) return notFound("product");
      const images = (await getImagesByProduct([row.product.id])).get(row.product.id) ?? [];
      const pr = row.product;
      return ok({
        product: {
          ...productView(pr, row.supplier ?? row.supplierZh ?? null, ctx.prices),
          description: pr.descriptionEn,
          descriptionZh: pr.descriptionZh,
          hsCode: pr.hsCode,
          carton: { lengthCm: pr.lengthCm, widthCm: pr.widthCm, heightCm: pr.heightCm, weightKg: pr.weightKg, cbm: pr.cbm },
          photos: images.length,
        },
      });
    },
  },
];

function productView(p: typeof products.$inferSelect, supplier: string | null, prices: boolean) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.nameEn,
    nameZh: p.nameZh,
    supplier: p.supplierId === null ? null : { id: p.supplierId, name: supplier ?? "" },
    factoryCode: p.supplierCode,
    moq: p.moq,
    perCarton: p.qtyPerBox,
    active: p.active,
    ...(prices ? { cost: p.price, costCurrency: p.currency, price: p.sellPrice, priceCurrency: p.sellCurrency } : {}),
  };
}

/**
 * The contact form an assistant's JSON fills: known text fields only, each
 * bounded; what it does not send keeps the stored value; bank details are
 * never taken from it and always kept as they are.
 */
function contactForm(
  body: Record<string, unknown>,
  base: Partial<Record<(typeof CONTACT_FIELDS)[keyof typeof CONTACT_FIELDS] | "type" | "bankInfo", string>>,
): FormData | null {
  const form = new FormData();
  form.set("type", base.type ?? "");
  form.set("bankInfo", base.bankInfo ?? "");
  for (const [json, field] of Object.entries(CONTACT_FIELDS)) {
    const sent = body[json];
    if (sent !== undefined && typeof sent !== "string") return null;
    const value = sent ?? base[field] ?? "";
    if (value.length > (field === "notes" ? 4000 : 500)) return null;
    form.set(field, value);
  }
  return form;
}

// --- dispatch ------------------------------------------------------------------

function matchRoute(method: string, segments: string[]): { route: Route; params: Record<string, string> } | "method" | null {
  let pathMatched = false;
  for (const route of routes) {
    const pattern = route.path === "" ? [] : route.path.split("/");
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const hit = pattern.every((part, i) => {
      if (part.startsWith(":")) {
        params[part.slice(1)] = segments[i];
        return true;
      }
      return part === segments[i];
    });
    if (!hit) continue;
    pathMatched = true;
    if (route.method === method) return { route, params };
  }
  return pathMatched ? "method" : null;
}

const MAX_BODY = 20_000;

/**
 * One request, already authenticated as `identity` (assistant-auth.ts). The
 * route handler is a thin shell around this.
 */
export async function handleAssistantRequest(
  identity: AssistantIdentity,
  method: string,
  segments: string[],
  request: Request,
): Promise<Reply> {
  const matched = matchRoute(method, segments);
  if (matched === null) return fail(404, "no-such-endpoint", "Unknown endpoint. GET /api/assistant/v1 lists them.");
  if (matched === "method") return fail(405, "method", "That endpoint does not take this method. GET /api/assistant/v1 lists them.");
  const { route, params } = matched;

  if (overBudget(identity, method !== "GET")) {
    return fail(429, "slow-down", "Too many requests this minute. Wait a minute and try again.");
  }
  if (route.scope && !identity.scopes.has(route.scope)) {
    return fail(403, "not-allowed", `This assistant is not allowed to do that (needs "${route.scope}"). An admin can allow it on the Team page.`);
  }

  // The same identity checks a page makes: the account and its company as of now.
  const user = await sessionUser();
  if (!user) return fail(401, "unauthorized", "This assistant was switched off.");
  const blocked = await companyLifecycleBlock(user);
  if (blocked) return fail(403, blocked, `The company is ${blocked}.`);
  if (route.orders && !(await getCompanyModules(user.companyId)).orders) {
    return fail(404, "module-off", "Orders are switched off for this company.");
  }

  let body: Record<string, unknown> = {};
  if (method !== "GET") {
    // JSON only: a cross-site form cannot send it without a preflight.
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return fail(415, "json-only", "Send a JSON body with Content-Type: application/json.");
    }
    const text = await request.text();
    if (text.length > MAX_BODY) return fail(413, "too-large", "The body is too large.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || "{}");
    } catch {
      return fail(400, "bad-json", "The body is not valid JSON.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "bad-json", "The body must be a JSON object.");
    body = parsed as Record<string, unknown>;
  }

  const query = new URL(request.url).searchParams;
  const lang: Locale = query.get("lang") === "zh" ? "zh" : "en";
  return route.run({ identity, user, lang, query, body, prices: identity.scopes.has("prices") }, params);
}
