import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { OutboxProvider } from "@/components/offline/outbox";
import { OutboxStatus } from "@/components/offline/outbox-status";
import { SwRegister } from "@/components/offline/sw-register";
import "../globals.css";

export const metadata: Metadata = {
  title: "Mbarete",
  description: "Mbarete internal sourcing & procurement tool",
  // Home-screen installs: the manifest carries the icons and colors; the
  // apple entries cover iOS, which reads its own tags.
  appleWebApp: { capable: true, title: "Mbarete" },
  icons: { apple: "/icon-192.png" },
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
        <SwRegister />
        <NextIntlClientProvider messages={messages}>
          {/* The outbox mounts only for signed-in views: it delivers captures
              with the session cookie, and the login page has nothing to send.
              It lives in the layout so queued captures keep draining wherever
              in the app the agent happens to be when the signal returns. */}
          {session?.user ? (
            <OutboxProvider>
              <AppNav userName={session.user.name ?? ""} />
              <main className="flex-1 pb-20 md:pb-0">{children}</main>
              <OutboxStatus />
            </OutboxProvider>
          ) : (
            <main className="flex-1">{children}</main>
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
