import Image from "next/image";
import { getTranslations } from "next-intl/server";

/**
 * The three product visuals for the landing page's scroll story.
 *
 * The frames are drawings of Mbarete's screens, not screenshots: a real
 * screenshot would carry real supplier names, prices and contact details into
 * a public marketing page. The products inside them are our own generated
 * artwork rather than stock photography, which would be a licence problem on a
 * page built to be shared. Every figure is invented sample data, and the frames
 * follow the app's own anatomy so what a visitor sees is the shape they meet.
 *
 * All three render on the server with no client JavaScript.
 */

/**
 * One catalog, used by all three beats: the set captured in 01 is the set
 * listed in 02 and billed in 03. A visitor who reads down the page should be
 * able to follow the same goods through it — different products in each frame
 * would quietly say these are three unrelated screens.
 */
const PRODUCTS = [
  {
    src: "/landing/01-insulated-bottle.webp",
    name: "Insulated bottle, 500 ml",
    zh: "保温杯 · 500ml",
    sku: "MBR-0388",
    moq: "500",
    cbm: "0.042",
    fob: "$2.15",
  },
  {
    src: "/landing/02-storage-organizer.webp",
    name: "Desk drawer organizer",
    zh: "桌面收纳柜 · 三层",
    sku: "MBR-0520",
    moq: "300",
    cbm: "0.096",
    fob: "$3.25",
  },
  {
    src: "/landing/03-rechargeable-mini-fan.webp",
    name: "Rechargeable mini fan",
    zh: "手持充电风扇",
    sku: "MBR-0367",
    moq: "500",
    cbm: "0.038",
    fob: "$2.80",
  },
  {
    src: "/landing/04-cordless-table-lamp.webp",
    name: "Cordless table lamp",
    zh: "无线充电台灯",
    sku: "MBR-0412",
    moq: "200",
    cbm: "0.055",
    fob: "$6.40",
  },
  {
    src: "/landing/05-silicone-utensil-set.webp",
    name: "Silicone utensil set, 5 pc",
    zh: "硅胶厨具五件套",
    sku: "MBR-0347",
    moq: "300",
    cbm: "0.085",
    fob: "$2.95",
  },
  {
    src: "/landing/06-preschool-backpack.webp",
    name: "Preschool backpack",
    zh: "儿童双肩包",
    sku: "MBR-0501",
    moq: "600",
    cbm: "0.110",
    fob: "$4.20",
  },
] as const;

/** The one being photographed in beat 01. */
const CAPTURED = PRODUCTS[4];

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
          which pushed the page 110px wider than a phone screen. Grid tracks
          give the tiles a definite width to derive height from. On a phone the
          photo takes a fixed 7rem of that and the board fills what is left — a
          square tile at half the width would stand 170px tall and push the rest
          of beat 01 off the screen. */}
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 sm:grid-cols-1 sm:gap-4">
        {/* Square at every width because the source art is square: the frame
            then crops nothing, on a phone tile or a desktop one. */}
        <div className="relative aspect-square overflow-hidden rounded-card border border-line bg-surface-2">
          <Image
            src={CAPTURED.src}
            alt={`${CAPTURED.name} — ${t("productPhoto")}`}
            fill
            sizes="(min-width: 768px) 9rem, 7rem"
            className="object-cover"
          />
          {/* The viewfinder corners stay: they are what says "this is a photo
              being taken", not a product shot sitting on a page. */}
          <svg viewBox="0 0 180 180" className="absolute inset-0 h-full w-full" aria-hidden>
            <g stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" className="text-action">
              <path d="M14 44V26a6 6 0 016-6h18" />
              <path d="M142 20h18a6 6 0 016 6v18" />
              <path d="M166 136v18a6 6 0 01-6 6h-18" />
              <path d="M38 160H20a6 6 0 01-6-6v-18" />
            </g>
          </svg>
        </div>
        {/* No aspect ratio on a phone: the board sits beside the photo and
            stretches to its height. Given one of its own it would be 228px
            wide, 171px tall, and taller than the photo it is paired with. */}
        <div className="relative overflow-hidden rounded-card border border-line-strong bg-[#26201a] sm:aspect-[4/3]">
          {/* Absolute so the drawing fills the tile instead of sizing it: in
              flow, `h-full` against an auto-height parent falls back to the
              viewBox's own ratio, which made the board 171px tall beside a
              112px photo. */}
          <svg viewBox="0 0 240 180" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" role="img" aria-label={t("boardPhoto")}>
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
            硅胶厨具五件套
            <br />
            ￥15.8 &nbsp; 60/箱 &nbsp; 起订 5箱
          </div>
        </div>

        {/* MOQ is pieces, not cartons: the board's 起订 5箱 at 60/箱 is the 300
            below. Showing the product of the two is the point — it is work the
            reader would otherwise do by hand at the stall. */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 p-4 pt-3">
          <Field label={t("nameEn")} value={CAPTURED.name} />
          <Field label={t("nameZh")} value={CAPTURED.zh} />
          <Field label={t("price")} value="15.80 CNY" mono />
          <Field label={t("perCarton")} value="60" mono />
          <Field label={t("moq")} value={CAPTURED.moq} mono />
          <Field label={t("category")} value="Kitchen / 厨房" />
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
            {PRODUCTS.map((r) => (
              <tr key={r.sku}>
                <td className="py-2 pl-4 pr-3">
                  <div className="flex items-center gap-2.5">
                    {/* Decorative: the name sits right beside it, and a screen
                        reader announcing both would say everything twice. */}
                    <Image
                      src={r.src}
                      alt=""
                      width={32}
                      height={32}
                      className="h-8 w-8 shrink-0 rounded-field border border-line object-cover"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-semibold text-ink">{r.name}</div>
                      <div className="truncate text-[11px] text-sub">{r.zh}</div>
                    </div>
                  </div>
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

/* The lines are three of the catalog rows above, and the arithmetic is real:
   600 lamps at $6.40, 3 000 bottles at $2.15, 3 000 utensil sets at $2.95. */
const PROFORMA_LINES = [
  { name: "Cordless table lamp 无线充电台灯", amount: "$3 840" },
  { name: "Insulated bottle 保温杯", amount: "$6 450" },
  { name: "Silicone utensil set 硅胶厨具", amount: "$8 850" },
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
          <span className="font-mono text-[14px] font-bold text-ink">$19 140</span>
        </div>
      </div>
    </div>
  );
}
