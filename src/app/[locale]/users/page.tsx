import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { UserManager, type TeamUser } from "@/components/users/user-manager";

export default async function UsersPage() {
  const t = await getTranslations("users");
  const session = await auth();

  const rows = await db.select().from(users).orderBy(asc(users.name)).all();
  const teamUsers: TeamUser[] = rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    active: u.active,
    createdAt: u.createdAt,
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        {t("title")}
      </h1>
      <UserManager
        users={teamUsers}
        currentUserId={Number(session?.user?.id ?? 0)}
      />
    </div>
  );
}
