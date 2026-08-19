import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import "../globals.css";

export const metadata: Metadata = {
  title: "Mbarete",
  description: "Mbarete internal sourcing & procurement tool",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }
  setRequestLocale(locale as Locale);

  const messages = await getMessages();
  const session = await auth();

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-50 dark:bg-neutral-950">
        <NextIntlClientProvider messages={messages}>
          {session?.user ? <AppNav userName={session.user.name ?? ""} /> : null}
          <main className={session?.user ? "flex-1 pb-20 md:pb-0" : "flex-1"}>
            {children}
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
