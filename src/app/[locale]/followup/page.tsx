import { getLocale } from "next-intl/server";
import { requireUser, requireModulePage } from "@/lib/authz";
import { getFollowupBoard } from "@/lib/followup-server";
import { FollowupBoard } from "@/components/followup/followup-board";
import type { Locale } from "@/i18n/routing";

/**
 * 跟单: every confirmed order's suppliers as cards moving through production,
 * and every shipped order's export paperwork. Lives with the orders module.
 */
export default async function FollowupPage() {
  const user = await requireUser();
  await requireModulePage(user, "orders");
  const locale = (await getLocale()) as Locale;
  const board = await getFollowupBoard(user.companyId, locale);
  // The business runs on Yiwu's calendar; the browser corrects it after load.
  const serverToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  return (
    <FollowupBoard
      board={board}
      currentUserId={user.id}
      isAdmin={user.role === "admin"}
      serverToday={serverToday}
    />
  );
}
