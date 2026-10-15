import { roundMoney } from "@/lib/calculations";
import {
  CUSTOMS_UNIT_LABEL,
  DESTINATION_COUNTRIES,
  type CustomsUnit,
  type DestinationCountry,
} from "@/lib/customs";

/**
 * The customs pack: the five sheets a Chinese broker files an export with —
 * shipment summary (出货清单), commercial invoice, packing list, sales
 * contract and a draft declaration (报关单) — built from one order.
 *
 * This module is the arithmetic and the wording; customs-pack-xlsx.ts lays
 * it out. Nothing here invents a fact: what the order does not know (a
 * missing code, an unset port, net weight) prints blank or as recorded, and
 * `missing` names it so the button can say so before the download.
 */

export type CustomsPackLineInput = {
  nameZh: string;
  nameEn: string;
  cnHsCode: string;
  declarationElements: string;
  unit: CustomsUnit;
  quantity: number;
  unitPrice: number;
  amount: number;
  cartons: number | null;
  grossKg: number;
  cbm: number;
  /** The factory that invoices this line, in Chinese where known. */
  supplier: string;
};

export type CustomsPackInput = {
  docNo: string;
  /** YYYY-MM-DD; the contract's own date. */
  contractDate: string;
  /** YYYY-MM-DD or ""; loading, invoice and shipment date. */
  exportDate: string;
  customsDeclarationNo: string;
  companyName: string;
  addressLines: string[];
  phone: string;
  consignee: string;
  incoterms: string;
  paymentTerms: string[];
  notes: string;
  currency: string;
  portOfLoading: string;
  portOfDestination: string;
  destinationCountry: string;
  goodsOrigin: string;
  lines: CustomsPackLineInput[];
};

export type CustomsPackLine = CustomsPackLineInput & {
  unitEn: string;
  unitZh: string;
  /** Net weight is not recorded separately; it reads as the gross weight. */
  netKg: number;
};

export type CustomsPack = Omit<CustomsPackInput, "lines" | "companyName"> & {
  companyZh: string;
  companyEn: string;
  countryZh: string;
  countryEn: string;
  /** The invoicing factories, once each, in line order. */
  factories: string;
  /** The payment method as the invoice and declaration print it. */
  payment: string;
  lines: CustomsPackLine[];
  totals: {
    quantity: number;
    /** The shared unit when every line has one, else null. */
    unit: CustomsUnit | null;
    amount: number;
    cartons: number;
    grossKg: number;
    netKg: number;
    cbm: number;
  };
  missing: {
    /** Lines without China's 10-digit code. */
    cnHsCode: number;
    /** Lines without declaration elements. */
    declarationElements: number;
    /** Lines without a measured carton. */
    logistics: number;
    shipment: ("portOfLoading" | "portOfDestination" | "destinationCountry" | "goodsOrigin" | "exportDate")[];
  };
};

const CJK = /[㐀-鿿]/;

/**
 * The company name in each language. The profile holds one name, often
 * "义乌玻汭进出口有限公司 | Yiwu Mbarete Import Export Co. Ltd."; the
 * Chinese half goes on the declaration, the English half on the contract.
 */
export function splitCompanyName(name: string): { zh: string; en: string } {
  const parts = name.split(/\s*[|｜]\s*/).map((p) => p.trim()).filter(Boolean);
  const zh = parts.find((p) => CJK.test(p)) ?? "";
  const en = parts.find((p) => !CJK.test(p)) ?? "";
  return { zh: zh || name.trim(), en: en || name.trim() };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildCustomsPack(input: CustomsPackInput): CustomsPack {
  const { zh: companyZh, en: companyEn } = splitCompanyName(input.companyName);
  const country = DESTINATION_COUNTRIES[input.destinationCountry as DestinationCountry];

  const lines: CustomsPackLine[] = input.lines.map((l) => ({
    ...l,
    unitEn: CUSTOMS_UNIT_LABEL[l.unit].en,
    unitZh: CUSTOMS_UNIT_LABEL[l.unit].zh,
    netKg: l.grossKg,
  }));

  const factories = [...new Set(lines.map((l) => l.supplier.trim()).filter(Boolean))].join("、");
  const units = new Set(lines.map((l) => l.unit));

  const totals = {
    quantity: lines.reduce((s, l) => s + l.quantity, 0),
    unit: units.size === 1 ? [...units][0] : null,
    amount: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
    cartons: lines.reduce((s, l) => s + (l.cartons ?? 0), 0),
    grossKg: round3(lines.reduce((s, l) => s + l.grossKg, 0)),
    netKg: round3(lines.reduce((s, l) => s + l.netKg, 0)),
    cbm: round3(lines.reduce((s, l) => s + l.cbm, 0)),
  };

  const shipment: CustomsPack["missing"]["shipment"] = [];
  if (!input.portOfLoading) shipment.push("portOfLoading");
  if (!input.portOfDestination) shipment.push("portOfDestination");
  if (!country) shipment.push("destinationCountry");
  if (!input.goodsOrigin) shipment.push("goodsOrigin");
  if (!input.exportDate) shipment.push("exportDate");

  // "100% T/T" style terms read as TT on the declaration; anything else is
  // printed as the company wrote it.
  const firstTerm = input.paymentTerms[0] ?? "";
  const payment = /t\s*\/?\s*t/i.test(firstTerm) || firstTerm === "" ? "T/T" : firstTerm;

  const { companyName: _unused, ...rest } = input;
  void _unused;
  return {
    ...rest,
    companyZh,
    companyEn,
    countryZh: country?.zh ?? "",
    countryEn: country?.en ?? "",
    factories,
    payment,
    lines,
    totals,
    missing: {
      cnHsCode: lines.filter((l) => !/^\d{10}$/.test(l.cnHsCode)).length,
      declarationElements: lines.filter((l) => !l.declarationElements.trim()).length,
      logistics: lines.filter((l) => !(l.cbm > 0) || !(l.grossKg > 0)).length,
      shipment,
    },
  };
}
