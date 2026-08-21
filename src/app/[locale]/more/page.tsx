import { getTranslations, getLocale } from "next-intl/server";
import { ChevronRight, LogOut, Settings, UserCog } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { signOutAction } from "@/lib/actions/auth";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { MoreLanguageRow } from "@/components/more-language-row";
import { Button } from "@/components/ui/button";

/**
 * The fifth tab: everything that is not the daily loop.
 *
 * Users and Settings moved here so the tab bar could stay at five, and the
 * two controls that had been hiding in the desktop header — language and now
 * appearance — moved here too, because on a phone that header has room for
 * neither.
 */
export default async function MorePage() {
  const t = await getTranslations("more");
  const nav = await getTranslations("nav");
  const locale = await getLocale();
  const session = await auth();
  const boundSignOut = signOutAction.bind(null, locale);

  const links = [
    { href: "/users" as const, label: nav("users"), Icon: UserCog },
    { href: "/settings" as const, label: nav("settings"), Icon: Settings },
  ];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-5">
      <div className="flex items-center gap-3">
        <Brand />
        <div className="min-w-0">
          <h1 className="truncate text-[23px] font-extrabold tracking-tight text-ink">
            {session?.user?.name ?? nav("appName")}
          </h1>
          <p className="truncate text-[11px] text-sub">{session?.user?.email ?? ""}</p>
        </div>
      </div>

      <nav className="overflow-hidden rounded-[12px] border border-line bg-surface">
        {links.map(({ href, label, Icon }, i) => (
          <Link
            key={href}
            href={href}
            data-testid={`more-${href.slice(1)}`}
            className={`focus-ring flex min-h-14 items-center gap-3 px-4 text-[13.5px] font-semibold text-ink hover:bg-surface-2 ${
              i > 0 ? "border-t border-line" : ""
            }`}
          >
            <Icon className="h-[18px] w-[18px] text-sub" strokeWidth={1.5} />
            <span className="flex-1">{label}</span>
            <ChevronRight className="h-4 w-4 text-faint" strokeWidth={1.5} />
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4">
        <h2 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-sub">
          {t("language")}
        </h2>
        <MoreLanguageRow />
      </section>

      <section className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4">
        <h2 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-sub">
          {t("theme")}
        </h2>
        <ThemeToggle />
        <p className="text-[11px] leading-relaxed text-sub">{t("themeHint")}</p>
      </section>

      <form action={boundSignOut}>
        <Button variant="destructive" type="submit" className="w-full">
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
          {nav("signOut")}
        </Button>
      </form>
    </div>
  );
}
