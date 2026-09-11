import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowDown, ArrowUpRight, MapPin } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect, Link } from "@/i18n/navigation";
import { routing, HREFLANG, type Locale } from "@/i18n/routing";
import { Brand } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { EnquiryForm } from "@/components/landing/enquiry-form";
import { HeroVisual, ServiceVisual } from "@/components/landing/service-visuals";
import { Button } from "@/components/ui/button";
import styles from "@/components/landing/landing.module.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  // Omit canonical URLs on unconfigured local installs; never publish localhost
  // or trust a visitor-controlled Host header as the public website address.
  let origin: URL | undefined;
  try {
    const configured = new URL(process.env.APP_ORIGIN ?? "");
    if (["https:", "http:"].includes(configured.protocol)) origin = new URL(configured.origin);
  } catch { /* A local install need not have a public domain. */ }
  return {
    title: t("metaTitle"), description: t("metaDescription"),
    ...(origin ? {
      metadataBase: origin,
      alternates: {
        canonical: `/${locale}`,
        languages: Object.fromEntries([
          ...routing.locales.map((l) => [HREFLANG[l], `/${l}`]),
          ["x-default", `/${routing.defaultLocale}`],
        ]),
      },
    } : {}),
    openGraph: {
      title: t("metaTitle"), description: t("metaDescription"), type: "website",
      locale: ({ en: "en_US", "pt-BR": "pt_BR", es: "es_419", zh: "zh_CN" } as const)[locale as Locale],
      ...(origin ? { url: new URL(`/${locale}`, origin) } : {}),
    },
  };
}

const chapters = ["sourcing", "sampling", "export"] as const;

export default async function RootPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const session = await auth();
  if (session?.user) redirect({ href: "/catalog", locale });
  const t = await getTranslations("landing");

  return (
    <div className={`${styles.page} light-paper`}>
      <a href="#contact" className={styles.skip}>{t("ctaPrimary")}</a>
      <header className={styles.header}>
        <Link href="/" aria-label="Mbarete" className={styles.brand}><Brand size="nav" /></Link>
        <div className={styles.headerActions}>
          <LanguageSwitcher />
          <Button asChild className={styles.headerCta}>
            <a href="#contact">{t("ctaPrimary")}<ArrowUpRight aria-hidden /></a>
          </Button>
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><MapPin size={15} aria-hidden />{t("eyebrow")}</p>
          <h1 id="landing-title">{t("headline")}<span>{t("headlineAccent")}</span></h1>
          <p className={styles.subline}>{t("subline")}</p>
          <div className={styles.heroActions}>
            <Button asChild size="lg" className={styles.primary}>
              <a href="#contact">{t("ctaPrimary")}<ArrowUpRight aria-hidden /></a>
            </Button>
            <a href="#how" className={styles.textLink}>{t("ctaSecondary")}<ArrowDown size={17} aria-hidden /></a>
          </div>
          <p className={styles.languages}>{t("proof")}</p>
        </div>
        <HeroVisual />
        <div className={styles.heroFoot}>
          <span>{t("heroFoot")}</span>
          <a href="#how" aria-label={t("ctaSecondary")}><ArrowDown size={20} aria-hidden /></a>
        </div>
      </section>

      <section id="how" className={styles.process} aria-labelledby="process-title">
        <div className={styles.processIntro}>
          <p className={styles.eyebrow}>{t("storyLabel")}</p>
          <h2 id="process-title">{t("processTitle")}</h2>
          <p>{t("processBody")}</p>
        </div>
        <div className={styles.story}>
          <div className={styles.stage}>
            {chapters.map((chapter, index) => (
              <article key={chapter} className={`${styles.chapter} ${styles[chapter]}`}>
                <div className={styles.chapterInner}>
                  <div className={styles.chapterCopy}>
                    <p className={styles.chapterLabel}><span>{String(index + 1).padStart(2, "0")}</span>{t(`services.${chapter}Label`)}</p>
                    <h3>{t(`services.${chapter}Title`)}</h3>
                    <p>{t(`services.${chapter}Body`)}</p>
                    <div className={styles.deliverable}><span>{t("deliverableLabel")}</span><p>{t(`services.${chapter}Note`)}</p></div>
                    <div className={styles.chapterProgress} aria-hidden>
                      {chapters.map((key) => <span key={key} className={key === chapter ? styles.current : undefined} />)}
                    </div>
                  </div>
                  <ServiceVisual chapter={chapter} />
                </div>
              </article>
            ))}
          </div>
          <div className={styles.scrollRoom} aria-hidden />
        </div>
      </section>

      <section id="contact" className={styles.contact} aria-labelledby="contact-title">
        <div className={styles.contactIntro}>
          <p className={styles.eyebrow}>{t("form.eyebrow")}</p>
          <h2 id="contact-title">{t("form.title")}</h2>
          <p>{t("form.subtitle")}</p>
          <div className={styles.nextSteps}>
            <h3>{t("form.nextTitle")}</h3>
            <ol>{["nextOne", "nextTwo", "nextThree"].map((key) => <li key={key}>{t(`form.${key}`)}</li>)}</ol>
          </div>
          <p className={styles.contactNote}>{t("form.noAccount")}</p>
        </div>
        <div className={styles.formPanel}><EnquiryForm /></div>
      </section>

      <footer className={styles.footer}>
        <div><span className={styles.footerBrand}>MBARETE</span><p>{t("footerDescription")}</p></div>
        <div className={styles.footerMeta}>
          <span>© {new Date().getFullYear()} Mbarete</span>
          <Link href="/login">{t("signIn")}<ArrowUpRight size={14} aria-hidden /></Link>
        </div>
      </footer>
    </div>
  );
}
