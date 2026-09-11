import Image from "next/image";
import { getTranslations } from "next-intl/server";

/**
 * One visual per service, for the public page's scroll story.
 *
 * These are drawings of the work, not screenshots of the internal tool — that
 * tool is private now, and a real screenshot would carry live supplier names,
 * prices and contact details onto a public page anyway. Product artwork is our
 * own generated set rather than stock photography, which would be a licence
 * problem on a page built to be shared.
 *
 * Every figure is invented. Each visual says so through the caption its beat
 * renders, because a quote sheet that looks real and is not is the one thing
 * on this page that could mislead a buyer.
 *
 * All four render on the server with no client JavaScript.
 */

/**
 * One product carried through all four beats: the item sourced in 01 is the
 * one sampled in 02, produced in 03 and shipped in 04. A reader following the
 * page down should be able to follow the same goods through it — four
 * different products would quietly say these are four unrelated services.
 */
const SUBJECT = { src: "/landing/06-preschool-backpack.webp" } as const;

const ALTERNATES = [
  "/landing/02-storage-organizer.webp",
  "/landing/05-silicone-utensil-set.webp",
] as const;

function Frame({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-card border border-line bg-surface shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

function Caption({ text }: { text: string }) {
  return <p className="mt-2 text-[11px] text-sub">{text}</p>;
}

/** 01 — three real quotes for one product, which is what sourcing delivers. */
export async function SourcingVisual() {
  const t = await getTranslations("landing.visual");
  const quotes = [
    { supplier: "A", price: "$4.20", moq: "600" },
    { supplier: "B", price: "$3.85", moq: "1 000" },
    { supplier: "C", price: "$4.60", moq: "300" },
  ];
  return (
    <div>
      <Frame>
        <div className="flex items-center gap-3 border-b border-line p-3">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-field border border-line bg-surface-2">
            <Image src={SUBJECT.src} alt="" fill sizes="56px" className="object-cover" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ink">{t("productName")}</div>
            <div className="font-mono text-[11px] text-sub">{t("suppliers")} · 3</div>
          </div>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line font-mono text-[9.5px] uppercase tracking-[0.08em] text-sub">
              <th className="py-2 pl-3 pr-2 font-normal">{t("suppliers")}</th>
              <th className="px-2 py-2 text-right font-normal">{t("unitPrice")}</th>
              <th className="py-2 pl-2 pr-3 text-right font-normal">{t("moq")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {quotes.map((q) => (
              <tr key={q.supplier}>
                <td className="py-2 pl-3 pr-2 text-[12.5px] text-ink">{q.supplier}</td>
                <td className="px-2 py-2 text-right font-mono text-[12.5px] font-semibold text-ink">
                  {q.price}
                </td>
                <td className="py-2 pl-2 pr-3 text-right font-mono text-[12.5px] text-sub">{q.moq}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Frame>
      <Caption text={t("illustrative")} />
    </div>
  );
}

/** 02 — the sample documented from every side, before anything is ordered. */
export async function SamplingVisual() {
  const t = await getTranslations("landing.visual");
  return (
    <div>
      <Frame>
        <div className="relative aspect-[4/3] w-full bg-surface-2">
          <Image
            src={SUBJECT.src}
            alt={`${t("productName")} — ${t("sample")}`}
            fill
            sizes="(min-width: 768px) 32rem, 100vw"
            className="object-cover"
          />
          {/* The play marker is what separates "a product photo" from "we
              filmed the sample for you". */}
          <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-[rgba(38,32,26,0.78)] px-2.5 py-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#f1eae1" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#f1eae1]">
              {t("video")}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`relative h-11 flex-1 overflow-hidden rounded-field border bg-surface-2 ${
                i === 0 ? "border-action" : "border-line"
              }`}
            >
              <Image
                src={SUBJECT.src}
                alt=""
                fill
                sizes="80px"
                className="object-cover"
                style={{ objectPosition: `${20 + i * 20}% 50%` }}
              />
            </div>
          ))}
          <span className="shrink-0 pl-1 font-mono text-[10.5px] text-sub">12 {t("photos")}</span>
        </div>
      </Frame>
      <Caption text={t("illustrative")} />
    </div>
  );
}

/** 03 — the approved sample against the batch, which is the whole promise. */
export async function ProductionVisual() {
  const t = await getTranslations("landing.visual");
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: t("approved"), accent: true },
          { label: t("production"), accent: false },
        ].map((side) => (
          <Frame key={side.label}>
            <div className="relative aspect-square w-full bg-surface-2">
              <Image
                src={SUBJECT.src}
                alt=""
                fill
                sizes="(min-width: 768px) 15rem, 45vw"
                className="object-cover"
              />
            </div>
            <div className="border-t border-line px-2.5 py-2">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-sub">
                {side.label}
              </div>
            </div>
          </Frame>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-2 rounded-card border border-line bg-surface px-3 py-2">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-ok"
          aria-hidden
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
        <span className="text-[12.5px] font-semibold text-ink">{t("matches")}</span>
      </div>
      <Caption text={t("illustrative")} />
    </div>
  );
}

/** 04 — the last look before the doors close, and where it is going. */
export async function ExportVisual() {
  const t = await getTranslations("landing.visual");
  const checks = [t("checkQuantity"), t("checkFinish"), t("checkPacking"), t("checkLabels")];
  return (
    <div>
      <Frame>
        <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2.5">
          <span className="text-[12.5px] font-semibold text-ink">{t("inspection")}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ok">
            4 / 4
          </span>
        </div>
        <ul className="divide-y divide-line">
          {checks.map((c) => (
            <li key={c} className="flex items-center gap-2.5 px-3.5 py-2">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-ok"
                aria-hidden
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span className="text-[12.5px] text-ink">{c}</span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
          <div className="bg-surface px-3.5 py-2.5">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-sub">
              {t("cartons")}
            </div>
            <div className="font-mono text-[15px] font-semibold text-ink">84</div>
          </div>
          <div className="bg-surface px-3.5 py-2.5">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-sub">
              {t("destination")}
            </div>
            <div className="font-mono text-[15px] font-semibold text-ink">{t("destValue")}</div>
          </div>
        </div>
      </Frame>
      <div className="mt-3 flex gap-2">
        {ALTERNATES.map((src) => (
          <div
            key={src}
            className="relative h-12 w-12 overflow-hidden rounded-field border border-line bg-surface-2 opacity-60"
          >
            <Image src={src} alt="" fill sizes="48px" className="object-cover" />
          </div>
        ))}
        <div className="relative h-12 w-12 overflow-hidden rounded-field border border-line bg-surface-2">
          <Image src={SUBJECT.src} alt="" fill sizes="48px" className="object-cover" />
        </div>
      </div>
      <Caption text={t("illustrative")} />
    </div>
  );
}
