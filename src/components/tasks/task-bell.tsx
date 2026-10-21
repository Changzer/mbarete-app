"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Bell, CalendarDays, ListChecks } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { dueState, localIsoDate } from "@/lib/followup";
import { bellCount, sortTasks, type MyTask } from "@/lib/tasks";
import type { MyTasks } from "@/lib/tasks-server";
import { DUE_CLASS, formatDay, formatMoment } from "@/components/followup/followup-ui";

/**
 * The bell in the header: what is waiting on you on the follow-up board, and
 * which of it someone handed you since you last looked. Desk-first, but it
 * sits in the phone's header too — a task does not wait for a computer.
 *
 * It polls a Route Handler instead of being rendered with the page: the
 * header is on every page, and the board's data is too heavy to build on
 * every navigation. Opening it always reads fresh.
 */

const POLL_MS = 60_000;
const noSubscription = () => () => {};

export function TaskBell() {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const pathname = usePathname();
  const today = useSyncExternalStore(noSubscription, () => localIsoDate(), () => "");
  const [data, setData] = useState<MyTasks | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  // What was new when the bell opened keeps its mark until it closes.
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const load = useCallback(async (): Promise<MyTasks | null> => {
    try {
      const res = await fetch(`/api/tasks?locale=${encodeURIComponent(locale)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as MyTasks;
      setData(next);
      setFailed(false);
      return next;
    } catch {
      setFailed(true);
      return null;
    }
  }, [locale]);

  // On every page change, on a timer while the tab is in view, and on coming back to the tab.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (alive && document.visibilityState === "visible") void load();
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load, pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setMarked(new Set(data?.tasks.filter((x) => x.isNew).map((x) => x.key)));
    setOpen(true);
    const fresh = await load();
    if (!fresh) return;
    const fresher = fresh.tasks.filter((x) => x.isNew).map((x) => x.key);
    if (fresher.length === 0) return;
    setMarked((m) => new Set([...m, ...fresher]));
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upTo: fresh.asOf }),
    }).catch(() => null);
    // Seen: the number drops now; the marks stay until the bell closes.
    if (res?.ok) setData({ ...fresh, tasks: fresh.tasks.map((x) => (x.isNew ? { ...x, isNew: false } : x)) });
  }

  const tasks = data ? sortTasks(data.tasks, today) : [];
  const count = data ? bellCount(data.tasks, today) : 0;
  const names = new Map((data?.users ?? []).map((u) => [u.id, u.name]));

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={count > 0 ? t("bellLabelCount", { count }) : t("bellLabel")}
        className="press focus-ring relative inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-sub hover:bg-surface-2 hover:text-ink aria-expanded:bg-surface-2 aria-expanded:text-ink"
        data-testid="task-bell"
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
        {count > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-action px-1 font-mono text-[10.5px] font-bold leading-none text-white ring-2 ring-surface"
            data-testid="task-bell-count"
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("title")}
          className="fixed inset-x-2 top-[54px] z-50 flex max-h-[min(78vh,620px)] flex-col overflow-hidden rounded-[14px] border border-line bg-surface text-ink shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[420px]"
          data-testid="task-panel"
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-bold">{t("title")}</h2>
            <span className="text-[12.5px] text-sub">{t("count", { count: tasks.length })}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {failed && !data ? (
              <p className="px-4 py-6 text-[13px] text-danger">{t("loadFailed")}</p>
            ) : !data ? (
              <p className="px-4 py-6 text-[13px] text-sub">{t("loading")}</p>
            ) : tasks.length === 0 ? (
              <p className="px-4 py-6 text-[13px] leading-relaxed text-sub" data-testid="task-empty">
                {t("empty")}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {tasks.map((task) => (
                  <li key={task.key}>
                    <TaskRow
                      task={task}
                      today={today}
                      isNew={task.isNew || marked.has(task.key)}
                      from={task.fromId ? names.get(task.fromId) : undefined}
                      onPick={() => setOpen(false)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-line px-4 py-2.5">
            <Link
              href="/followup"
              onClick={() => setOpen(false)}
              className="focus-ring rounded text-[12.5px] font-semibold text-action-chrome hover:underline"
            >
              {t("openBoard")}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskRow({
  task,
  today,
  isNew,
  from,
  onPick,
}: {
  task: MyTask;
  today: string;
  isNew: boolean;
  from: string | undefined;
  onPick: () => void;
}) {
  const t = useTranslations("tasks");
  const tf = useTranslations("followup");
  const locale = useLocale();
  const due = dueState(task.due, today);
  const title = task.text || (task.defaultKey ? tf(`defaultNext_${task.defaultKey}`) : "");
  const where =
    task.cardKind === "unassigned" ? tf("noSupplier") : task.cardKind === "shipment" ? t("shipment") : task.supplierName;
  const dueLabel =
    due.state === "overdue"
      ? tf("dueOverdue", { days: due.days })
      : due.state === "today"
        ? tf("dueToday")
        : task.due
          ? formatDay(task.due, locale)
          : null;

  return (
    <Link
      href={{ pathname: "/followup", query: { card: String(task.cardId) } }}
      onClick={onPick}
      className={`focus-ring flex gap-3 px-4 py-3 hover:bg-surface-2 ${isNew ? "bg-action-soft/40" : ""}`}
      data-testid="task-row"
      data-key={task.key}
      data-new={isNew ? "true" : "false"}
    >
      <span className="mt-1.5 flex w-2 shrink-0 justify-center" aria-hidden="true">
        {isNew ? <span className="h-2 w-2 rounded-full bg-action" /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-start gap-1.5 text-[13.5px] font-semibold leading-snug text-ink">
          {task.source === "check" ? <ListChecks size={14} className="mt-[3px] shrink-0 text-sub" aria-label={t("checklist")} /> : null}
          <span className="line-clamp-2">{title}</span>
        </span>
        <span className="flex min-w-0 items-baseline gap-1 text-[12px] text-sub">
          <span className="shrink-0 font-semibold text-ink">{where}</span>
          {task.productName ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{task.productName}</span>
              {task.otherLines > 0 ? <span className="shrink-0 whitespace-nowrap">{tf("moreLines", { count: task.otherLines })}</span> : null}
            </>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-sub">
          <span className="font-mono">{task.orderNumber}</span>
          {dueLabel ? (
            <span className={`inline-flex items-center gap-1 ${DUE_CLASS[due.state]}`} data-testid="task-due" data-state={due.state}>
              <CalendarDays size={12} aria-hidden="true" />
              {dueLabel}
            </span>
          ) : null}
          {from ? (
            <span data-testid="task-from">
              {isNew ? <span className="font-semibold text-action-chrome">{t("new")} · </span> : null}
              {t("from", { name: from })}
              {task.assignedAt ? ` · ${formatMoment(task.assignedAt, locale)}` : ""}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}
