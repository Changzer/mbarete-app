import { getTranslations, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { signOutAction } from "@/lib/actions/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";

export async function AppNav({ userName }: { userName: string }) {
  const t = await getTranslations("nav");
  const locale = await getLocale();
  const boundSignOut = signOutAction.bind(null, locale);

  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {t("appName")}
          </span>
          <nav className="flex items-center gap-4 text-sm font-medium text-neutral-600 dark:text-neutral-400">
            <Link href="/catalog" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              {t("catalog")}
            </Link>
            <Link href="/orders" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              {t("orders")}
            </Link>
            <Link href="/contacts" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              {t("contacts")}
            </Link>
            <Link href="/finance" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              {t("finance")}
            </Link>
            <Link href="/users" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              {t("users")}
            </Link>
            <Link href="/settings" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              {t("settings")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <span className="hidden text-sm text-neutral-500 dark:text-neutral-400 sm:inline">
            {userName}
          </span>
          <form action={boundSignOut}>
            <Button variant="ghost" size="sm" type="submit">
              {t("signOut")}
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
