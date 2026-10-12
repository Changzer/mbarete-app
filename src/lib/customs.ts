import { normalizeDecimalInput } from "@/lib/decimal-input";

/** Accept printed separators, but never turn arbitrary text into a code. */
export const normalizeHsCode = (value: string) => value.trim().replace(/[.\s]/g, "");
export const isHsCode = (value: string) => /^(?:\d{6}|\d{8})$/.test(normalizeHsCode(value));

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
export function draftExportFields(fields: Record<string, string>, proposedCode?: string): {
  hsCode: string | undefined;
  exportDestination: "" | "BR" | "PY";
  importDutyPctBr: number | null;
  importDutyPctPy: number | null;
} {
  return {
    hsCode: fields.hsCode ?? proposedCode,
    exportDestination: fields.exportDestination === "BR" || fields.exportDestination === "PY"
      ? fields.exportDestination : "" as const,
    importDutyPctBr: readDuty(fields.importDutyPctBr),
    importDutyPctPy: readDuty(fields.importDutyPctPy),
  };
}
