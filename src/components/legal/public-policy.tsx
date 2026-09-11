import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { Link } from "@/i18n/navigation";
import { publicPolicies } from "@/lib/public-policies";

export function PublicPolicy({ locale, kind }: { locale: string; kind: "privacy" | "terms" }) {
  const copy = publicPolicies(locale);
  const policy = copy[kind];
  const email = process.env.LEGAL_CONTACT_EMAIL?.trim();
  return (
    <LegalPage title={policy.title} updated={copy.updated} backLabel={copy.back}>
      <p>{policy.intro}</p>
      {policy.sections.map((section) => (
        <LegalSection key={section.title} title={section.title}><p>{section.body}</p></LegalSection>
      ))}
      <LegalSection title={copy.contactTitle}>
        <p>{copy.contactBody}</p>
        {email ? <p><a href={`mailto:${email}`} className="underline underline-offset-4">{email}</a></p> : null}
        <Link href="/#contact" className="inline-flex min-h-11 items-center text-brand-600 underline underline-offset-4">{copy.contactLink}</Link>
      </LegalSection>
      <Link href={kind === "privacy" ? "/terms" : "/privacy"} className="inline-flex min-h-11 items-center underline underline-offset-4">
        {kind === "privacy" ? copy.terms.title : copy.privacy.title}
      </Link>
    </LegalPage>
  );
}
