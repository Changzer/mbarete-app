"use client";

import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveErrorKey } from "./submit-checks";

/** The end of the form: whether the product is live, what the last save said, and Save. */
export function FormFooter({
  defaultActive,
  errorMessage,
  offlineSaved,
  pendingCount,
  isPending,
  submitLabel,
  showAddAnother,
}: {
  defaultActive?: boolean;
  /** The last save's error code, if it failed. */
  errorMessage?: string;
  /** "saved": captured on the phone. "store-failed": the phone refused to keep it. */
  offlineSaved: null | "saved" | "store-failed";
  /** Captures waiting on the phone, for the "saved" line. */
  pendingCount?: number;
  isPending: boolean;
  submitLabel: string;
  showAddAnother: boolean;
}) {
  const t = useTranslations("catalog");

  return (
    <>
      <label className="flex min-h-11 items-center gap-2.5 text-[13px] font-semibold text-ink lg:col-span-2">
        <input
          id="active"
          name="active"
          type="checkbox"
          defaultChecked={defaultActive ?? true}
          className="h-5 w-5 accent-[var(--mb-action)]"
        />
        {t("active")}
      </label>

      {errorMessage ? (
        <p className="text-[13px] font-semibold text-danger lg:col-span-2" data-testid="form-error">
          {t(saveErrorKey(errorMessage))}
        </p>
      ) : null}

      {/* After a local save the words are "saved" and "waiting" — never an
          error. Nothing has been lost; it is simply still on the phone. */}
      {offlineSaved === "saved" ? (
        <p
          className="flex items-center gap-2 rounded-[10px] bg-ok-soft px-3 py-2.5 text-[13px] font-semibold text-ok lg:col-span-2"
          data-testid="saved-offline"
        >
          <Check className="h-4 w-4 shrink-0" strokeWidth={1.5} />
          {t("savedOffline", { count: pendingCount ?? 1 })}
        </p>
      ) : null}
      {offlineSaved === "store-failed" ? (
        <p className="text-[13px] font-semibold text-danger lg:col-span-2" data-testid="offline-store-failed">
          {t("offlineStoreFailed")}
        </p>
      ) : null}

      {/*
        Pinned above the tab bar on a phone so saving never means scrolling
        back down a long form, and a normal row once there is room. Fixed
        rather than sticky: as the form's last child it has nothing left to
        stick within, so `sticky` would just sit off-screen at the end.
      */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 flex flex-col gap-2 border-t border-line bg-surface px-4 py-3 lg:static lg:z-auto lg:col-span-2 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
        <div className="flex gap-2">
          <Button type="submit" disabled={isPending} data-testid="save-product" className="flex-1 lg:flex-none">
            {isPending ? <Loader2 className="animate-spin" /> : null}
            {submitLabel}
          </Button>
          {showAddAnother ? (
            <Button
              type="submit"
              name="andAnother"
              value="1"
              variant="outline"
              disabled={isPending}
              data-testid="save-and-add-another"
              className="flex-1 lg:flex-none"
            >
              {t("saveAndAddAnother")}
            </Button>
          ) : null}
        </div>
        {/* The one line that makes a market aisle bearable: it is already safe. */}
        <p className="text-[11px] leading-snug text-sub lg:hidden">{t("saveReassurance")}</p>
      </div>
    </>
  );
}
