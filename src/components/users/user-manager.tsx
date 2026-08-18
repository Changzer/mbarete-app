"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createUser,
  updateUser,
  setUserActive,
  type UserActionResult,
} from "@/lib/actions/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export type TeamUser = {
  id: number;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
};

/** Server-side failures are codes; the wording lives in the message catalogs. */
function useErrorText() {
  const t = useTranslations("users");
  return (result: UserActionResult | undefined) => {
    if (!result?.error) return null;
    switch (result.error) {
      case "duplicate-email":
        return t("errorDuplicateEmail");
      case "self-deactivate":
        return t("errorSelfDeactivate");
      case "last-user":
        return t("errorLastUser");
      case "not-found":
        return t("errorNotFound");
      default:
        return t("errorInvalid");
    }
  };
}

function AddUserForm() {
  const t = useTranslations("users");
  const [result, formAction, isPending] = useActionState(createUser, undefined);
  const errorText = useErrorText();
  const message = errorText(result);

  return (
    <Card>
      <CardContent className="p-4">
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-name">{t("name")}</Label>
            <Input id="new-name" name="name" className="w-48" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-email">{t("email")}</Label>
            <Input
              id="new-email"
              name="email"
              type="email"
              className="w-64"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">{t("password")}</Label>
            <Input
              id="new-password"
              name="password"
              type="password"
              minLength={8}
              className="w-48"
              required
            />
          </div>
          <Button type="submit" disabled={isPending}>
            {t("addUser")}
          </Button>
        </form>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          {t("passwordHelp")}
        </p>
        {message ? (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{message}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EditUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: TeamUser;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const t = useTranslations("users");
  const common = useTranslations("common");
  const errorText = useErrorText();

  async function action(prev: UserActionResult | undefined, formData: FormData) {
    const res = await updateUser(user.id, prev, formData);
    if (!res.error) onOpenChange(false);
    return res;
  }

  const [result, formAction, isPending] = useActionState(action, undefined);
  const message = errorText(result);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editUser")}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`name-${user.id}`}>{t("name")}</Label>
            <Input id={`name-${user.id}`} name="name" defaultValue={user.name} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`email-${user.id}`}>{t("email")}</Label>
            <Input
              id={`email-${user.id}`}
              name="email"
              type="email"
              defaultValue={user.email}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`password-${user.id}`}>{t("newPassword")}</Label>
            <Input
              id={`password-${user.id}`}
              name="password"
              type="password"
              minLength={8}
              placeholder={t("leaveBlankToKeep")}
            />
          </div>
          {message ? (
            <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
          ) : null}
          <Button type="submit" disabled={isPending}>
            {common("save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UserManager({
  users,
  currentUserId,
}: {
  users: TeamUser[];
  currentUserId: number;
}) {
  const t = useTranslations("users");
  const common = useTranslations("common");
  const errorText = useErrorText();
  const [editing, setEditing] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggleActive(user: TeamUser) {
    setActionError(null);
    if (user.active && !confirm(t("deactivateConfirm", { name: user.name }))) return;
    const res = await setUserActive(user.id, !user.active);
    setActionError(errorText(res));
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("help")}</p>

      <AddUserForm />

      {actionError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
            <tr>
              <th className="px-4 py-2 font-medium">{t("name")}</th>
              <th className="px-4 py-2 font-medium">{t("email")}</th>
              <th className="px-4 py-2 font-medium">{t("status")}</th>
              <th className="px-4 py-2 font-medium">{common("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                data-testid={`user-row-${user.id}`}
                className="border-b border-neutral-100 dark:border-neutral-800 last:border-0"
              >
                <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">
                  {user.name}
                  {user.id === currentUserId ? (
                    <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                      {t("you")}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">
                  {user.email}
                </td>
                <td className="px-4 py-2">
                  <Badge variant={user.active ? "success" : "secondary"}>
                    {user.active ? t("statusActive") : t("statusInactive")}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(user.id)}
                    >
                      {common("edit")}
                    </Button>
                    <Button
                      variant={user.active ? "destructive" : "outline"}
                      size="sm"
                      disabled={user.active && user.id === currentUserId}
                      onClick={() => toggleActive(user)}
                    >
                      {user.active ? t("deactivate") : t("reactivate")}
                    </Button>
                  </div>
                  {editing === user.id ? (
                    <EditUserDialog
                      user={user}
                      open
                      onOpenChange={(next) => setEditing(next ? user.id : null)}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
