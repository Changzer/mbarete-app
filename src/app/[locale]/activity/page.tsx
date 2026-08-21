import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { db } from "@/db";
import { entityEvents } from "@/db/schema";
import { desc } from "drizzle-orm";
import { sessionUser } from "@/lib/authz";
import { getUserNames } from "@/lib/queries/users";
import type { FieldChange } from "@/lib/entity-log";
import { History, PlusCircle, Pencil, Trash2 } from "lucide-react";

/**
 * The team's recent work on products and contacts, newest first — the
 * companion to each order's own changelog. This page exists so an admin can
 * answer "who blanked that supplier's bank details?" without asking around.
 */

const ICONS = {
  created: PlusCircle,
  edited: Pencil,
  deleted: Trash2,
} as const;

/** SQLite's current_timestamp is UTC without a zone marker; pin it before formatting. */
function formatWhen(sqliteTimestamp: string, locale: string) {
  const date = new Date(sqliteTimestamp.replace(" ", "T") + "Z");
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type T = Awaited<ReturnType<typeof getTranslations<"activity">>>;

function describeChange(change: FieldChange, t: T): string {
  // Toggles read as their own sentences, not as a field with values.
  if (change.field === "activated") return t("changeActivated");
  if (change.field === "deactivated") return t("changeDeactivated");

  const label = t(`field_${change.field}` as "field_phone");
  if (change.from === undefined && change.to === undefined) {
    return t("changeNoValues", { field: label });
  }
  return t("changeValues", {
    field: label,
    from: change.from?.trim() ? change.from : "—",
    to: change.to?.trim() ? change.to : "—",
  });
}

export default async function ActivityPage() {
  const user = await sessionUser();
  if (user?.role !== "admin") {
    redirect({ href: "/catalog", locale: await getLocale() });
  }

  const t = await getTranslations("activity");
  const locale = await getLocale();

  const [events, userNames] = await Promise.all([
    db
      .select()
      .from(entityEvents)
      .orderBy(desc(entityEvents.createdAt), desc(entityEvents.id))
      .limit(200)
      .all(),
    getUserNames(),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-2 flex items-center gap-2 text-[23px] font-extrabold tracking-tight text-ink">
        <History className="h-5 w-5 text-action-chrome" />
        {t("title")}
      </h1>
      <p className="mb-6 text-sm text-sub">{t("help")}</p>

      {events.length === 0 ? (
        <p className="text-sm text-sub">{t("empty")}</p>
      ) : (
        <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
          {events.map((event) => {
            let payload: { name?: string; changes?: FieldChange[] } = {};
            try {
              payload = JSON.parse(event.payload);
            } catch {
              payload = {};
            }
            const Icon = ICONS[event.kind] ?? History;
            const who = event.userId ? (userNames.get(event.userId) ?? "—") : "—";
            const changes = payload.changes ?? [];
            const sentenceKey = `${event.kind}_${event.entity}` as "created_product";

            return (
              <li key={event.id} className="relative text-sm" data-testid="activity-event">
                <span className="absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface">
                  <Icon className="h-3.5 w-3.5 text-faint" />
                </span>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-ink">{who}</span>
                  <span className="text-xs text-faint">
                    {formatWhen(event.createdAt, locale)}
                  </span>
                </div>
                <p className="text-sub">{t(sentenceKey, { name: payload.name ?? "—" })}</p>
                {changes.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-sub">
                    {changes.map((change, i) => (
                      <li key={i}>• {describeChange(change, t)}</li>
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
