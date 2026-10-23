import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireUser } from "@/lib/authz";
import { db, one } from "@/db";
import { users, companies } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { UserManager, type TeamUser } from "@/components/users/user-manager";
import { InviteManager } from "@/components/users/invite-manager";
import { pendingInvites } from "@/lib/queries/users";
import { recentAdminEvents } from "@/lib/admin-events";
import { AdminActivity } from "@/components/users/admin-activity";
import { AssistantManager } from "@/components/users/assistant-manager";
import { listAssistants } from "@/lib/queries/assistants";

export default async function UsersPage() {
  // requireUser (not sessionUser) so a dead session lands on login, not on a
  // catalog page that then refuses it; the role check keeps collaborators out.
  const current = await requireUser();
  if (current.role !== "admin") {
    redirect({ href: "/catalog", locale: await getLocale() });
  }

  const t = await getTranslations("users");
  const session = await auth();

  const company = await db
    .select({ ownerUserId: companies.ownerUserId })
    .from(companies)
    .where(eq(companies.id, current.companyId))
    .limit(1)
    .then(one);

  // People only; assistant accounts have their own section below.
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.companyId, current.companyId), eq(users.kind, "person")))
    .orderBy(asc(users.name));
  const teamUsers: TeamUser[] = rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    emailVerified: Boolean(u.emailVerifiedAt),
    createdAt: u.createdAt,
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-6 text-[23px] font-extrabold tracking-tight text-ink">
        {t("title")}
      </h1>
      <div className="mb-6">
        <InviteManager invites={await pendingInvites(current.companyId)} />
      </div>
      <UserManager
        users={teamUsers}
        currentUserId={Number(session?.user?.id ?? 0)}
        ownerUserId={company?.ownerUserId ?? null}
      />
      <div className="mt-6">
        <AssistantManager assistants={await listAssistants(current.companyId)} />
      </div>
      <div className="mt-6">
        <AdminActivity events={await recentAdminEvents(current.companyId)} />
      </div>
    </div>
  );
}
