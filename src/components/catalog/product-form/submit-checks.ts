import { isCnHsCode, isHsCode, readDuty } from "@/lib/customs";
import { supplierVatPctSchema } from "@/lib/validators";
import type { AiError, NcmError } from "./shared";

/**
 * The product form's decisions that need no screen: what the browser refuses
 * before sending, which required fields a refused save left empty, and which
 * message each outcome shows. Pure, so they are tested on their own.
 */

export type LocalProblem = {
  error: "invalid-supplier-vat" | "invalid-hs-code" | "invalid-cn-hs-code" | "invalid-duty";
  /** The field to put the cursor in. */
  focusId: string;
  /** The field lives in the folded export group, which must open to show it. */
  openExport: boolean;
};

/**
 * A save the server would refuse anyway, caught first. Checked in the order
 * the user would fix them; `duties` are the typed rates, both destinations.
 */
export function localProblem(formData: FormData, duties: string[]): LocalProblem | null {
  if (!supplierVatPctSchema.safeParse(formData.get("supplierVatPct")).success) {
    return { error: "invalid-supplier-vat", focusId: "supplierVatPct", openExport: false };
  }
  const hsCode = String(formData.get("hsCode") ?? "");
  if (hsCode.trim() !== "" && !isHsCode(hsCode)) {
    return { error: "invalid-hs-code", focusId: "hsCode", openExport: true };
  }
  const cnCode = String(formData.get("cnHsCode") ?? "");
  if (cnCode.trim() !== "" && !isCnHsCode(cnCode)) {
    return { error: "invalid-cn-hs-code", focusId: "cnHsCode", openExport: true };
  }
  if (duties.some((value) => value.trim() !== "" && readDuty(value) === null)) {
    return { error: "invalid-duty", focusId: "importDuty", openExport: true };
  }
  return null;
}

/** The required fields, in the order the form shows them. */
export const REQUIRED_FIELDS = ["nameEn", "nameZh", "moq", "qtyPerBox"] as const;

/**
 * The required fields a refused save found empty. Either name is enough, so
 * both light up only when both are blank. Price is deliberately absent: a
 * product photographed before the supplier has quoted saves at 0 and gets
 * priced when the quote lands — the floor is a name.
 */
export function emptyRequired(formData: FormData): Set<string> {
  const empty = new Set<string>();
  const nameEn = String(formData.get("nameEn") ?? "").trim();
  const nameZh = String(formData.get("nameZh") ?? "").trim();
  if (!nameEn && !nameZh) {
    empty.add("nameEn");
    empty.add("nameZh");
  }
  for (const field of ["moq", "qtyPerBox"]) {
    if (!String(formData.get(field) ?? "").trim()) empty.add(field);
  }
  return empty;
}

/** The catalog message for a save's error code; anything unknown reads as missing fields. */
export function saveErrorKey(code: string) {
  switch (code) {
    case "invalid-hs-code":
      return "errorHsCode";
    case "invalid-cn-hs-code":
      return "errorCnHsCode";
    case "invalid-supplier-vat":
      return "errorSupplierVat";
    case "invalid-duty":
      return "errorDuty";
    case "duplicate-sku":
      return "errorDuplicateSku";
    case "image-error":
      return "errorImage";
    case "limit-products":
      return "errorPlanLimit";
    default:
      return "errorRequiredFields";
  }
}

/** The catalog message for a photo read that produced nothing. */
export function readErrorKey(error: AiError | NcmError) {
  switch (error) {
    case "no-photos":
      return "aiErrorNoPhotos";
    case "limit":
      return "aiErrorLimit";
    case "none":
      return "suggestNcmNone";
    default:
      return "aiErrorFailed";
  }
}
