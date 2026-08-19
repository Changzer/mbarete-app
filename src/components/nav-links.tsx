"use client";

import { Link, usePathname } from "@/i18n/navigation";
import {
  LayoutGrid,
  ClipboardList,
  Users,
  LineChart,
  UserCog,
  Settings,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: "catalog" | "orders" | "contacts" | "finance" | "users" | "settings";
};

const ICONS = {
  catalog: LayoutGrid,
  orders: ClipboardList,
  contacts: Users,
  finance: LineChart,
  users: UserCog,
  settings: Settings,
} as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop links: text with a brand underline riding under the active page. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 text-sm font-medium md:flex">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative rounded-md px-3 py-1.5 transition-colors ${
              active
                ? "text-brand-600 dark:text-brand-400"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            }`}
          >
            {item.label}
            {active ? (
              <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-brand-600 dark:bg-brand-500" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Phone navigation: a fixed bottom tab bar, where thumbs actually are.
 * The top header keeps only the brand and session controls on small screens.
 */
export function MobileNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      data-testid="mobile-nav"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-between">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[10px] font-medium ${
                active
                  ? "text-brand-600 dark:text-brand-400"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "stroke-[2.25]" : ""}`} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
