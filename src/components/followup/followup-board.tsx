"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, CalendarDays, CheckCircle2, ListChecks, MessageSquare, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { moveFollowupCard } from "@/lib/actions/followup";
import {
  defaultNextKey,
  hasPendingStep,
  localIsoDate,
  needsAttention,
  FOLLOWUP_STAGES,
  type FollowupStage,
} from "@/lib/followup";
import type {
  FollowupBoard as Board,
  FollowupUser,
  ShipmentCardView,
  SupplierCardView,
  FollowupCardView,
} from "@/lib/followup-server";
import { Avatar, costLabel, dueInfo, DUE_CLASS, formatDay, ProductThumb } from "@/components/followup/followup-ui";
import { CardPanel } from "@/components/followup/card-panel";

type Filter = "all" | "attention" | "mine" | `user:${number}`;

const NO_MOVES = new Map<number, FollowupStage>();
const noSubscription = () => () => {};

/**
 * The board: five supplier stages and a Shipped column, cards sorted with
 * whatever needs attention on top. Everything the URL can say — which view,
 * which order, which card is open — is kept in the URL, so a link a colleague
 * sends opens the same card.
 */
export function FollowupBoard({
  board,
  currentUserId,
  isAdmin,
  serverToday,
}: {
  board: Board;
  currentUserId: number;
  isAdmin: boolean;
  serverToday: string;
}) {
  const t = useTranslations("followup");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  // The server renders Yiwu's date; the browser then reads its own.
  const today = useSyncExternalStore(noSubscription, () => localIsoDate(), () => serverToday);

  const [view, setView] = useState<"board" | "orders">(searchParams.get("view") === "orders" ? "orders" : "board");
  const [orderFilter, setOrderFilter] = useState<number | null>(Number(searchParams.get("order")) || null);
  const [openCard, setOpenCard] = useState<number | null>(Number(searchParams.get("card")) || null);
  // A link to ?card= while the board is already open (the task bell) opens that card.
  const cardParam = Number(searchParams.get("card")) || null;
  const [lastCardParam, setLastCardParam] = useState(cardParam);
  if (cardParam !== lastCardParam) {
    setLastCardParam(cardParam);
    if (cardParam !== null && cardParam !== openCard) setOpenCard(cardParam);
  }
  const [filter, setFilter] = useState<Filter>("all");
  // Optimistic moves, kept only until the server's next word on the board.
  const [optimistic, setOptimistic] = useState<{ board: Board; moved: Map<number, FollowupStage> }>({ board, moved: new Map() });
  const moved = optimistic.board === board ? optimistic.moved : NO_MOVES;
  const [banner, setBanner] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<FollowupStage | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const set = (key: string, value: string | null) => (value ? params.set(key, value) : params.delete(key));
    set("view", view === "orders" ? "orders" : null);
    set("order", orderFilter ? String(orderFilter) : null);
    set("card", openCard ? String(openCard) : null);
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [view, orderFilter, openCard]);

  const userById = useMemo(() => new Map(board.users.map((u) => [u.id, u])), [board.users]);
  const cards = useMemo(
    () => board.cards.map((c) => (moved.has(c.id) ? { ...c, stage: moved.get(c.id)! } : c)),
    [board.cards, moved],
  );
  const all: FollowupCardView[] = useMemo(() => [...cards, ...board.shipments], [cards, board.shipments]);

  const pending = (c: FollowupCardView) =>
    hasPendingStep({ kind: c.kind, stage: c.stage, nextStep: c.nextStep, complete: c.kind === "shipment" ? c.complete : undefined });
  const attention = (c: FollowupCardView) => needsAttention({ kind: c.kind, nextDue: c.nextDue, problem: c.problem }, today);
  const waitingOn = (c: FollowupCardView, userId: number) => c.nextOwnerId === userId && pending(c);
  const matches = (c: FollowupCardView, f: Filter = filter) => {
    if (orderFilter && c.orderId !== orderFilter) return false;
    if (f === "all") return true;
    if (f === "attention") return attention(c);
    return waitingOn(c, f === "mine" ? currentUserId : Number(f.slice(5)));
  };
  const scoped = all.filter((c) => !orderFilter || c.orderId === orderFilter);
  const filters: { id: Filter; label: string; count: number; danger?: boolean }[] = [
    { id: "all", label: t("filterAll"), count: scoped.length },
    { id: "attention", label: t("filterAttention"), count: scoped.filter(attention).length, danger: true },
    { id: "mine", label: t("filterMine"), count: scoped.filter((c) => waitingOn(c, currentUserId)).length },
    ...board.users
      .filter((u) => u.id !== currentUserId)
      .map((u) => ({ id: `user:${u.id}` as Filter, label: t("filterPerson", { name: u.name }), count: scoped.filter((c) => waitingOn(c, u.id)).length }))
      .filter((f) => f.count > 0),
  ];

  // Within a column: problems and overdue first, then the nearest date, then the newest activity.
  const rank = (c: FollowupCardView) => (attention(c) ? 0 : 1);
  const sorted = <T extends FollowupCardView>(list: T[]) =>
    [...list].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999") ||
        b.touchedAt.localeCompare(a.touchedAt) ||
        a.id - b.id,
    );

  const visibleCards = cards.filter((c) => matches(c));
  const visibleShipments = board.shipments.filter((c) => matches(c));

  function move(cardId: number, stage: FollowupStage) {
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.kind !== "supplier" || card.stage === stage) return;
    setBanner(null);
    setOptimistic((o) => ({ board, moved: new Map(o.board === board ? o.moved : []).set(cardId, stage) }));
    startTransition(async () => {
      const result = await moveFollowupCard(cardId, stage, card.version);
      if (result.error) {
        setOptimistic((o) => {
          const next = new Map(o.board === board ? o.moved : []);
          next.delete(cardId);
          return { board, moved: next };
        });
        setBanner(t(result.error === "conflict" ? "error_conflict" : "error_generic"));
      }
      router.refresh();
    });
  }

  const openOrderNumber = orderFilter ? all.find((c) => c.orderId === orderFilter)?.orderNumber : undefined;
  const orderCount = new Set(board.cards.map((c) => c.orderId)).size;

  return (
    <div className="mx-auto max-w-[1880px] px-4 py-5" data-testid="followup-board">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[23px] font-extrabold tracking-tight text-ink">{t("title")}</h1>
          <p className="text-[13px] text-sub">
            {t("subtitle", { cards: board.cards.length, orders: orderCount, shipped: board.shipments.length })}
          </p>
        </div>
        <div className="inline-flex overflow-hidden rounded-[10px] border border-line" role="group">
          {(["board", "orders"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              data-testid={`followup-view-${v}`}
              className={`focus-ring px-3.5 py-2 text-[13px] font-semibold ${view === v ? "bg-ink text-bg" : "text-ink hover:bg-surface-2"}`}
            >
              {t(v === "board" ? "viewBoard" : "viewOrders")}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" data-testid="followup-filters">
        {filters.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              data-testid={`followup-filter-${f.id.replace(":", "-")}`}
              className={`focus-ring inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold ${
                active ? "border-action-chrome bg-action-soft text-action-chrome" : "border-line text-ink hover:bg-surface-2"
              }`}
            >
              {f.label}
              <span
                className={`rounded-full px-1.5 font-mono text-[11.5px] ${f.danger && f.count > 0 ? "bg-danger-soft text-danger" : "bg-surface-2 text-ink"}`}
              >
                {f.count}
              </span>
            </button>
          );
        })}
        {orderFilter ? (
          <button
            type="button"
            onClick={() => setOrderFilter(null)}
            className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[13px] font-semibold text-ink"
            data-testid="followup-order-filter"
          >
            {t("filterOrder", { number: openOrderNumber ?? `#${orderFilter}` })}
            <X size={14} aria-hidden="true" />
            <span className="sr-only">{t("clearFilter")}</span>
          </button>
        ) : null}
      </div>

      {banner ? (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-[10px] border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{banner}</span>
          <button type="button" onClick={() => setBanner(null)} aria-label={t("close")} className="focus-ring rounded">
            <X size={16} />
          </button>
        </div>
      ) : null}

      {all.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-line-strong bg-surface p-8 text-center text-[14px] text-sub" data-testid="followup-empty">
          {t("emptyBoard")}
        </p>
      ) : view === "board" ? (
        <>
          <p className="mb-2 hidden text-[12px] text-sub lg:block">{t("dragHint")}</p>
          <div className="overflow-x-auto pb-2">
            <div className="flex items-start gap-3">
              {FOLLOWUP_STAGES.map((stage) => {
                const list = sorted(visibleCards.filter((c) => c.stage === stage));
                return (
                  <section
                    key={stage}
                    aria-label={t(`stage_${stage}`)}
                    data-testid={`followup-column-${stage}`}
                    onDragOver={(e) => {
                      if (dragging === null) return;
                      e.preventDefault();
                      setOver(stage);
                    }}
                    onDragLeave={() => setOver((s) => (s === stage ? null : s))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = Number(e.dataTransfer.getData("text/plain"));
                      setOver(null);
                      setDragging(null);
                      if (id) move(id, stage);
                    }}
                    className={`flex min-w-[216px] flex-1 basis-0 flex-col gap-2 rounded-[12px] border p-2.5 transition-colors ${
                      over === stage ? "border-action-chrome bg-action-soft" : "border-line bg-surface-2"
                    }`}
                  >
                    <ColumnHeader title={t(`stage_${stage}`)} alt={t(`stageAlt_${stage}`)} count={list.length} />
                    {list.map((card) => (
                      <SupplierTile
                        key={card.id}
                        card={card}
                        owner={card.nextOwnerId ? userById.get(card.nextOwnerId) : undefined}
                        today={today}
                        selected={openCard === card.id}
                        onOpen={() => setOpenCard(card.id)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", String(card.id));
                          e.dataTransfer.effectAllowed = "move";
                          setDragging(card.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                      />
                    ))}
                    {list.length === 0 ? <p className="px-1 py-2 text-[12.5px] text-sub">{t("emptyColumn")}</p> : null}
                  </section>
                );
              })}
              <section
                aria-label={t("shipped")}
                data-testid="followup-column-shipped"
                className="flex min-w-[216px] flex-1 basis-0 flex-col gap-2 rounded-[12px] border border-line bg-ok-soft p-2.5"
              >
                <ColumnHeader title={t("shipped")} alt={t("shippedAlt")} count={visibleShipments.length} />
                <p className="px-1 text-[12px] text-sub">{t("shippedColumnHelp")}</p>
                {sorted(visibleShipments).map((card) => (
                  <ShipmentTile
                    key={card.id}
                    card={card}
                    owner={card.nextOwnerId ? userById.get(card.nextOwnerId) : undefined}
                    today={today}
                    selected={openCard === card.id}
                    onOpen={() => setOpenCard(card.id)}
                  />
                ))}
                {visibleShipments.length === 0 ? <p className="px-1 py-2 text-[12.5px] text-sub">{t("emptyColumn")}</p> : null}
              </section>
            </div>
          </div>
        </>
      ) : (
        <ByOrder
          cards={visibleCards}
          allCards={cards}
          shipments={visibleShipments}
          userById={userById}
          today={today}
          onOpen={setOpenCard}
          onFilterOrder={setOrderFilter}
        />
      )}

      {visibleCards.length + visibleShipments.length === 0 && all.length > 0 ? (
        <p className="mt-3 text-[13px] text-sub" data-testid="followup-no-match">{t("emptyFilter")}</p>
      ) : null}

      {openCard ? (
        <CardPanel
          key={openCard}
          cardId={openCard}
          siblings={cards}
          users={board.users}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          locale={locale}
          onClose={() => setOpenCard(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function ColumnHeader({ title, alt, count }: { title: string; alt: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-1 pb-0.5 pt-0.5">
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-bold leading-tight text-ink">{title}</h2>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-sub">{alt}</p>
      </div>
      <span className="font-mono text-[12px] text-sub" data-testid="followup-column-count">{count}</span>
    </div>
  );
}

function NextLine({ card, owner, today }: { card: FollowupCardView; owner: FollowupUser | undefined; today: string }) {
  const t = useTranslations("followup");
  const locale = useLocale();
  const due = dueInfo(card.nextDue, today);
  const fallback = defaultNextKey(card.kind, card.stage);
  const done = card.kind === "shipment" && card.complete && !card.nextStep;
  const text = card.nextStep || (fallback && !done ? t(`defaultNext_${fallback}`) : t("nothingPending"));
  const dueLabel =
    due.state === "overdue"
      ? t("dueOverdue", { days: due.days })
      : due.state === "today"
        ? t("dueToday")
        : card.nextDue
          ? formatDay(card.nextDue, locale)
          : null;
  return (
    <span className="flex items-start gap-2 border-t border-line pt-2">
      <span className="min-w-0 flex-1">
        {dueLabel ? (
          <span className={`flex items-center gap-1 text-[12px] ${DUE_CLASS[due.state]}`} data-testid="followup-due" data-state={due.state}>
            <CalendarDays size={13} aria-hidden="true" />
            {dueLabel}
          </span>
        ) : null}
        <span className="line-clamp-2 block text-[12.5px] text-ink" data-testid="followup-next">{text}</span>
      </span>
      <Avatar user={owner} label={owner ? `${t("who")}: ${owner.name}` : t("nobody")} />
    </span>
  );
}

function Counts({ card }: { card: FollowupCardView }) {
  if (card.checklistTotal === 0 && card.comments === 0) return null;
  return (
    <span className="flex items-center gap-3 font-mono text-[11.5px] text-sub">
      {card.checklistTotal > 0 ? (
        <span className="inline-flex items-center gap-1">
          <ListChecks size={13} aria-hidden="true" />
          {card.checklistDone}/{card.checklistTotal}
        </span>
      ) : null}
      {card.comments > 0 ? (
        <span className="inline-flex items-center gap-1">
          <MessageSquare size={13} aria-hidden="true" />
          {card.comments}
        </span>
      ) : null}
    </span>
  );
}

const TILE =
  "press focus-ring flex w-full flex-col gap-2 rounded-[12px] border bg-surface p-3 text-left shadow-[0_1px_0_rgba(0,0,0,.04)]";

function SupplierTile({
  card,
  owner,
  today,
  selected,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: SupplierCardView;
  owner: FollowupUser | undefined;
  today: string;
  selected: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const t = useTranslations("followup");
  const unassigned = card.kind === "unassigned";
  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={!unassigned}
      onDragStart={unassigned ? undefined : onDragStart}
      onDragEnd={onDragEnd}
      className={`${TILE} ${selected ? "border-action-chrome ring-1 ring-action-chrome" : "border-line"} ${unassigned ? "" : "cursor-grab active:cursor-grabbing"}`}
      data-testid="followup-card"
      data-card={card.id}
      data-kind={card.kind}
      data-stage={card.stage}
    >
      <span className="block min-w-0">
        <span className="block text-[14.5px] font-bold leading-tight text-ink" data-testid="followup-card-supplier">
          {unassigned ? t("noSupplier") : card.supplierName}
        </span>
        {card.supplierNameAlt ? (
          <span className="block truncate font-mono text-[10.5px] uppercase tracking-[0.06em] text-sub">{card.supplierNameAlt}</span>
        ) : null}
      </span>
      <span className="flex items-center gap-2 rounded-[8px] bg-surface-2 p-1.5">
        <ProductThumb path={card.mainProductThumb} />
        <span className="min-w-0">
          <span className="line-clamp-2 block text-[13px] font-semibold leading-snug text-ink" data-testid="followup-card-product">
            {card.mainProductName}
          </span>
          <span className="block text-[11.5px] text-sub">
            {[card.otherLines > 0 ? t("moreLines", { count: card.otherLines }) : null, t("pieces", { count: card.pieces.toLocaleString("en-US") }), costLabel(card.cost)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </span>
      <span className="block truncate text-[12px] text-sub">
        <span className="font-mono">{card.orderNumber}</span> · {card.clientName}
      </span>
      {card.problem ? (
        <span className="inline-flex items-start gap-1 self-start rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] font-semibold text-danger" data-testid="followup-problem-chip">
          <AlertTriangle size={12} className="mt-[1px] shrink-0" aria-hidden="true" />
          {card.problem}
        </span>
      ) : null}
      <Counts card={card} />
      <NextLine card={card} owner={owner} today={today} />
    </button>
  );
}

function ShipmentTile({
  card,
  owner,
  today,
  selected,
  onOpen,
}: {
  card: ShipmentCardView;
  owner: FollowupUser | undefined;
  today: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("followup");
  const dossier = useTranslations("dossier");
  const locale = useLocale();
  const pct = card.docsRequired ? Math.round((card.docsDone / card.docsRequired) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${TILE} ${selected ? "border-action-chrome ring-1 ring-action-chrome" : "border-line"}`}
      data-testid="followup-shipment"
      data-card={card.id}
    >
      <span className="block">
        <span className="block font-mono text-[14px] font-semibold text-ink">{card.orderNumber}</span>
        <span className="block truncate text-[12px] text-sub">
          {card.clientName}
          {card.shippedOn ? ` · ${t("shippedOn", { date: formatDay(card.shippedOn, locale) })}` : ""}
        </span>
      </span>
      <span className="block rounded-[8px] bg-surface-2 px-2 py-1.5">
        <span className="line-clamp-2 block text-[13px] font-semibold leading-snug text-ink">{card.productNames.slice(0, 2).join(" · ")}</span>
        <span className="block truncate text-[11.5px] text-sub">
          {t("supplierCount", { count: card.supplierNames.length })}
          {card.supplierNames.length ? ` · ${card.supplierNames.join("、")}` : ""}
        </span>
      </span>
      <span className="flex flex-col gap-1">
        <span className="flex justify-between gap-2 text-[12px]">
          <span className="font-semibold text-ink">{t("exportDocs")}</span>
          <span className="font-mono text-ink" data-testid="followup-docs">{card.docsDone}/{card.docsRequired}</span>
        </span>
        <span className="block h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <span className="block h-full bg-ok" style={{ width: `${pct}%` }} />
        </span>
      </span>
      {card.complete ? (
        <span className="inline-flex items-center gap-1 self-start rounded-full bg-ok-soft px-2 py-0.5 text-[11.5px] font-semibold text-ok">
          <CheckCircle2 size={12} aria-hidden="true" />
          {t("allDocsIn")}
        </span>
      ) : card.missing.length ? (
        <span className="flex flex-wrap items-center gap-1" data-testid="followup-missing">
          <span className="text-[11.5px] text-sub">{t("missing")}:</span>
          {card.missing.map((m) => (
            <span key={m.responsible} className="rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] font-semibold text-warn">
              {dossier(`responsible_${m.responsible}`)} ×{m.count}
            </span>
          ))}
        </span>
      ) : null}
      {card.regimeUndecided ? <span className="text-[11.5px] text-warn">{t("regimeUndecided")}</span> : null}
      {card.problem ? (
        <span className="inline-flex items-start gap-1 self-start rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] font-semibold text-danger">
          <AlertTriangle size={12} className="mt-[1px] shrink-0" aria-hidden="true" />
          {card.problem}
        </span>
      ) : null}
      <Counts card={card} />
      <NextLine card={card} owner={owner} today={today} />
    </button>
  );
}

function ByOrder({
  cards,
  allCards,
  shipments,
  userById,
  today,
  onOpen,
  onFilterOrder,
}: {
  cards: SupplierCardView[];
  allCards: SupplierCardView[];
  shipments: ShipmentCardView[];
  userById: Map<number, FollowupUser>;
  today: string;
  onOpen: (id: number) => void;
  onFilterOrder: (id: number) => void;
}) {
  const t = useTranslations("followup");
  const locale = useLocale();
  const orderIds = [...new Set(cards.map((c) => c.orderId))];
  return (
    <div className="flex max-w-[1240px] flex-col gap-3" data-testid="followup-by-order">
      {orderIds.map((orderId) => {
        const mine = cards.filter((c) => c.orderId === orderId);
        const everyone = allCards.filter((c) => c.orderId === orderId);
        const atWarehouse = everyone.filter((c) => c.stage === "at_warehouse").length;
        return (
          <section key={orderId} className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4" data-testid="followup-order">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button type="button" onClick={() => onFilterOrder(orderId)} className="focus-ring rounded font-mono text-[15px] font-semibold text-ink hover:underline">
                {mine[0].orderNumber}
              </button>
              <span className="text-[13px] text-sub">{mine[0].clientName}</span>
              <span className="ml-auto font-mono text-[12.5px] text-sub">{t("atWarehouseCount", { done: atWarehouse, total: everyone.length })}</span>
              <Link href={`/orders/${orderId}`} className="focus-ring rounded text-[12.5px] font-semibold text-action-chrome hover:underline">
                {t("openOrder")}
              </Link>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
              {mine.map((card) => {
                const owner = card.nextOwnerId ? userById.get(card.nextOwnerId) : undefined;
                const step = FOLLOWUP_STAGES.indexOf(card.stage);
                const due = dueInfo(card.nextDue, today);
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => onOpen(card.id)}
                    className="press focus-ring flex flex-col gap-2 rounded-[10px] border border-line bg-bg p-3 text-left"
                    data-testid="followup-mini"
                    data-card={card.id}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-bold leading-tight text-ink">{card.kind === "unassigned" ? t("noSupplier") : card.supplierName}</span>
                        {card.supplierNameAlt ? (
                          <span className="block truncate font-mono text-[10.5px] uppercase tracking-[0.06em] text-sub">{card.supplierNameAlt}</span>
                        ) : null}
                        {/* A long name shortens; the "+2 more" never does, or the card looks like one product. */}
                        <span className="flex min-w-0 items-baseline gap-1 text-[12.5px]" data-testid="followup-mini-product">
                          <span className="truncate font-semibold text-ink" title={card.mainProductName}>
                            {card.mainProductName}
                          </span>
                          {card.otherLines > 0 ? <span className="shrink-0 whitespace-nowrap text-sub">{t("moreLines", { count: card.otherLines })}</span> : null}
                        </span>
                      </span>
                      <Avatar user={owner} label={owner ? `${t("who")}: ${owner.name}` : t("nobody")} />
                    </span>
                    {card.kind === "supplier" ? (
                      <span className="flex gap-1" aria-hidden="true">
                        {FOLLOWUP_STAGES.map((s, i) => (
                          <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-action-chrome" : "bg-line-strong"}`} />
                        ))}
                      </span>
                    ) : null}
                    <span className="text-[12.5px] font-semibold text-ink">{t(`stage_${card.stage}`)}</span>
                    {card.problem ? <span className="text-[12px] font-semibold text-danger">{card.problem}</span> : null}
                    <span className={`text-[12px] ${DUE_CLASS[due.state]}`}>
                      {due.state === "overdue" ? t("dueOverdue", { days: due.days }) : card.nextDue ? formatDay(card.nextDue, locale) : t("noDate")}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {shipments.length ? (
        <>
          <h2 className="mt-2 font-mono text-[12px] uppercase tracking-[0.1em] text-sub">{t("shipped")}</h2>
          {shipments.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpen(s.id)}
              className="press focus-ring flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[12px] border border-line bg-surface px-4 py-3 text-left"
              data-testid="followup-shipment-row"
            >
              <span className="font-mono font-semibold text-ink">{s.orderNumber}</span>
              <span className="text-[13px] text-sub">{s.clientName}</span>
              <span className="text-[13px] text-ink">{s.productNames.slice(0, 2).join(" · ")}</span>
              <span className="ml-auto font-mono text-[12.5px] text-ink">
                {t("exportDocs")} {s.docsDone}/{s.docsRequired}
              </span>
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}
