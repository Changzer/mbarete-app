"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createUser,
  updateUser,
  setUserActive,
  setUserRole,
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
  role: "admin" | "collaborator";
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
      case "self-demote":
        return t("errorSelfDemote");
      case "last-admin":
        return t("errorLastAdmin");
      case "last-user":
        return t("errorLastUser");
      case "owner-locked":
        return t("errorOwnerLocked");
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-role">{t("role")}</Label>
            <select
              id="new-role"
              name="role"
              defaultValue="collaborator"
              className="flex h-9 rounded-md border border-line bg-surface px-2 text-sm"
            >
              <option value="collaborator">{t("roleCollaborator")}</option>
              <option value="admin">{t("roleAdmin")}</option>
            </select>
          </div>
          <Button type="submit" disabled={isPending}>
            {t("addUser")}
          </Button>
        </form>
        <p className="mt-2 text-xs text-sub">
          {t("passwordHelp")}
        </p>
        {message ? (
          <p className="mt-2 text-sm text-danger">{message}</p>
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
            <p className="text-sm text-danger">{message}</p>
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
  ownerUserId,
}: {
  users: TeamUser[];
  currentUserId: number;
  ownerUserId: number | null;
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

  async function changeRole(user: TeamUser, role: "admin" | "collaborator") {
    setActionError(null);
    const res = await setUserRole(user.id, role);
    setActionError(errorText(res));
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-sub">{t("help")}</p>

      <AddUserForm />

      {actionError ? (
        <p className="text-sm text-danger">{actionError}</p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2 text-left text-sub">
            <tr>
              <th className="px-4 py-2 font-medium">{t("name")}</th>
              <th className="px-4 py-2 font-medium">{t("email")}</th>
              <th className="px-4 py-2 font-medium">{t("role")}</th>
              <th className="px-4 py-2 font-medium">{t("status")}</th>
              <th className="px-4 py-2 font-medium">{common("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isOwner = user.id === ownerUserId;
              return (
              <tr
                key={user.id}
                data-testid={`user-row-${user.id}`}
                className="border-b border-line last:border-0"
              >
                <td className="px-4 py-2 font-medium text-ink">
                  {user.name}
                  {user.id === currentUserId ? (
                    <span className="ml-2 text-xs font-normal text-sub">
                      {t("you")}
                    </span>
                  ) : null}
                  {isOwner ? (
                    <span className="ml-2 text-xs font-normal text-sub">
                      {t("ownerTag")}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-sub">
                  {user.email}
                </td>
                <td className="px-4 py-2">
                  {user.id === currentUserId || isOwner ? (
                    // Demoting yourself, or the owner, would strand the company —
                    // the server refuses it, so don't offer it.
                    <Badge variant="secondary">{t("roleAdmin")}</Badge>
                  ) : (
                    <select
                      value={user.role}
                      data-testid={`user-role-${user.id}`}
                      onChange={(e) =>
                        changeRole(user, e.target.value as "admin" | "collaborator")
                      }
                      className="flex h-8 rounded-md border border-line bg-surface px-2 text-sm"
                    >
                      <option value="collaborator">{t("roleCollaborator")}</option>
                      <option value="admin">{t("roleAdmin")}</option>
                    </select>
                  )}
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
                      disabled={user.active && (user.id === currentUserId || isOwner)}
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
