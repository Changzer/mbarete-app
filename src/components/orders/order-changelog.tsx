import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { orderEvents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getUserNames } from "@/lib/queries/users";
import type { OrderChange } from "@/lib/order-log";
import {
  History,
  Pencil,
  ArrowRightLeft,
  BanknoteArrowDown,
  BanknoteArrowUp,
  Receipt,
  FileUp,
  FileX,
  PlusCircle,
} from "lucide-react";

/**
 * The order's history, rendered from structured events in the reader's
 * language. Events store what happened; every sentence here is composed at
 * render time, so the same log reads correctly in English and Chinese.
 */

type T = Awaited<ReturnType<typeof getTranslations<"orderLog">>>;
type FinT = Awaited<ReturnType<typeof getTranslations<"finance">>>;

function describeChange(change: OrderChange, t: T): string {
  switch (change.code) {
    case "client":
      return t("changeClient", { from: change.from, to: change.to });
    case "commission":
      return t("changeCommission", { from: change.from, to: change.to });
    case "currency":
      return t("changeCurrency", { from: change.from, to: change.to });
    case "notes":
      return t("changeNotes");
    case "bank":
      return t("changeBank", { from: change.from, to: change.to });
    case "line_added":
      return t("changeLineAdded", { sku: change.sku, qty: change.qty });
    case "line_removed":
      return t("changeLineRemoved", { sku: change.sku });
    case "line_qty":
      return t("changeLineQty", { sku: change.sku, from: change.from, to: change.to });
    case "line_price":
      return t("changeLinePrice", {
        sku: change.sku,
        from: change.from.toFixed(2),
        to: change.to.toFixed(2),
      });
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function describe(kind: string, payload: any, t: T, finT: FinT): string {
  switch (kind) {
    case "created":
      return t("created");
    case "status":
      return t("statusChanged", {
        from: t(`status_${payload.from}` as "status_draft"),
        to: t(`status_${payload.to}` as "status_draft"),
      });
    case "payment_added":
      return payload.direction === "in"
        ? t("paymentInAdded", { amount: Number(payload.amount).toFixed(2), currency: payload.currency })
        : t("paymentOutAdded", { amount: Number(payload.amount).toFixed(2), currency: payload.currency });
    case "payment_removed":
      return t("paymentRemoved", { amount: Number(payload.amount).toFixed(2), currency: payload.currency });
    case "expense_added":
      return t("expenseAdded", {
        category: finT(`category_${payload.category}` as "category_other"),
        amount: Number(payload.amount).toFixed(2),
        currency: payload.currency,
      });
    case "expense_removed":
      return t("expenseRemoved", {
        category: finT(`category_${payload.category}` as "category_other"),
        amount: Number(payload.amount).toFixed(2),
        currency: payload.currency,
      });
    case "document_added":
      return t("documentAdded", { name: payload.name });
    case "document_removed":
      return t("documentRemoved", { name: payload.name });
    default:
      return kind;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const ICONS: Record<string, typeof History> = {
  created: PlusCircle,
  edited: Pencil,
  status: ArrowRightLeft,
  payment_added: BanknoteArrowDown,
  payment_removed: BanknoteArrowUp,
  expense_added: Receipt,
  expense_removed: Receipt,
  document_added: FileUp,
  document_removed: FileX,
};

/** SQLite's current_timestamp is UTC without a zone marker; pin it before formatting. */
function formatWhen(sqliteTimestamp: string, locale: string) {
  const date = new Date(sqliteTimestamp.replace(" ", "T") + "Z");
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export async function OrderChangelog({ orderId, locale }: { orderId: number; locale: string }) {
  const t = await getTranslations("orderLog");
  const finT = await getTranslations("finance");

  const [events, userNames] = await Promise.all([
    db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(desc(orderEvents.createdAt), desc(orderEvents.id))
      .all(),
    getUserNames(),
  ]);

  return (
    <div
      className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      data-testid="section-changelog"
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        <History className="h-4 w-4 text-brand-600 dark:text-brand-400" />
        {t("title")}
      </h2>

      {events.length === 0 ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("empty")}</p>
      ) : (
        <ol className="relative flex flex-col gap-4 border-l border-neutral-200 pl-5 dark:border-neutral-800">
          {events.map((event) => {
            let payload: unknown = {};
            try {
              payload = JSON.parse(event.payload);
            } catch {
              payload = {};
            }
            const Icon = ICONS[event.kind] ?? History;
            const who = event.userId ? userNames.get(event.userId) ?? "—" : "—";
            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            const changes: OrderChange[] = (payload as any)?.changes ?? [];

            return (
              <li key={event.id} className="relative text-sm">
                <span className="absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-4 ring-white dark:bg-neutral-900 dark:ring-neutral-900">
                  <Icon className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500" />
                </span>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">{who}</span>
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">
                    {formatWhen(event.createdAt, locale)}
                  </span>
                </div>
                <p className="text-neutral-600 dark:text-neutral-300">
                  {event.kind === "edited" ? t("edited") : describe(event.kind, payload, t, finT)}
                </p>
                {changes.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    {changes.map((change, i) => (
                      <li key={i}>· {describeChange(change, t)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
