"use client";

import { Link, usePathname } from "@/i18n/navigation";
import {
  LayoutGrid,
  ClipboardList,
  Users,
  LineChart,
  UserCog,
  Settings,
  History,
  MoreHorizontal,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: "catalog" | "orders" | "contacts" | "finance" | "users" | "settings" | "activity" | "more";
};

const ICONS = {
  catalog: LayoutGrid,
  orders: ClipboardList,
  contacts: Users,
  finance: LineChart,
  users: UserCog,
  settings: Settings,
  activity: History,
  more: MoreHorizontal,
} as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * More owns the pages that are not part of the daily loop, so the tab bar can
 * stay at five: whichever of them the agent is on, the More tab is the one lit.
 */
function moreIsActive(pathname: string, items: NavItem[]) {
  return items.some((item) => isActive(pathname, item.href));
}

/** Desktop links: text with a brand underline riding under the active page. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 text-[13px] font-semibold lg:flex">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`focus-ring relative rounded-[10px] px-3 py-2 transition-colors ${
              active
                ? "text-action-chrome"
                : "text-sub hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {item.label}
            {active ? (
              <span className="absolute inset-x-3 -bottom-[11px] h-0.5 rounded-full bg-action" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Phone and tablet-portrait navigation: a fixed bottom tab bar, where thumbs
 * actually are. Five tabs is the ceiling at 360px — Users and Settings live
 * behind More rather than shrinking every label to fit.
 */
export function MobileNav({
  items,
  moreItems,
}: {
  items: NavItem[];
  /** The pages behind More — used only to decide whether More reads as active. */
  moreItems: NavItem[];
}) {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur print:hidden lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      data-testid="mobile-nav"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-between">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active =
            item.icon === "more"
              ? isActive(pathname, item.href) || moreIsActive(pathname, moreItems)
              : isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              data-testid={`nav-${item.icon}`}
              // min-h-14 keeps every tab a 56px target even where the label is
              // a single narrow glyph.
              className={`focus-ring flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 pb-1 pt-1.5 text-[10px] font-semibold ${
                active ? "text-action-chrome" : "text-sub"
              }`}
            >
              <Icon
                className="h-[19px] w-[19px]"
                strokeWidth={active ? 1.9 : 1.5}
              />
              <span className="w-full truncate text-center">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
