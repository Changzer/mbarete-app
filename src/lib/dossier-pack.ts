import crypto from "node:crypto";
import { DOSSIER_ITEMS, type DossierStatus, type TaxRegime, type Deadlines } from "@/lib/dossier";

/**
 * The pure half of the dossier zip: names, the 目录 rows, the README and
 * the manifest. Reading files and the database is dossier-server.ts.
 */

export type DossierEntry = { name: string; data: string | Buffer };

export type DossierManifest = {
  version: 1;
  order: { id: number; number: string; customsDeclarationNo: string | null };
  regime: TaxRegime;
  generatedAt: string;
  generatedBy: { id: number; email: string };
  /** sha256 over the numbered document files only — stable across regenerations. */
  digest: string;
  files: { path: string; sha256: string; bytes: number }[];
};

export const sha256Hex = (data: string | Buffer) =>
  crypto.createHash("sha256").update(data).digest("hex");

/**
 * Tamper evidence for the dossier: the numbered document files (01_… to
 * 19_…) hashed in a fixed order. The 目录, README and manifest carry
 * timestamps and stay out, so the same documents always give the same digest.
 */
export function dossierDigest(files: { path: string; sha256: string }[]): string {
  const lines = files
    .filter((f) => /^(0[1-9]|1\d)_/.test(f.path.split("/").pop() ?? ""))
    .map((f) => `${f.path}:${f.sha256}`)
    .sort();
  return sha256Hex(lines.join("\n"));
}

/** One row per checklist item, the way the accountant's sheet reads. */
export type CatalogRow = {
  n: number;
  zh: string;
  en: string;
  /** ✓ when the item is in the pack, ✗ when it is not. */
  check: "✓" | "✗";
  status: string;
  note: string;
  files: string;
};

const NOTE_ZH: Record<number, string> = {
  1: "货代准备",
  2: "货代准备；注明数(重)量、原产地/货源地，报关行盖章",
  3: "货代准备",
  4: "货代准备",
  5: "会计协助开具",
  6: "工厂开具。退税：13%/3%增值税专用发票；免税：免税增值税普通发票",
  7: "货代或者企业自行制作",
  8: "系统生成",
  9: "企业准备",
  10: "工厂或者企业准备",
  11: "企业准备",
  12: "货代准备",
  13: "货代准备",
  14: "企业网银下载",
  15: "企业网银下载",
  16: "企业网银下载",
  17: "企业准备",
  18: "邮件往来、聊天记录等（佐证）",
  19: "工厂车间视频、货物装箱视频（佐证）",
};

export function catalogRows(status: DossierStatus, fileNames: Map<number, string[]>): CatalogRow[] {
  return DOSSIER_ITEMS.map((def) => {
    const st = status.items[def.n - 1];
    const present = st.status === "uploaded" || st.status === "auto";
    return {
      n: def.n,
      zh: def.zh,
      en: def.en,
      check: present ? "✓" : "✗",
      status: st.status,
      note: NOTE_ZH[def.n] ?? "",
      files: (fileNames.get(def.n) ?? []).join("; "),
    };
  });
}

const REGIME_ZH: Record<TaxRegime, string> = {
  undecided: "未确定",
  rebate: "出口退税（免退税）",
  exempt: "出口免税",
};
const REGIME_EN: Record<TaxRegime, string> = {
  undecided: "undecided",
  rebate: "export VAT rebate (免退税)",
  exempt: "export VAT exemption (免税)",
};

const ITEM6_ZH: Record<TaxRegime, string> = {
  undecided: "第6项进项发票：尚未确定按退税还是免税申报。退税需增值税专用发票（13%/3%），免税需免税增值税普通发票。",
  rebate: "第6项进项发票：本单按退税申报，进项发票须为增值税专用发票（13%或3%）；3%专票的退税率以3%为限。",
  exempt: "第6项进项发票：本单按免税申报，进项税额不得抵扣、不得退税，转入成本；免税增值税普通发票即可。",
};
const ITEM6_EN: Record<TaxRegime, string> = {
  undecided: "Item 6, input invoice: the regime is not decided yet. A rebate needs a VAT special invoice (13% or 3%); an exemption needs a tax-exempt ordinary invoice.",
  rebate: "Item 6, input invoice: filed as a rebate, so the input invoice must be a VAT special invoice (13% or 3%); a 3% special invoice caps the rebate at 3%.",
  exempt: "Item 6, input invoice: filed as an exemption, so input VAT is neither credited nor refunded and goes to cost; a tax-exempt ordinary invoice suffices.",
};

export function buildDossierReadme(input: {
  companyName: string;
  orderNumber: string;
  customsDeclarationNo: string | null;
  regime: TaxRegime;
  deadlines: Deadlines;
  exportDate: string | null;
  generatedAt: string;
  digest: string;
}): string {
  const no = input.customsDeclarationNo ?? "（未填写 / not set）";
  const fx = input.deadlines.fxDeadline ?? "—";
  const declare = input.deadlines.declareDeadline ?? "—";
  const dateLineZh = input.exportDate
    ? `出口日期 ${input.exportDate}：收汇截止 ${fx}（退税）；申报上限 ${declare}（出口之日起36个月，逾期视同内销征税）。`
    : "出口日期尚未填写：收汇截止与36个月申报上限无法计算。";
  const dateLineEn = input.exportDate
    ? `Export date ${input.exportDate}: FX receipt due by ${fx} (rebate); declaration deadline ${declare} (36 months from export; later, the export is taxed as a domestic sale).`
    : "Export date not set: the FX receipt and 36-month declaration deadlines cannot be computed.";
  return [
    `退税/免税单证包 / Export rebate dossier — ${input.companyName}`,
    `报关单号 / Customs declaration no.: ${no}`,
    `订单号 / Order: ${input.orderNumber}`,
    `申报方式 / Regime: ${REGIME_ZH[input.regime]} / ${REGIME_EN[input.regime]}`,
    `生成时间 / Generated: ${input.generatedAt}`,
    "",
    "【说明】",
    "本文件夹由系统导出，未经人工修改。文件按《出口退税/免税-单证资料表》编号命名，00_单证目录.xlsx 为目录。",
    "依据《出口业务增值税和消费税退（免）税管理办法》（国家税务总局公告2026年第5号）第四十六条，备案单证可以纸质、影像化或数字化形式留存；",
    "备案单证应在申报退（免）税后15日内留存并制作备案单证目录，保存期限10年。税务机关检查时，数字化单证应打印并加盖企业印章、由法定代表人或授权人签字确认与原件一致。",
    ITEM6_ZH[input.regime],
    dateLineZh,
    "",
    "[Notes]",
    "This folder was generated by the system and not modified by hand. Files are numbered after the accountant's sheet; 00_单证目录.xlsx is the index.",
    "Under the Export VAT and Consumption Tax Refund (Exemption) Management Measures (STA Announcement 2026 No. 5, art. 46), filing documents may be kept on paper, as images or digitally;",
    "they go on file within 15 days of the claim, with an index of the filing documents, and are retained for 10 years. On inspection, digital documents are printed, stamped and signed as consistent with the originals.",
    ITEM6_EN[input.regime],
    dateLineEn,
    "",
    "manifest.json  每个文件的 SHA-256 哈希 / SHA-256 per file",
    `单证摘要 / Documents digest: ${input.digest}`,
    "",
  ].join("\r\n");
}
