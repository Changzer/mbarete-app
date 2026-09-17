import { normalizeDecimalInput } from "@/lib/decimal-input";

/** Accept printed separators, but never turn arbitrary text into a code. */
export const normalizeHsCode = (value: string) => value.trim().replace(/[.\s]/g, "");
export const isHsCode = (value: string) => /^(?:\d{6}|\d{8})$/.test(normalizeHsCode(value));

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
