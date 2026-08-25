"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The company's referral link, ready to paste into a WeChat chat. The code
 * was minted server-side by the settings page; this card only composes the
 * absolute URL (origin is a browser fact) and copies it.
 */
export function ReferralCard({ code, joined }: { code: string; joined: number }) {
  const t = useTranslations("company");
  const [copied, setCopied] = useState(false);

  const link = () => `${window.location.origin}/signup?ref=${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be denied over plain HTTP; the visible code still works.
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-sm text-sub">{t("referralHelp")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code
            className="rounded-[10px] border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink"
            data-testid="referral-code"
          >
            /signup?ref={code}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={copy} data-testid="copy-referral">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t("referralCopied") : t("referralCopy")}
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-sub" data-testid="referral-joined">
          <UsersRound className="h-3.5 w-3.5" />
          {t("referralJoined", { count: joined })}
        </p>
      </CardContent>
    </Card>
  );
}
