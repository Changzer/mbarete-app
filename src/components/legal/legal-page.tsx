import { Link } from "@/i18n/navigation";
import { Brand } from "@/components/brand";
import { BeianFooter } from "@/components/legal/beian-footer";

/**
 * The shared frame of the public legal pages: brand on top, a readable
 * measure, the version line, a way back. Content is long-form per-locale
 * JSX from the page itself — legal text does not belong in message
 * catalogs, where it would be shredded into keys.
 */
export function LegalPage({
  title,
  updated,
  backLabel,
  children,
}: {
  title: string;
  updated: string;
  backLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-2">
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Brand size="nav" />
          <Link href="/login" className="text-sm font-medium text-brand-600 hover:underline">
            {backLabel}
          </Link>
        </div>
        <h1 className="text-[26px] font-extrabold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-xs text-faint">{updated}</p>
        <div className="legal-prose mt-6 flex flex-col gap-4 text-[13.5px] leading-relaxed text-ink">
          {children}
        </div>
      </div>
      <BeianFooter />
    </div>
  );
}

/** Section heading + body, so both policies read with one rhythm. */
export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="mt-2 text-[15px] font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}
