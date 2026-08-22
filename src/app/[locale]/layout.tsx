import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { sessionUser } from "@/lib/authz";
import { RoleProvider } from "@/components/role-provider";
import { AppNav } from "@/components/app-nav";
import { OutboxProvider } from "@/components/offline/outbox";
import { SwRegister } from "@/components/offline/sw-register";
import { ToastProvider } from "@/components/ui/toast";
import { themeBootScript } from "@/components/theme-toggle";
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
  // Role comes from the database, not the JWT, so demotions apply immediately.
  const user = session?.user ? await sessionUser() : null;

  return (
    <html lang={locale} className="h-full antialiased">
      <head>
        {/* Ahead of hydration, so an agent who chose dark never gets a white
            flash on the way into the app. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-ink">
        <SwRegister />
        <NextIntlClientProvider messages={messages}>
          {/* The outbox mounts only for signed-in views: it delivers captures
              with the session cookie, and the login page has nothing to send.
              It lives in the layout so queued captures keep draining wherever
              in the app the agent happens to be when the signal returns. */}
          {session?.user ? (
            <OutboxProvider storageScope={`${user!.companyId}:${user!.id}`}>
              <ToastProvider>
               <RoleProvider role={user?.role ?? "collaborator"}>
                <AppNav userName={session.user.name ?? ""} role={user?.role ?? "collaborator"} />
                {/* Room below for the tab bar plus the phone's safe area — the
                    bar is fixed, so the last row of any list would otherwise
                    sit under it. */}
                <main className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
                  {children}
                </main>
               </RoleProvider>
              </ToastProvider>
            </OutboxProvider>
          ) : (
            <main className="flex-1">{children}</main>
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
