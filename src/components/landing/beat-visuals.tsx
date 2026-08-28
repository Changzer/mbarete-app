import { getTranslations } from "next-intl/server";

/**
 * The three product visuals for the landing page's scroll story.
 *
 * These are drawings of Mbarete's screens, not screenshots of them, and not
 * photographs of products: real screenshots would carry real supplier names,
 * prices and contact details into a public marketing page, and stock
 * photography of "products" would be a licence problem on a page built to be
 * shared. Every figure here is invented sample data, and the frames follow the
 * app's own anatomy so what a visitor sees is the shape they will meet.
 *
 * All three render on the server with no client JavaScript.
 */

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-sub">{label}</div>
      <div
        className={`flex h-[30px] min-w-0 items-center overflow-hidden whitespace-nowrap rounded-field border border-line-strong bg-bg px-2.5 text-[12.5px] text-ink ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** 01 — the two shots and the record they produce. */
export async function CaptureVisual() {
  const t = await getTranslations("landing.sample");
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,7rem)_minmax(0,1fr)] md:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
      {/* A grid, not a flex row: a flex item whose only size is an aspect ratio
          resolves its min-content width from that ratio and refuses to shrink,
          which pushed the page 110px wider than a phone screen. Equal grid
          tracks give the tiles a definite width to derive height from. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-1 sm:gap-4">
        <div className="relative h-20 overflow-hidden rounded-card border border-line bg-surface-2 sm:h-auto sm:aspect-[3/4]">
          <svg viewBox="0 0 180 240" className="h-full w-full object-cover" preserveAspectRatio="xMidYMid slice" role="img" aria-label={t("productPhoto")}>
            <g stroke="currentColor" strokeWidth="1.6" fill="none" className="text-line-strong">
              <rect x="34" y="66" width="112" height="108" rx="9" />
              <path d="M34 150l30-26 22 19 26-31 34 38" />
              <circle cx="112" cy="96" r="10" />
            </g>
            <g stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" className="text-action">
              <path d="M14 44V26a6 6 0 016-6h18" />
              <path d="M142 20h18a6 6 0 016 6v18" />
              <path d="M166 196v18a6 6 0 01-6 6h-18" />
              <path d="M38 220H20a6 6 0 01-6-6v-18" />
            </g>
          </svg>
        </div>
        <div className="relative h-20 overflow-hidden rounded-card border border-line-strong bg-[#26201a] sm:h-auto sm:aspect-[4/3]">
          <svg viewBox="0 0 240 180" className="h-full w-full object-cover" preserveAspectRatio="xMidYMid slice" role="img" aria-label={t("boardPhoto")}>
            <g
              stroke="#f1eae1"
              strokeWidth="3.4"
              fill="none"
              strokeLinecap="round"
              transform="rotate(-4 120 90)"
            >
              <path d="M40 58h58" />
              <path d="M40 84h84" />
              <path d="M40 112h44" />
              <path d="M150 58h50" />
              <path d="M150 112h34" />
            </g>
          </svg>
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <span className="text-[13px] font-semibold text-ink">{t("catalogTab")}</span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.07em] text-ok">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {t("readFromPhotos")}
          </span>
        </div>

        <div className="px-4 pt-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.09em] text-sub">
            {t("boardHeading")}
          </div>
          <div className="rounded-field border border-line bg-surface-2 px-3 py-1.5 font-mono text-[11.5px] leading-relaxed text-ink">
            陶瓷马克杯 350ml
            <br />
            ￥12.5 &nbsp; 160/箱 &nbsp; 起订 2箱
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2 p-4 pt-3">
          <Field label={t("nameEn")} value="Ceramic mug 350ml" />
          <Field label={t("nameZh")} value="陶瓷马克杯 350ml" />
          <Field label={t("price")} value="12.50 CNY" mono />
          <Field label={t("perCarton")} value="160" mono />
          <Field label={t("moq")} value="320" mono />
          <Field label={t("category")} value="Homeware / 家居" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3.5">
          <span className="text-[11.5px] text-sub">{t("reviewNote")}</span>
          <span className="inline-flex h-8 items-center rounded-field bg-action px-4 text-[12.5px] font-semibold text-white">
            {t("save")}
          </span>
        </div>
      </div>
    </div>
  );
}

const CATALOG_ROWS = [
  { name: "Rattan pendant lamp", zh: "藤编吊灯 · 40cm", sku: "MBR-0412", moq: "200", cbm: "0.085", fob: "$6.40" },
  { name: "Vacuum flask, 500 ml", zh: "保温杯 · 不锈钢", sku: "MBR-0388", moq: "500", cbm: "0.012", fob: "$2.15" },
  { name: "Cotton canvas tote", zh: "帆布袋 · 12 oz", sku: "MBR-0501", moq: "1 000", cbm: "0.004", fob: "$0.86" },
  { name: "Ceramic mug, set of 4", zh: "陶瓷杯 · 四件套", sku: "MBR-0347", moq: "300", cbm: "0.021", fob: "$3.70" },
  { name: "Bamboo cutting board", zh: "竹砧板 · 38cm", sku: "MBR-0298", moq: "400", cbm: "0.018", fob: "$4.10" },
  { name: "Linen cushion cover", zh: "亚麻抱枕套 · 45×45", sku: "MBR-0455", moq: "600", cbm: "0.006", fob: "$1.95" },
];

/** 02 — the catalog those records add up to. */
export async function StructureVisual() {
  const t = await getTranslations("landing.sample");
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <span className="border-b-2 border-action pb-0.5 text-[13px] font-semibold text-ink">
          {t("catalogTab")}
        </span>
        <span className="font-mono text-[10.5px] text-sub">248</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left">
          <thead>
            <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[0.08em] text-sub">
              <th className="py-2 pl-4 pr-3 font-normal">{t("productCol")}</th>
              <th className="px-3 py-2 font-normal">SKU</th>
              <th className="px-3 py-2 text-right font-normal">{t("moq")}</th>
              <th className="px-3 py-2 text-right font-normal">CBM</th>
              <th className="py-2 pl-3 pr-4 text-right font-normal">FOB</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {CATALOG_ROWS.map((r) => (
              <tr key={r.sku}>
                <td className="py-2 pl-4 pr-3">
                  <div className="text-[12.5px] font-semibold text-ink">{r.name}</div>
                  <div className="text-[11px] text-sub">{r.zh}</div>
                </td>
                <td className="px-3 py-2 font-mono text-[11.5px] text-sub">{r.sku}</td>
                <td className="px-3 py-2 text-right font-mono text-[11.5px] text-sub">{r.moq}</td>
                <td className="px-3 py-2 text-right font-mono text-[11.5px] text-sub">{r.cbm}</td>
                <td className="py-2 pl-3 pr-4 text-right font-mono text-[11.5px] font-semibold text-ink">
                  {r.fob}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PROFORMA_LINES = [
  { name: "Rattan pendant lamp 藤编吊灯", amount: "$3 840" },
  { name: "Vacuum flask 保温杯", amount: "$6 450" },
  { name: "Ceramic mug, set of 4 陶瓷杯", amount: "$8 600" },
];

/** 03 — the document the client actually receives. */
export async function DecideVisual() {
  const t = await getTranslations("landing.sample");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2.5">
        {[".XLSX", ".PDF"].map((f) => (
          <span
            key={f}
            className="inline-flex h-9 items-center gap-2 rounded-card border border-line bg-surface px-3.5 font-mono text-[11.5px] text-sub"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="text-ok" aria-hidden>
              <path d="M14 3v5h5" />
              <path d="M19 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v13z" />
            </svg>
            {f}
          </span>
        ))}
      </div>

      {/* A proforma is white paper whatever theme the app is wearing, so it
          carries .light-paper the same way the real document does. */}
      <div className="light-paper rounded-card border border-line-strong bg-surface p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
          <div className="text-[13px] font-semibold text-ink">Mbarete</div>
          <div className="text-right">
            <div className="text-[12px] font-bold uppercase tracking-wide text-ink">{t("proforma")}</div>
            <div className="font-mono text-[10.5px] text-sub">PI-2026-0043</div>
          </div>
        </div>
        {PROFORMA_LINES.map((l) => (
          <div key={l.name} className="flex justify-between gap-4 border-b border-line py-2">
            <span className="text-[12.5px] text-ink">{l.name}</span>
            <span className="font-mono text-[12.5px] text-ink">{l.amount}</span>
          </div>
        ))}
        <div className="flex justify-between gap-4 pt-3">
          <span className="text-[13px] font-bold text-ink">{t("total")}</span>
          <span className="font-mono text-[14px] font-bold text-ink">$18 890</span>
        </div>
      </div>
    </div>
  );
}
