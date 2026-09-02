import { getTranslations } from "next-intl/server";
import type { AdminEventRow } from "@/lib/admin-events";

/** The company's admin trail, under the team list. Admin eyes only, like the page. */
export async function AdminActivity({ events }: { events: AdminEventRow[] }) {
  const t = await getTranslations("users");
  return (
    <section
      className="rounded-lg border border-line bg-surface p-4"
      data-testid="admin-activity"
    >
      <h2 className="text-sm font-semibold text-ink">{t("activityTitle")}</h2>
      <p className="mt-1 text-xs text-sub">{t("activityHelp")}</p>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-sub">{t("activityEmpty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
              <span className="whitespace-nowrap text-xs tabular-nums text-faint">
                {e.createdAt.slice(0, 16)}
              </span>
              <span className="text-ink">
                <span className="font-medium">{e.actorName ?? "—"}</span>{" "}
                {t(`action_${e.action}`)}
                {e.targetName ? (
                  <>
                    {" "}
                    <span className="font-medium">{e.targetName}</span>
                  </>
                ) : null}
              </span>
              {e.detail ? <span className="text-xs text-sub">{e.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
