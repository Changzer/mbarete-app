"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * The one floating object in the app, and only on the catalog: registering a
 * product is what an agent walking a market does between every other thing,
 * so it gets the thumb's home position rather than a row in a toolbar.
 *
 * 56px, sat above the tab bar and the safe area. It hides from `md` up, where
 * the header's own Add product button is already in reach of a mouse.
 */
export function CaptureFab() {
  const t = useTranslations("catalog");
  return (
    <Link
      href="/catalog/new"
      data-testid="capture-fab"
      aria-label={t("addProduct")}
      className="press focus-ring fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-action text-white shadow-xl active:bg-action-press print:hidden md:hidden"
    >
      <Plus className="h-6 w-6" strokeWidth={1.9} />
    </Link>
  );
}
