/**
 * The rebate dossier (退税/免税单证包): for one shipment, which export VAT
 * treatment it is filed under, the accountant's nineteen-item checklist,
 * each item's state given what has been uploaded, and the deadlines that
 * run from the customs export date.
 *
 * Regulatory basis, effective 2026-01-01: 财政部 税务总局公告2026年第11号
 * (policy; replaced 财税〔2012〕39号) and 国家税务总局公告2026年第5号
 * 《出口业务增值税和消费税退（免）税管理办法》 (procedure; replaced 2012年第24号,
 * absorbing 2022年第9号 on filing documents, with retention now ten years).
 *
 * For a trading company (外贸企业, 免退税办法) the checklist is the same for a
 * rebate and an exemption; the only difference is item 6, the purchase
 * fapiao: a VAT special invoice (专票, 13% or 3%) supports a rebate, a
 * tax-exempt ordinary invoice (普票) supports an exemption. No fapiao at all
 * is not a regime: 2026年第11号 第七条 treats such an export as a domestic
 * sale (视同内销征税), so the checklist flags it as a risk.
 *
 * No money math lives here. A later phase may estimate 应退税额 =
 * 专票不含税金额 × 退税率 (capped at 3% on a 3% 专票); deliberately not built.
 */

export type TaxRegime = "undecided" | "rebate" | "exempt";
export const TAX_REGIMES: readonly TaxRegime[] = ["undecided", "rebate", "exempt"];

export type FapiaoType = "special" | "special_3" | "ordinary_exempt" | "none";
export const FAPIAO_TYPES: readonly FapiaoType[] = ["special", "special_3", "ordinary_exempt", "none"];

export type DossierItemStatus = "uploaded" | "auto" | "missing" | "not_applicable" | "risk";

export type Responsible = "forwarder" | "company" | "factory" | "accountant" | "system" | "bank";

export type DossierItem = {
  n: number;
  /** The document kind this item's uploads are stored as (order_documents.kind). */
  key: string;
  zh: string;
  en: string;
  responsible: Responsible;
  /** Supporting evidence only: absence never blocks completeness. */
  optional: boolean;
  /** The proforma the system generates itself. */
  auto: boolean;
  /** This item takes video files, and only this one. */
  video: boolean;
};

const item = (
  n: number,
  key: string,
  zh: string,
  en: string,
  responsible: Responsible,
  flags: Partial<Pick<DossierItem, "optional" | "auto" | "video">> = {},
): DossierItem => ({ n, key, zh, en, responsible, optional: false, auto: false, video: false, ...flags });

/** The SIKAI 思凯 sheet 《出口退税/免税-单证资料表》, item by item. */
export const DOSSIER_ITEMS: readonly DossierItem[] = [
  item(1, "customs_declaration", "报关单", "Customs declaration", "forwarder"),
  item(2, "customs_agency_agreement", "委托报关协议", "Customs agency agreement", "forwarder"),
  item(3, "release_notice", "无纸化放行通知书", "Paperless release notice", "forwarder"),
  item(4, "bill_of_lading", "提单", "Bill of lading", "forwarder"),
  item(5, "export_invoice", "出口发票", "Export invoice", "accountant"),
  item(6, "supplier_invoice", "进项发票", "Input VAT invoice", "factory"),
  item(7, "packing_list", "装箱单", "Packing list", "forwarder"),
  item(8, "proforma", "形式发票", "Proforma invoice", "system", { auto: true }),
  item(9, "export_contract", "外销合同", "Export sales contract", "company"),
  item(10, "purchase_contract", "购货合同", "Purchase contract", "factory"),
  item(11, "domestic_freight_invoice", "国内运费发票", "Domestic freight invoice", "company"),
  item(12, "intl_freight_invoice", "国际运费发票", "International freight invoice", "forwarder"),
  item(13, "freight_breakdown", "运费明细", "Freight breakdown", "forwarder"),
  item(14, "fx_settlement_slip", "收汇结汇水单", "FX receipt / settlement slip", "company"),
  item(15, "freight_payment_slip", "运费水单", "Freight payment slip", "company"),
  item(16, "factory_payment_slip", "工厂付款水单", "Factory payment slip", "company"),
  item(17, "warehouse_slip", "出入库单", "Warehouse in/out slips", "company"),
  item(18, "trade_correspondence", "贸易往来记录", "Trade correspondence", "company", { optional: true }),
  item(19, "loading_video", "视频", "Videos (factory floor, loading)", "company", { optional: true, video: true }),
];

export const DOSSIER_KINDS = DOSSIER_ITEMS.map((i) => i.key);

export function dossierItem(key: string): DossierItem | undefined {
  return DOSSIER_ITEMS.find((i) => i.key === key);
}

/** The 18-digit customs declaration number, or nothing. */
export const CUSTOMS_NO = /^\d{18}$/;

export type DossierDocument = {
  id: number;
  kind: string;
  fapiaoType: string | null;
  originalName: string;
  path: string;
  sizeBytes: number;
};

/** Why an item is a risk or carries a note; the UI maps codes to words. */
export type ItemWarning =
  | "rebate_needs_special"
  | "special_3_cap"
  | "no_fapiao_deemed_domestic"
  | "exempt_but_special";

export type ItemState = {
  n: number;
  key: string;
  status: DossierItemStatus;
  warning?: ItemWarning;
  files: DossierDocument[];
};

export type Deadlines = {
  /** 收汇截止: 30 April of the year after customs export (rebate claims). */
  fxDeadline: string | null;
  /** 申报上限: 36 months from customs export; after it the export is taxed as a domestic sale. */
  declareDeadline: string | null;
  /** 备案单证 are kept ten years from filing. */
  retentionYears: 10;
  /** 备案单证 go on file within fifteen days of the claim. */
  filingDays: 15;
};

export type DossierStatus = {
  items: ItemState[];
  /** Items satisfied: uploaded, or auto-generated. */
  uploaded: number;
  /** Items that must be satisfied for the dossier to be complete. */
  required: number;
  /** Required items still missing or in a risk state. */
  outstanding: number;
  complete: boolean;
  deadlines: Deadlines;
  /** The regime has not been chosen while the 36-month clock is already running. */
  undecidedWithExportDate: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date `months` months after `iso`, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(iso: string, months: number): string | null {
  if (!ISO_DATE.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const targetMonthIndex = m - 1 + months;
  const lastDay = new Date(Date.UTC(y, targetMonthIndex + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(y, targetMonthIndex, Math.min(d, lastDay)));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function computeDeadlines(exportDate: string | null | undefined): Deadlines {
  const valid = exportDate && ISO_DATE.test(exportDate) ? exportDate : null;
  return {
    fxDeadline: valid ? `${Number(valid.slice(0, 4)) + 1}-04-30` : null,
    declareDeadline: valid ? addMonths(valid, 36) : null,
    retentionYears: 10,
    filingDays: 15,
  };
}

/** Item 6, the one that differs between the regimes. */
function invoiceState(regime: TaxRegime, files: DossierDocument[]): Pick<ItemState, "status" | "warning"> {
  if (files.length === 0) return { status: "missing" };
  const types = new Set(files.map((f) => f.fapiaoType ?? ""));
  const hasSpecial = types.has("special") || types.has("special_3");
  const hasOrdinary = types.has("ordinary_exempt");
  const hasNone = types.has("none");
  if (regime === "rebate") {
    if (hasSpecial) {
      return types.has("special_3") && !types.has("special")
        ? { status: "uploaded", warning: "special_3_cap" }
        : { status: "uploaded" };
    }
    if (hasNone) return { status: "risk", warning: "no_fapiao_deemed_domestic" };
    return { status: "risk", warning: "rebate_needs_special" };
  }
  if (regime === "exempt") {
    if (hasOrdinary) return { status: "uploaded" };
    if (hasSpecial) return { status: "uploaded", warning: "exempt_but_special" };
    if (hasNone) return { status: "risk", warning: "no_fapiao_deemed_domestic" };
    return { status: "uploaded" };
  }
  // Undecided: nothing to judge against yet, but "no fapiao" is a risk whatever comes.
  if (hasNone && !hasSpecial && !hasOrdinary) return { status: "risk", warning: "no_fapiao_deemed_domestic" };
  return { status: "uploaded" };
}

export function computeDossierStatus(
  order: { taxRegime: TaxRegime; exportDate: string | null; hasLines: boolean },
  documents: DossierDocument[],
): DossierStatus {
  const items: ItemState[] = DOSSIER_ITEMS.map((def) => {
    const files = documents.filter((d) => d.kind === def.key);
    if (def.key === "supplier_invoice") {
      return { n: def.n, key: def.key, files, ...invoiceState(order.taxRegime, files) };
    }
    if (files.length > 0) return { n: def.n, key: def.key, status: "uploaded", files };
    if (def.auto && order.hasLines) return { n: def.n, key: def.key, status: "auto", files };
    if (def.optional) return { n: def.n, key: def.key, status: "not_applicable", files };
    return { n: def.n, key: def.key, status: "missing", files };
  });
  const requiredItems = items.filter((i) => !DOSSIER_ITEMS[i.n - 1].optional);
  const uploaded = items.filter((i) => i.status === "uploaded" || i.status === "auto").length;
  const outstanding = requiredItems.filter((i) => i.status === "missing" || i.status === "risk").length;
  const undecided = order.taxRegime === "undecided";
  return {
    items,
    uploaded,
    required: requiredItems.length,
    outstanding,
    complete: !undecided && outstanding === 0,
    deadlines: computeDeadlines(order.exportDate),
    undecidedWithExportDate: undecided && !!order.exportDate,
  };
}

/** The zip's root folder: the declaration number the accountant files by, else the order. */
export function dossierFolderName(customsDeclarationNo: string | null | undefined, orderNumber: string): string {
  const no = (customsDeclarationNo ?? "").trim();
  if (CUSTOMS_NO.test(no)) return no;
  return `order_${orderNumber.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
}

/** "03_无纸化放行通知书_<original name>", with the name reduced to a bare file name. */
export function dossierFileName(item: DossierItem, originalName: string): string {
  const base = originalName.split(/[\\/]/).pop()?.trim() || "file";
  const safe = base.replace(/[\u0000-\u001f]/g, "").slice(0, 120);
  return `${String(item.n).padStart(2, "0")}_${item.zh}_${safe}`;
}
