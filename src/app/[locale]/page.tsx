import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowDownCircle, CloudOff, Check, FileText } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect, Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { Brand } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { CaptureVisual, StructureVisual, DecideVisual } from "@/components/landing/beat-visuals";
import { Button } from "@/components/ui/button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])),
    },
    openGraph: {
      title: t("metaTitle"),
      description: t("metaDescription"),
      type: "website",
      locale,
    },
  };
}

/**
 * The public landing page: a hero, one scroll story in three beats, and the
 * pilot waiting list. No carousel and no video section — the story carries the
 * product, and a "demo video coming soon" frame advertises an absence.
 *
 * The whole page is server-rendered with no client JavaScript except the form.
 * Its motion lives in globals.css and is pure CSS, which is what keeps it
 * working in the WeChat webview where most of this link's traffic will land.
 */

function Beat({
  label,
  title,
  body,
  note,
  noteIcon,
  visual,
  tone,
}: {
  label: string;
  title: string;
  body: string;
  note: string;
  noteIcon: React.ReactNode;
  visual: React.ReactNode;
  tone: "bg" | "surface-2";
}) {
  return (
    <section className={`lp-beat px-5 py-10 sm:px-8 sm:py-14 md:py-16 ${tone === "bg" ? "bg-bg" : "bg-surface-2"}`}>
      <div className="mx-auto grid w-full max-w-6xl items-center gap-7 sm:gap-10 md:grid-cols-2 md:gap-14">
        <div className="flex flex-col gap-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-sub">{label}</div>
          <h2 className="text-balance text-[clamp(1.6rem,5.5vw,2.9rem)] font-bold leading-[1.08] tracking-tight text-ink">
            {title}
          </h2>
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-sub sm:text-base">{body}</p>
          <p className="flex items-start gap-2 text-[13px] font-semibold text-action-chrome">
            <span className="mt-0.5 shrink-0" aria-hidden>
              {noteIcon}
            </span>
            {note}
          </p>
        </div>
        <div className="min-w-0">{visual}</div>
      </div>
    </section>
  );
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

  return (
    <div className="lp-scroller bg-bg">
      {/* Header and hero together own the first screen. The hero used to be
          sized by its text alone (579px), so on anything taller than a laptop
          the pinned story stage started hundreds of pixels above the fold and
          beat 1 sat under the hero at rest. */}
      <div className="lp-hero-screen">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Brand size="nav" />
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button asChild variant="outline" size="sm">
              <Link href="/login">{t("signIn")}</Link>
            </Button>
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <a href="#waitlist">{t("ctaPrimary")}</a>
            </Button>
          </div>
        </header>

        <section className="lp-hero mx-auto flex w-full max-w-5xl flex-1 flex-col items-center gap-6 px-5 pb-20 pt-12 text-center sm:px-8 sm:pt-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-action-chrome">
            {t("eyebrow")}
          </p>
          <h1 className="text-balance text-[clamp(2.1rem,8vw,4.6rem)] font-bold leading-[1.03] tracking-tight text-ink">
            {t("headline")}
          </h1>
          <p className="max-w-[58ch] text-[15px] leading-relaxed text-sub sm:text-lg">{t("subline")}</p>
          <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <a href="#waitlist">{t("ctaPrimary")}</a>
            </Button>
            <Button asChild variant="ghost" size="lg" className="w-full sm:w-auto">
              <a href="#story">
                <ArrowDownCircle className="h-[18px] w-[18px]" aria-hidden />
                {t("ctaSecondary")}
              </a>
            </Button>
          </div>
          <p className="font-mono text-[11.5px] leading-relaxed text-sub">{t("proof")}</p>
        </section>
      </div>

      <div id="story" className="lp-story">
        <h2 className="sr-only">{t("storyLabel")}</h2>
        <div className="lp-stack">
          <Beat
            tone="bg"
            label={t("beats.captureLabel")}
            title={t("beats.captureTitle")}
            body={t("beats.captureBody")}
            note={t("beats.captureNote")}
            noteIcon={<CloudOff className="h-4 w-4" />}
            visual={<CaptureVisual />}
          />
          <Beat
            tone="surface-2"
            label={t("beats.structureLabel")}
            title={t("beats.structureTitle")}
            body={t("beats.structureBody")}
            note={t("beats.structureNote")}
            noteIcon={<Check className="h-4 w-4" />}
            visual={<StructureVisual />}
          />
          <Beat
            tone="bg"
            label={t("beats.decideLabel")}
            title={t("beats.decideTitle")}
            body={t("beats.decideBody")}
            note={t("beats.decideNote")}
            noteIcon={<FileText className="h-4 w-4" />}
            visual={<DecideVisual />}
          />
        </div>
        {/* Only ever tall on a desktop that can drive the pinned crossfade;
            elsewhere it collapses to nothing. */}
        <div className="lp-spacer" aria-hidden />
      </div>

      <section
        id="waitlist"
        className="relative z-[1] border-t border-line bg-surface-2 px-5 py-16 sm:px-8 sm:py-24"
      >
        <div className="mx-auto w-full max-w-3xl rounded-sheet border border-line bg-surface p-6 sm:p-10">
          <div className="mb-8 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-action-chrome">
              {t("form.eyebrow")}
            </p>
            <h2 className="mt-3 text-balance text-[clamp(1.5rem,5vw,2.3rem)] font-bold leading-tight tracking-tight text-ink">
              {t("form.title")}
            </h2>
            <p className="mx-auto mt-3 max-w-[52ch] text-[15px] leading-relaxed text-sub">
              {t("form.subtitle")}
            </p>
          </div>
          <WaitlistForm />
        </div>
        <p className="mt-10 text-center text-xs text-sub">
          © {new Date().getFullYear()} Mbarete
        </p>
      </section>
    </div>
  );
}
