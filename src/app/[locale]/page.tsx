import fs from "node:fs";
import path from "node:path";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PlayCircle } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Brand } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { HeroCarousel } from "@/components/landing/hero-carousel";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { Button } from "@/components/ui/button";

/**
 * Marketing assets are plain files, committed when they're ready:
 *   public/landing/slides/*.jpg|png|webp  → carousel slides (sorted by name)
 *   public/landing/demo.mp4 (+ demo-poster.jpg) → the demo video
 * Until then the carousel shows built-in feature panels and the video row
 * shows a "coming soon" frame — the page never renders a broken player.
 */
function landingAssets() {
  const dir = path.join(process.cwd(), "public", "landing");
  let slides: string[] = [];
  try {
    slides = fs
      .readdirSync(path.join(dir, "slides"))
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort()
      .map((f) => `/landing/slides/${f}`);
  } catch {
    // No folder yet — fall back to the built-in panels.
  }
  const hasVideo = fs.existsSync(path.join(dir, "demo.mp4"));
  const hasPoster = fs.existsSync(path.join(dir, "demo-poster.jpg"));
  return { slides, hasVideo, hasPoster };
}

export default async function RootPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  // Signed-in users have no business on the marketing page — straight to work.
  const session = await auth();
  if (session?.user) redirect({ href: "/catalog", locale });

  const t = await getTranslations("landing");
  const { slides, hasVideo, hasPoster } = landingAssets();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <Brand size="nav" />
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Button asChild variant="outline" size="sm">
            <Link href="/login">{t("signIn")}</Link>
          </Button>
        </div>
      </header>

      <section className="flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold text-ink sm:text-4xl">{t("headline")}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-sub sm:text-lg">{t("subline")}</p>
        </div>
        <HeroCarousel images={slides} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-center text-2xl font-semibold text-ink">{t("videoTitle")}</h2>
        {hasVideo ? (
          <video
            controls
            preload="metadata"
            poster={hasPoster ? "/landing/demo-poster.jpg" : undefined}
            className="aspect-video w-full rounded-2xl border border-line bg-black"
          >
            <source src="/landing/demo.mp4" type="video/mp4" />
          </video>
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface-2 text-center">
            <PlayCircle className="h-14 w-14 text-faint" aria-hidden />
            <p className="text-sm text-sub">{t("videoComingSoon")}</p>
          </div>
        )}
      </section>

      <section id="waitlist" className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-semibold text-ink">{t("form.title")}</h2>
          <p className="mt-2 text-sm text-sub">{t("form.subtitle")}</p>
        </div>
        <WaitlistForm />
      </section>

      <footer className="pb-4 text-center text-xs text-faint">
        © {new Date().getFullYear()} Mbarete
      </footer>
    </div>
  );
}
