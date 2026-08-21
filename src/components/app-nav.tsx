import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { signOutAction } from "@/lib/actions/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Brand } from "@/components/brand";
import { NavLinks, MobileNav, type NavItem } from "@/components/nav-links";
import { HeaderSyncChip } from "@/components/offline/header-sync-chip";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export async function AppNav({
  userName,
  role,
}: {
  userName: string;
  role: "admin" | "collaborator";
}) {
  const t = await getTranslations("nav");
  const locale = await getLocale();
  const boundSignOut = signOutAction.bind(null, locale);
  const isAdmin = role === "admin";

  // The daily loop, in the order a market run runs: find a product, put it on
  // an order, look up whose booth it was, see whether it has been paid.
  // Finance, Users and Settings are admin ground; hiding them here is only
  // politeness — the pages and actions behind them check the role themselves.
  const primary: NavItem[] = [
    { href: "/catalog", label: t("catalog"), icon: "catalog" },
    { href: "/orders", label: t("orders"), icon: "orders" },
    { href: "/contacts", label: t("contacts"), icon: "contacts" },
    ...(isAdmin ? [{ href: "/finance", label: t("finance"), icon: "finance" } as NavItem] : []),
  ];
  const behindMore: NavItem[] = isAdmin
    ? [
        { href: "/users", label: t("users"), icon: "users" },
        { href: "/settings", label: t("settings"), icon: "settings" },
        { href: "/activity", label: t("activity"), icon: "activity" },
      ]
    : [];
  const tabs: NavItem[] = [...primary, { href: "/more", label: t("more"), icon: "more" }];

  return (
    <>
      {/*
        Sticky with a blur so content slides beneath it, and a brand-red top
        edge — the one place the logo colour runs the full width of the app.
      */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75 print:hidden">
        <div className="h-0.5 w-full bg-action" />
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
          <div className="flex min-w-0 items-center gap-5">
            <Link href="/catalog" className="shrink-0" aria-label="Mbarete">
              <Brand />
            </Link>
            <NavLinks items={[...primary, ...behindMore]} />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* The sync state belongs in the chrome, not in a page: it is true
                of the whole app and it is what the agent checks before
                walking out of signal. */}
            <HeaderSyncChip />
            <div className="hidden lg:block">
              <LanguageSwitcher />
            </div>
            <span className="hidden max-w-32 truncate text-[12px] text-sub lg:inline">
              {userName}
            </span>
            <form action={boundSignOut} className="hidden lg:block">
              <Button variant="ghost" size="sm" type="submit" aria-label={t("signOut")}>
                <LogOut className="h-4 w-4" strokeWidth={1.5} />
                <span className="hidden xl:inline">{t("signOut")}</span>
              </Button>
            </form>
          </div>
        </div>
      </header>

      <MobileNav items={tabs} moreItems={behindMore} />
    </>
  );
}
