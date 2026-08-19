import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { signOutAction } from "@/lib/actions/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Brand } from "@/components/brand";
import { NavLinks, MobileNav, type NavItem } from "@/components/nav-links";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export async function AppNav({ userName }: { userName: string }) {
  const t = await getTranslations("nav");
  const locale = await getLocale();
  const boundSignOut = signOutAction.bind(null, locale);

  const items: NavItem[] = [
    { href: "/catalog", label: t("catalog"), icon: "catalog" },
    { href: "/orders", label: t("orders"), icon: "orders" },
    { href: "/contacts", label: t("contacts"), icon: "contacts" },
    { href: "/finance", label: t("finance"), icon: "finance" },
    { href: "/users", label: t("users"), icon: "users" },
    { href: "/settings", label: t("settings"), icon: "settings" },
  ];

  return (
    <>
      {/*
        Sticky with a blur so content slides beneath it, and a brand-red top
        edge — the one place the logo colour runs the full width of the app.
      */}
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75 dark:border-neutral-800 dark:bg-neutral-950/90 dark:supports-[backdrop-filter]:bg-neutral-950/75">
        <div className="h-0.5 w-full bg-brand-600" />
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-5">
            <Link href="/catalog" className="shrink-0" aria-label="Mbarete">
              <Brand />
            </Link>
            <NavLinks items={items} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageSwitcher />
            <span className="hidden max-w-32 truncate text-sm text-neutral-500 dark:text-neutral-400 sm:inline">
              {userName}
            </span>
            <form action={boundSignOut}>
              <Button variant="ghost" size="sm" type="submit" aria-label={t("signOut")}>
                <LogOut className="h-4 w-4" />
                <span className="hidden lg:inline">{t("signOut")}</span>
              </Button>
            </form>
          </div>
        </div>
      </header>

      <MobileNav items={items} />
    </>
  );
}
