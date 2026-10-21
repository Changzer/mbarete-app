import { normalizeDecimalInput } from "@/lib/decimal-input";

/** Accept printed separators, but never turn arbitrary text into a code. */
export const normalizeHsCode = (value: string) => value.trim().replace(/[.\s]/g, "");
export const isHsCode = (value: string) => /^(?:\d{6}|\d{8})$/.test(normalizeHsCode(value));

/** China's own export tariff code: 10 digits, printed without separators. */
export const isCnHsCode = (value: string) => /^\d{10}$/.test(normalizeHsCode(value));

/** The units a quantity is declared in, with the Chinese the declaration uses. */
export const CUSTOMS_UNITS = ["pcs", "set", "pair"] as const;
export type CustomsUnit = (typeof CUSTOMS_UNITS)[number];
export const CUSTOMS_UNIT_LABEL: Record<CustomsUnit, { en: string; zh: string }> = {
  pcs: { en: "PCS", zh: "个" },
  set: { en: "SET", zh: "套" },
  pair: { en: "PAIR", zh: "双" },
};

/**
 * The code as customs paperwork prints it: the 8-digit Mercosur NCM as
 * 0000.00.00, a 6-digit HS subheading as 0000.00, anything else as "".
 */
export function formatNcm(value: string | null | undefined): string {
  const digits = normalizeHsCode(value ?? "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
  if (/^\d{6}$/.test(digits)) return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  return "";
}

/** An explicit zero is meaningful; an empty field is unknown. */
export function readDuty(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(normalizeDecimalInput(String(value)));
  return Number.isFinite(number) && number >= 0 && number <= 200 ? number : null;
}

/** Only user-entered rates become product defaults. AI rates remain suggestions. */
export function draftExportFields(
  fields: Record<string, string>,
  proposedCode?: string,
  proposedCn?: { cnHsCode?: string; declarationElements?: string },
): {
  hsCode: string | undefined;
  cnHsCode?: string;
  declarationElements?: string;
  customsUnit?: CustomsUnit;
  exportDestination: "" | "BR" | "PY";
  importDutyPctBr: number | null;
  importDutyPctPy: number | null;
} {
  // Codes and elements are classifications to proofread, like the NCM:
  // what was typed wins, else the reading proposes. Absent keys stay absent
  // so they never overwrite another default with nothing.
  const cnHsCode = fields.cnHsCode ?? proposedCn?.cnHsCode;
  const declarationElements = fields.declarationElements ?? proposedCn?.declarationElements;
  const customsUnit = (CUSTOMS_UNITS as readonly string[]).includes(fields.customsUnit ?? "")
    ? (fields.customsUnit as CustomsUnit)
    : undefined;
  return {
    hsCode: fields.hsCode ?? proposedCode,
    ...(cnHsCode !== undefined ? { cnHsCode } : {}),
    ...(declarationElements !== undefined ? { declarationElements } : {}),
    ...(customsUnit ? { customsUnit } : {}),
    exportDestination: fields.exportDestination === "BR" || fields.exportDestination === "PY"
      ? fields.exportDestination : "" as const,
    importDutyPctBr: readDuty(fields.importDutyPctBr),
    importDutyPctPy: readDuty(fields.importDutyPctPy),
  };
}

/**
 * Countries of destination the customs pack names, with the Chinese the
 * 报关单 prints (运抵国 / 最终目的国) and the English the contract prints.
 */
export const DESTINATION_COUNTRIES = {
  BR: { en: "Brazil", zh: "巴西" },
  PY: { en: "Paraguay", zh: "巴拉圭" },
  UY: { en: "Uruguay", zh: "乌拉圭" },
  AR: { en: "Argentina", zh: "阿根廷" },
  CL: { en: "Chile", zh: "智利" },
  BO: { en: "Bolivia", zh: "玻利维亚" },
  PE: { en: "Peru", zh: "秘鲁" },
} as const;
export type DestinationCountry = keyof typeof DESTINATION_COUNTRIES;
export const DESTINATION_COUNTRY_CODES = Object.keys(DESTINATION_COUNTRIES) as DestinationCountry[];

/**
 * A supplier's province and city read from their booth: Yiwu's markets
 * declare as Yiwu (customs takes the place of the earliest purchase when the
 * factory is unknown). Anything else is left for a person or a card to say.
 */
export function regionFromBooth(booth: string): { province: string; city: string } {
  return /义乌|yiwu/i.test(booth) ? { province: "浙江省", city: "义乌市" } : { province: "", city: "" };
}
