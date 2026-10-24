"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, FileText, Paperclip, Trash2, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addFollowupChecklistItem,
  loadFollowupCard,
  moveFollowupCard,
  postFollowupUpdate,
  removeFollowupChecklistItem,
  removeFollowupUpdate,
  setFollowupChecklistDone,
  setFollowupChecklistOwner,
  setFollowupNextStep,
  setFollowupProblem,
  type FollowupResult,
} from "@/lib/actions/followup";
import { defaultNextKey, FOLLOWUP_STAGES, MAX_UPDATE_FILES, nextStageOf, type FollowupStage } from "@/lib/followup";
import type {
  FollowupCardDetail,
  FollowupEntryView,
  FollowupUser,
  SupplierCardView,
} from "@/lib/followup-server";
import { Avatar, costLabel, formatDay, formatMoment, ProductThumb } from "@/components/followup/followup-ui";

const SELECT =
  "focus-ring h-9 rounded-[10px] border border-line bg-surface px-2 text-[13px] text-ink disabled:opacity-60";

/** A key for one post, made in the browser; works without a secure context. */
function newClientKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const ERROR_KEYS = new Set(["conflict", "size", "fileType", "storageFull", "tooManyFiles", "empty", "owner"]);

/**
 * One card, opened: its stage, the next step and who has it, a problem if
 * one is flagged, the checklist, and the feed of updates. Read fresh from the
 * server on open and after every change, so two people looking at the same
 * card converge on the same truth.
 */
export function CardPanel({
  cardId,
  siblings,
  users,
  currentUserId,
  isAdmin,
  locale,
  onClose,
  onChanged,
}: {
  cardId: number;
  siblings: SupplierCardView[];
  users: FollowupUser[];
  currentUserId: number;
  isAdmin: boolean;
  locale: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("followup");
  const [detail, setDetail] = useState<FollowupCardDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reload = useCallback(async () => {
    setDetail(await loadFollowupCard(cardId));
  }, [cardId]);

  useEffect(() => {
    let live = true;
    loadFollowupCard(cardId).then((d) => {
      if (live) setDetail(d);
    });
    return () => {
      live = false;
    };
  }, [cardId]);

  /** Runs an action, then re-reads the card and the board whatever happened. */
  function run(action: () => Promise<FollowupResult>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action().catch(() => ({ error: "generic" }) as FollowupResult);
      if (result.error) setError(t(ERROR_KEYS.has(result.error) ? `error_${result.error}` : "error_generic"));
      else after?.();
      await reload();
      onChanged();
    });
  }

  const userById = new Map(users.map((u) => [u.id, u]));
  const card = detail?.card;

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(20,12,8,.45)]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[640px] flex-col overflow-y-auto border-l border-line bg-surface text-ink shadow-2xl focus:outline-none"
          data-testid="followup-panel"
          data-card={cardId}
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
            <div className="min-w-0">
              {card ? (
                <>
                  <p className="text-[12.5px] text-sub">
                    <Link href={`/orders/${card.orderId}`} className="font-mono hover:underline" data-testid="followup-panel-order">
                      {card.orderNumber}
                    </Link>{" "}
                    · {card.clientName}
                  </p>
                  <DialogPrimitive.Title className="text-[21px] font-extrabold leading-tight text-ink">
                    {card.kind === "shipment" ? card.orderNumber : card.kind === "unassigned" ? t("noSupplier") : card.supplierName}
                  </DialogPrimitive.Title>
                  {card.kind !== "shipment" && card.supplierNameAlt ? (
                    <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-sub">{card.supplierNameAlt}</p>
                  ) : null}
                  {card.kind !== "shipment" ? (
                    <p className="mt-1 text-[14px] font-semibold text-ink">
                      {card.mainProductName}{" "}
                      <span className="text-[12.5px] font-normal text-sub">
                        {[card.otherLines > 0 ? t("moreLines", { count: card.otherLines }) : null, t("pieces", { count: card.pieces.toLocaleString("en-US") }), costLabel(card.cost)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </p>
                  ) : (
                    <p className="mt-1 text-[13px] text-sub">
                      {card.shippedOn ? t("shippedOn", { date: formatDay(card.shippedOn, locale) }) : t("shipped")}
                    </p>
                  )}
                </>
              ) : (
                <DialogPrimitive.Title className="text-[15px] text-sub">{t("loading")}</DialogPrimitive.Title>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t("close")} data-testid="followup-panel-close">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {detail === null ? <p className="p-5 text-[14px] text-sub" data-testid="followup-missing-card">{t("cardMissing")}</p> : null}

          {card && detail ? (
            <div className="flex flex-col gap-6 px-5 py-5">
              {error ? (
                <p role="alert" className="flex items-start gap-2 rounded-[10px] border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger" data-testid="followup-error">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {error}
                </p>
              ) : null}

              {card.kind === "supplier" ? (
                <StageControl
                  stage={card.stage}
                  pending={pending}
                  onMove={(stage) => run(() => moveFollowupCard(card.id, stage, card.version))}
                  siblings={siblings.filter((s) => s.orderId === card.orderId)}
                  orderId={card.orderId}
                />
              ) : null}
              {card.kind === "unassigned" ? (
                <p className="rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{t("unassignedHelp")}</p>
              ) : null}

              <ProblemForm
                key={`p${card.version}`}
                problem={card.problem}
                pending={pending}
                onSave={(text) => run(() => setFollowupProblem(card.id, text, card.version))}
              />

              <NextStepForm
                key={`n${card.version}`}
                nextStep={card.nextStep}
                nextDue={card.nextDue}
                nextOwnerId={card.nextOwnerId}
                placeholder={(() => {
                  const key = defaultNextKey(card.kind, card.stage);
                  return key ? t(`defaultNext_${key}`) : t("nextStepPlaceholder");
                })()}
                users={users}
                pending={pending}
                onSave={(value) => run(() => setFollowupNextStep(card.id, value, card.version))}
              />

              {card.kind === "shipment" ? (
                <ShipmentDocs detail={detail} />
              ) : (
                <section className="flex flex-col gap-1" aria-label={t("products")}>
                  <h3 className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-sub">{t("products")}</h3>
                  <ul className="flex flex-col">
                    {detail.lines.map((line, i) => (
                      <li key={i} className="flex justify-between gap-3 border-b border-line py-1.5 text-[13px]">
                        <span className="flex items-center gap-2">
                          {i === 0 ? <ProductThumb path={card.mainProductThumb} size={28} /> : null}
                          {line.name}
                        </span>
                        <span className="shrink-0 font-mono text-sub">{line.quantity.toLocaleString("en-US")}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <Checklist
                items={detail.checklist}
                users={users}
                userById={userById}
                pending={pending}
                onAdd={(text, ownerId, done) => run(() => addFollowupChecklistItem(card.id, text, ownerId), done)}
                onToggle={(id, done) => run(() => setFollowupChecklistDone(id, done))}
                onOwner={(id, ownerId) => run(() => setFollowupChecklistOwner(id, ownerId))}
                onRemove={(id) => run(() => removeFollowupChecklistItem(id))}
              />

              <Feed
                entries={detail.entries}
                userById={userById}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                locale={locale}
                pending={pending}
                onRemove={(id) => {
                  if (window.confirm(t("removeConfirm"))) run(() => removeFollowupUpdate(id));
                }}
              />
              <Composer
                cardId={card.id}
                pending={pending}
                onPost={(formData, done) => run(() => postFollowupUpdate(formData), done)}
              />
            </div>
          ) : null}
          {detail === undefined ? <p className="p-5 text-[14px] text-sub">{t("loading")}</p> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function StageControl({
  stage,
  pending,
  onMove,
  siblings,
  orderId,
}: {
  stage: FollowupStage;
  pending: boolean;
  onMove: (stage: FollowupStage) => void;
  siblings: SupplierCardView[];
  orderId: number;
}) {
  const t = useTranslations("followup");
  const index = FOLLOWUP_STAGES.indexOf(stage);
  const back = index > 0 ? FOLLOWUP_STAGES[index - 1] : null;
  const next = nextStageOf(stage);
  const atWarehouse = siblings.filter((s) => s.stage === "at_warehouse").length;
  return (
    <section className="flex flex-col gap-2" aria-label={t("stageLabel")}>
      <ol className="flex gap-1" data-testid="followup-stages">
        {FOLLOWUP_STAGES.map((s, i) => (
          <li
            key={s}
            aria-current={i === index ? "step" : undefined}
            className={`flex-1 rounded-[6px] px-1 py-1.5 text-center text-[11.5px] font-semibold ${
              i < index ? "bg-ok-soft text-ok" : i === index ? "bg-action text-white" : "bg-surface-2 text-sub"
            }`}
          >
            {t(`stage_${s}`)}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {back ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onMove(back)} data-testid="followup-move-back">
            <ChevronLeft />
            {t("moveBack", { stage: t(`stage_${back}`) })}
          </Button>
        ) : null}
        {next ? (
          <Button size="sm" disabled={pending} onClick={() => onMove(next)} data-testid="followup-move-next">
            {t("moveTo", { stage: t(`stage_${next}`) })}
            <ChevronRight />
          </Button>
        ) : null}
      </div>
      {stage === "at_warehouse" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-surface-2 px-3 py-2 text-[13px]" data-testid="followup-ships-as-one">
          <span className="flex-1">
            {atWarehouse === siblings.length
              ? t("allAtWarehouse")
              : t("shipsAsOne", { done: atWarehouse, total: siblings.length })}
          </span>
          {atWarehouse === siblings.length ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/orders/${orderId}`} data-testid="followup-ship-link">
                {t("markShippedOnOrder")}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ProblemForm({ problem, pending, onSave }: { problem: string; pending: boolean; onSave: (text: string) => void }) {
  const t = useTranslations("followup");
  const [value, setValue] = useState("");
  if (problem) {
    return (
      <section className="flex items-start gap-2 rounded-[10px] border border-danger-line bg-danger-soft px-3 py-2" aria-label={t("problem")}>
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <p className="flex-1 text-[13.5px] font-semibold text-danger" data-testid="followup-problem">{problem}</p>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => onSave("")} data-testid="followup-problem-clear">
          {t("clearProblem")}
        </Button>
      </section>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSave(value);
      }}
    >
      <label htmlFor="followup-problem" className="w-[92px] shrink-0 text-[13px] text-sub">
        {t("problem")}
      </label>
      <Input
        id="followup-problem"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("problemPlaceholder")}
        maxLength={200}
        className="h-9 flex-1"
        data-testid="followup-problem-input"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending || !value.trim()} data-testid="followup-problem-save">
        {t("flagProblem")}
      </Button>
    </form>
  );
}

function OwnerSelect({
  id,
  value,
  users,
  onChange,
  disabled,
  label,
  testId,
}: {
  id?: string;
  value: number | null;
  users: FollowupUser[];
  onChange: (value: number | null) => void;
  disabled?: boolean;
  label?: string;
  testId?: string;
}) {
  const t = useTranslations("followup");
  // A deactivated owner stays visible on what they held, but cannot be picked
  // anew; an assistant account never holds work.
  const options = users.filter((u) => (u.active && u.assignable) || u.id === value);
  return (
    <select
      id={id}
      className={SELECT}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
    >
      <option value="">{t("nobody")}</option>
      {options.map((u) => (
        <option key={u.id} value={u.id} disabled={!u.active || !u.assignable}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

function NextStepForm({
  nextStep,
  nextDue,
  nextOwnerId,
  placeholder,
  users,
  pending,
  onSave,
}: {
  nextStep: string;
  nextDue: string | null;
  nextOwnerId: number | null;
  placeholder: string;
  users: FollowupUser[];
  pending: boolean;
  onSave: (value: { nextStep: string; nextDue: string | null; nextOwnerId: number | null }) => void;
}) {
  const t = useTranslations("followup");
  const [text, setText] = useState(nextStep);
  const [due, setDue] = useState(nextDue ?? "");
  const [owner, setOwner] = useState<number | null>(nextOwnerId);
  const dirty = text.trim() !== nextStep || (due || null) !== nextDue || owner !== nextOwnerId;
  return (
    <form
      className="flex flex-col gap-2 rounded-[12px] border border-line bg-bg p-3"
      aria-label={t("nextStep")}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ nextStep: text, nextDue: due || null, nextOwnerId: owner });
      }}
    >
      <label htmlFor="followup-next-text" className="text-[12.5px] font-semibold text-ink">
        {t("nextStep")}
      </label>
      <Input
        id="followup-next-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={200}
        className="h-10"
        data-testid="followup-next-text"
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="followup-next-due" className="text-[12px] text-sub">
            {t("due")}
          </label>
          <input
            id="followup-next-due"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={SELECT}
            data-testid="followup-next-due"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="followup-next-owner" className="text-[12px] text-sub">
            {t("who")}
          </label>
          <OwnerSelect id="followup-next-owner" value={owner} users={users} onChange={setOwner} testId="followup-next-owner" />
        </div>
        <Button type="submit" size="sm" disabled={pending || !dirty} className="ml-auto" data-testid="followup-next-save">
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

function Checklist({
  items,
  users,
  userById,
  pending,
  onAdd,
  onToggle,
  onOwner,
  onRemove,
}: {
  items: FollowupCardDetail["checklist"];
  users: FollowupUser[];
  userById: Map<number, FollowupUser>;
  pending: boolean;
  onAdd: (text: string, ownerId: number | null, done: () => void) => void;
  onToggle: (id: number, done: boolean) => void;
  onOwner: (id: number, ownerId: number | null) => void;
  onRemove: (id: number) => void;
}) {
  const t = useTranslations("followup");
  const [text, setText] = useState("");
  const [owner, setOwner] = useState<number | null>(null);
  const done = items.filter((i) => i.done).length;
  return (
    <section className="flex flex-col gap-1" aria-label={t("checklist")} data-testid="followup-checklist">
      <h3 className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-sub">
        {t("checklist")} · {done}/{items.length}
      </h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 py-1" data-testid="followup-check-item" data-done={item.done}>
            <button
              type="button"
              onClick={() => onToggle(item.id, !item.done)}
              aria-pressed={item.done}
              disabled={pending}
              className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded text-left text-[13.5px]"
              data-testid="followup-check-toggle"
            >
              <span
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] ${
                  item.done ? "border border-ok bg-ok text-surface" : "border-[1.5px] border-line-strong"
                }`}
              >
                {item.done ? <Check size={12} strokeWidth={3.5} aria-hidden="true" /> : null}
              </span>
              <span className={item.done ? "text-sub line-through" : "text-ink"}>{item.text}</span>
            </button>
            <Avatar user={item.ownerId ? userById.get(item.ownerId) : undefined} size={22} />
            <OwnerSelect
              value={item.ownerId}
              users={users}
              onChange={(v) => onOwner(item.id, v)}
              disabled={pending}
              label={t("checklistOwner", { text: item.text })}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={pending}
              onClick={() => onRemove(item.id)}
              aria-label={t("checklistRemove", { text: item.text })}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="mt-1 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onAdd(text, owner, () => setText(""));
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("checklistPlaceholder")}
          maxLength={200}
          className="h-9 flex-1"
          aria-label={t("checklistAdd")}
          data-testid="followup-check-input"
        />
        <OwnerSelect value={owner} users={users} onChange={setOwner} label={t("who")} testId="followup-check-owner" />
        <Button type="submit" size="sm" variant="outline" disabled={pending || !text.trim()} data-testid="followup-check-add">
          {t("checklistAdd")}
        </Button>
      </form>
    </section>
  );
}

function stageName(t: ReturnType<typeof useTranslations>, value: unknown) {
  return typeof value === "string" && (FOLLOWUP_STAGES as readonly string[]).includes(value) ? t(`stage_${value}`) : String(value ?? "");
}

function describe(
  entry: FollowupEntryView,
  t: ReturnType<typeof useTranslations>,
  userById: Map<number, FollowupUser>,
  locale: string,
): string {
  const p = entry.payload;
  const text = typeof p.text === "string" ? p.text : "";
  switch (entry.kind) {
    case "stage":
      return t("event_stage", { from: stageName(t, p.from), to: stageName(t, p.to) });
    case "next_step": {
      const parts = [t("event_next", { text: text || "—" })];
      if (typeof p.due === "string") parts.push(t("event_nextDue", { date: formatDay(p.due, locale) }));
      if (typeof p.ownerId === "number") parts.push(t("event_nextOwner", { name: userById.get(p.ownerId)?.name ?? t("someone") }));
      return parts.join(" · ");
    }
    case "problem":
      return text ? t("event_problem", { text }) : t("event_problemCleared");
    case "check_added":
    case "check_done":
    case "check_undone":
    case "check_removed":
      return t(`event_${entry.kind}`, { text });
    case "order_status":
      return p.to === "confirmed" && p.from === "shipped"
        ? t("event_order_reopened")
        : p.to === "confirmed"
          ? t("event_order_confirmed")
          : p.to === "shipped"
            ? t("event_order_shipped")
            : t("event_order_other");
    default:
      return "";
  }
}

function Feed({
  entries,
  userById,
  currentUserId,
  isAdmin,
  locale,
  pending,
  onRemove,
}: {
  entries: FollowupEntryView[];
  userById: Map<number, FollowupUser>;
  currentUserId: number;
  isAdmin: boolean;
  locale: string;
  pending: boolean;
  onRemove: (id: number) => void;
}) {
  const t = useTranslations("followup");
  return (
    <section className="flex flex-col gap-3" aria-label={t("updates")}>
      <h3 className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-sub">{t("updates")}</h3>
      <ol className="flex flex-col gap-3" data-testid="followup-feed">
        {entries.map((entry) => {
          const who = entry.userId ? userById.get(entry.userId) : undefined;
          const name = who?.name ?? t("someone");
          if (entry.kind !== "comment") {
            return (
              <li key={entry.id} className="flex items-baseline gap-2.5 text-[12.5px] text-sub" data-testid="followup-entry" data-kind={entry.kind}>
                <span className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full bg-line-strong" aria-hidden="true" />
                <span>
                  <span className="text-ink">{describe(entry, t, userById, locale)}</span> · {name} · {formatMoment(entry.createdAt, locale)}
                </span>
              </li>
            );
          }
          if (entry.removed) {
            return (
              <li key={entry.id} className="flex items-center gap-2.5 text-[12.5px] italic text-sub" data-testid="followup-entry" data-kind="removed">
                <CircleDashed size={14} aria-hidden="true" />
                {t("removed")} · {name} · {formatMoment(entry.createdAt, locale)}
              </li>
            );
          }
          const mayRemove = entry.userId === currentUserId || isAdmin;
          return (
            <li key={entry.id} className="flex items-start gap-2.5" data-testid="followup-entry" data-kind="comment">
              <Avatar user={who} size={30} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="font-bold text-ink">{name}</span>
                  <span className="text-sub">{formatMoment(entry.createdAt, locale)}</span>
                  {mayRemove ? (
                    <button
                      type="button"
                      onClick={() => onRemove(entry.id)}
                      disabled={pending}
                      className="focus-ring ml-auto rounded text-[12px] text-sub hover:text-danger"
                      data-testid="followup-entry-remove"
                    >
                      {t("remove")}
                    </button>
                  ) : null}
                </div>
                {entry.body ? <p className="whitespace-pre-wrap text-[14px] text-ink" data-testid="followup-entry-body">{entry.body}</p> : null}
                {entry.attachments.length ? (
                  <div className="flex flex-wrap gap-2">
                    {entry.attachments.map((a) =>
                      a.image ? (
                        <a
                          key={a.id}
                          href={a.path}
                          target="_blank"
                          rel="noreferrer"
                          className="focus-ring block overflow-hidden rounded-[8px] border border-line"
                          data-testid="followup-attachment"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- gated upload, sized by the serving route */}
                          <img src={`${a.path}?w=256`} alt={a.name} className="h-20 w-24 object-cover" />
                        </a>
                      ) : (
                        <a
                          key={a.id}
                          href={a.path}
                          target="_blank"
                          rel="noreferrer"
                          className="focus-ring inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 text-[12.5px] text-ink hover:bg-surface-2"
                          data-testid="followup-attachment"
                        >
                          <FileText size={14} aria-hidden="true" />
                          {a.name}
                        </a>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Composer({
  cardId,
  pending,
  onPost,
}: {
  cardId: number;
  pending: boolean;
  onPost: (formData: FormData, done: () => void) => void;
}) {
  const t = useTranslations("followup");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [clientKey, setClientKey] = useState(newClientKey);
  const [inputKey, setInputKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <form
      className="flex flex-col gap-2 rounded-[12px] border border-line-strong bg-bg p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim() && files.length === 0) return;
        const data = new FormData();
        data.set("cardId", String(cardId));
        data.set("body", body);
        // The same key travels with every retry of this post until it lands.
        data.set("clientKey", clientKey);
        for (const f of files.slice(0, MAX_UPDATE_FILES)) data.append("files", f);
        onPost(data, () => {
          setBody("");
          setFiles([]);
          setInputKey((k) => k + 1);
          setClientKey(newClientKey());
        });
      }}
    >
      <label htmlFor="followup-update-body" className="sr-only">
        {t("updates")}
      </label>
      <Textarea
        id="followup-update-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("updatePlaceholder")}
        rows={3}
        maxLength={4000}
        data-testid="followup-update-body"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          key={inputKey}
          ref={fileInput}
          type="file"
          multiple
          accept="image/*,application/pdf,.xlsx,.xls,.docx"
          className="sr-only"
          id="followup-update-files"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          data-testid="followup-update-files"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <Paperclip />
          {t("attach")}
        </Button>
        {files.length ? (
          <span className="flex items-center gap-1 text-[12.5px] text-sub" data-testid="followup-files-chosen">
            <CheckCircle2 size={14} aria-hidden="true" />
            {t("filesChosen", { count: files.length })}
          </span>
        ) : null}
        <Button
          type="submit"
          size="sm"
          className="ml-auto"
          disabled={pending || (!body.trim() && files.length === 0)}
          data-testid="followup-update-post"
        >
          {t("post")}
        </Button>
      </div>
    </form>
  );
}

const RESPONSIBLE_ORDER = ["forwarder", "factory", "accountant", "company", "bank", "system"] as const;

function ShipmentDocs({ detail }: { detail: FollowupCardDetail }) {
  const t = useTranslations("followup");
  const dossier = useTranslations("dossier");
  const card = detail.card;
  if (card.kind !== "shipment") return null;
  const groups = RESPONSIBLE_ORDER.map((r) => ({ responsible: r, items: detail.dossier.filter((d) => d.responsible === r) })).filter(
    (g) => g.items.length > 0,
  );
  return (
    <>
      <section className="flex flex-col gap-1" aria-label={t("suppliers")}>
        <h3 className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-sub">{t("suppliers")}</h3>
        <ul>
          {detail.suppliers.map((s, i) => (
            <li key={i} className="border-b border-line py-1.5 text-[13px]">
              <span className="font-semibold text-ink">{s.name || t("noSupplier")}</span>
              {s.alt ? <span className="text-sub"> {s.alt}</span> : null}
              <span className="text-sub"> · {s.mainProduct}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3" aria-label={t("dossierTitle")} data-testid="followup-dossier">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-sub">{t("dossierTitle")}</h3>
            <span className="font-mono text-[13px] text-ink">
              {card.docsDone}/{card.docsRequired}
            </span>
          </div>
          <span className="block h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <span className="block h-full bg-ok" style={{ width: `${card.docsRequired ? Math.round((card.docsDone / card.docsRequired) * 100) : 0}%` }} />
          </span>
          <p className="text-[12.5px] text-sub">{t("dossierHelp")}</p>
          {card.regimeUndecided ? <p className="text-[12.5px] text-warn">{t("regimeUndecided")}</p> : null}
          <div>
            <Button asChild size="sm" variant="outline">
              <Link href={`/orders/${card.orderId}#dossier`} data-testid="followup-dossier-open">
                {t("dossierOpen")}
              </Link>
            </Button>
          </div>
        </div>
        {groups.map((g) => {
          const required = g.items.filter((i) => !i.optional);
          const ok = required.filter((i) => i.status === "uploaded" || i.status === "auto").length;
          return (
            <div key={g.responsible} className="flex flex-col">
              <div className="flex justify-between border-b border-line pb-1 text-[13px] font-bold text-ink">
                <span>{dossier(`responsible_${g.responsible}`)}</span>
                <span className="font-mono font-normal text-sub">
                  {ok}/{required.length}
                </span>
              </div>
              <ul>
                {g.items.map((item) => {
                  const done = item.status === "uploaded" || item.status === "auto";
                  return (
                    <li key={item.key} className="flex items-center gap-2.5 py-1 text-[13px]" data-testid="followup-dossier-item" data-status={item.status}>
                      <span
                        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] ${
                          done ? "border border-ok bg-ok text-surface" : item.status === "risk" ? "border-[1.5px] border-warn text-warn" : "border-[1.5px] border-line-strong"
                        }`}
                        aria-hidden="true"
                      >
                        {done ? <Check size={12} strokeWidth={3.5} /> : item.status === "risk" ? <AlertTriangle size={11} /> : null}
                      </span>
                      <span className="flex-1">
                        <span className="font-semibold text-ink">{item.zh}</span> <span className="text-sub">{item.en}</span>
                      </span>
                      <span className="text-[11.5px] text-sub">
                        {item.status === "auto"
                          ? t("dossierAuto")
                          : item.status === "risk"
                            ? t("dossierRisk")
                            : item.optional
                              ? t("dossierOptional")
                              : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>
    </>
  );
}
