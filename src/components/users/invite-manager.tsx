"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createInvite, revokeInvite } from "@/lib/actions/invites";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export type PendingInvite = {
  id: number;
  role: "admin" | "collaborator";
  createdAt: string;
  expiresAt: string;
  createdByName: string | null;
};

/**
 * Mint and manage invite links. The raw token appears exactly once — in the
 * create response — so the freshly made link is shown here for copying and
 * can never be recovered later; a lost link is revoked and re-made.
 */
export function InviteManager({ invites }: { invites: PendingInvite[] }) {
  const t = useTranslations("users");
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mint(role: "admin" | "collaborator") {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await createInvite(role);
      if (res.path) {
        setFreshLink(`${window.location.origin}${res.path}`);
      } else {
        setError(res.error === "limit" ? t("inviteSeatLimit") : t("inviteFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!freshLink) return;
    try {
      await navigator.clipboard.writeText(freshLink);
      setCopied(true);
    } catch {
      // Clipboard blocked (http on LAN): the link is selectable below.
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">{t("invitesTitle")}</span>
          <span className="text-xs text-sub">{t("invitesHelp")}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => mint("collaborator")}>
            {t("inviteCollaborator")}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => mint("admin")}>
            {t("inviteAdmin")}
          </Button>
        </div>
        {freshLink ? (
          <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3">
            <p className="text-xs text-sub">{t("inviteFreshHelp")}</p>
            <code className="break-all text-xs text-ink" data-testid="fresh-invite-link">
              {freshLink}
            </code>
            <div>
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? t("inviteCopied") : t("inviteCopy")}
              </Button>
            </div>
          </div>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {invites.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {invite.role === "admin" ? t("roleAdmin") : t("roleCollaborator")}
                  </Badge>
                  <span className="text-sub">
                    {t("inviteMeta", {
                      by: invite.createdByName ?? "—",
                      expires: invite.expiresAt.slice(0, 10),
                    })}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    await revokeInvite(invite.id);
                  }}
                >
                  {t("inviteRevoke")}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
