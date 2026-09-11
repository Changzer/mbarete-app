import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowDownCircle, Search, Camera, Factory, ShieldCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect, Link } from "@/i18n/navigation";
import { routing, HREFLANG, type Locale } from "@/i18n/routing";
import { Brand } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { EnquiryForm } from "@/components/landing/enquiry-form";
import {
  SourcingVisual,
  SamplingVisual,
  ProductionVisual,
  ExportVisual,
} from "@/components/landing/service-visuals";
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
      // The path segment and the advertised tag are not always the same: the
      // Spanish copy is written for Latin America and says so here, while the
      // URL stays /es.
      languages: Object.fromEntries(routing.locales.map((l) => [HREFLANG[l], `/${l}`])),
    },
    openGraph: {
      title: t("metaTitle"),
      description: t("metaDescription"),
      type: "website",
      locale: HREFLANG[locale as Locale] ?? locale,
    },
  };
}

/**
 * The public page: what Mbarete does for importers, in four steps, and a form
 * to start a conversation.
 *
 * It sells the SERVICE, not the software. The app behind the login is an
 * internal tool and stays private, so nothing here demonstrates it — the
 * visuals are drawings of the work itself.
 *
 * Server-rendered throughout; the only client components are the form and the
 * language picker. The motion lives in globals.css and is pure CSS.
 */

function Step({
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
    <section
      className={`lp-beat px-5 py-10 sm:px-8 sm:py-14 md:py-16 ${
        tone === "bg" ? "bg-bg" : "bg-surface-2"
      }`}
    >
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

  // Staff who are already signed in have no business on the marketing page.
  const session = await auth();
  if (session?.user) redirect({ href: "/catalog", locale });

  const t = await getTranslations("landing");

  return (
    <div className="bg-bg">
      {/* Wraps on purpose. The language picker has to show four endonyms, so
          it is wider than the old two-way toggle, and "Ingresar" is longer
          than "Sign in" — together with the brand that overran a 320px screen
          and pushed the whole page sideways. Below sm the controls drop to
          their own line instead. */}
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 sm:flex-nowrap sm:px-8">
        <Brand size="nav" />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <LanguageSwitcher />
          <Button asChild variant="outline" size="sm">
            <Link href="/login">{t("signIn")}</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <a href="#contact">{t("ctaPrimary")}</a>
          </Button>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-5 pb-20 pt-12 text-center sm:px-8 sm:pt-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-action-chrome">
          {t("eyebrow")}
        </p>
        <h1 className="text-balance text-[clamp(2.1rem,8vw,4.6rem)] font-bold leading-[1.03] tracking-tight text-ink">
          {t("headline")}
        </h1>
        <p className="max-w-[60ch] text-[15px] leading-relaxed text-sub sm:text-lg">{t("subline")}</p>
        <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <a href="#contact">{t("ctaPrimary")}</a>
          </Button>
          <Button asChild variant="ghost" size="lg" className="w-full sm:w-auto">
            <a href="#how">
              <ArrowDownCircle className="h-[18px] w-[18px]" aria-hidden />
              {t("ctaSecondary")}
            </a>
          </Button>
        </div>
        <p className="font-mono text-[11.5px] leading-relaxed text-sub">{t("proof")}</p>
      </section>

      <div id="how" className="lp-story">
        <h2 className="sr-only">{t("storyLabel")}</h2>
        <div className="lp-stack">
          <Step
            tone="bg"
            label={t("services.sourcingLabel")}
            title={t("services.sourcingTitle")}
            body={t("services.sourcingBody")}
            note={t("services.sourcingNote")}
            noteIcon={<Search className="h-4 w-4" />}
            visual={<SourcingVisual />}
          />
          <Step
            tone="surface-2"
            label={t("services.samplingLabel")}
            title={t("services.samplingTitle")}
            body={t("services.samplingBody")}
            note={t("services.samplingNote")}
            noteIcon={<Camera className="h-4 w-4" />}
            visual={<SamplingVisual />}
          />
          <Step
            tone="bg"
            label={t("services.productionLabel")}
            title={t("services.productionTitle")}
            body={t("services.productionBody")}
            note={t("services.productionNote")}
            noteIcon={<Factory className="h-4 w-4" />}
            visual={<ProductionVisual />}
          />
          <Step
            tone="surface-2"
            label={t("services.exportLabel")}
            title={t("services.exportTitle")}
            body={t("services.exportBody")}
            note={t("services.exportNote")}
            noteIcon={<ShieldCheck className="h-4 w-4" />}
            visual={<ExportVisual />}
          />
        </div>
        {/* Only ever tall on a desktop that can drive the pinned crossfade;
            elsewhere it collapses to nothing. */}
        <div className="lp-spacer" aria-hidden />
      </div>

      {/* The mission, said plainly and once. It is the reason the four steps
          above are shaped the way they are, so it reads after them. */}
      <section className="relative z-[1] border-t border-line bg-bg px-5 py-16 text-center sm:px-8 sm:py-24">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-balance text-[clamp(1.7rem,6vw,3.1rem)] font-bold leading-[1.06] tracking-tight text-ink">
            {t("missionTitle")}
          </h2>
          <p className="mx-auto mt-5 max-w-[56ch] text-[15px] leading-relaxed text-sub sm:text-lg">
            {t("missionBody")}
          </p>
        </div>
      </section>

      <section
        id="contact"
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
          <EnquiryForm />
        </div>
        <p className="mt-10 text-center text-xs text-sub">
          © {new Date().getFullYear()} Mbarete
        </p>
      </section>
    </div>
  );
}
