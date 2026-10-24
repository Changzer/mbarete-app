import type { TranscribedFields } from "@/lib/transcribe-product";

/**
 * Writes a photo reading into the form's own text inputs. The text fields
 * are uncontrolled on purpose, so the reading lands in them directly; the
 * fields held in state (currency, per carton, category) are the caller's.
 *
 * Fills what the user has not touched: empty fields, plus those still on a
 * pristine default (MOQ 1). Anything already typed is theirs and stays —
 * unless `overwrite`: an automatic run (photos just added) must never clobber
 * what the agent already typed, but an explicit press of "Fill from photos"
 * is the agent ASKING for the reading — on the edit page every field already
 * holds its stored value, so without overwrite the button would visibly do
 * nothing.
 */
export function writeReading(form: HTMLFormElement, fields: TranscribedFields, overwrite: boolean) {
  const setIfUntouched = (name: string, value: string | number | undefined, pristine: string[] = []) => {
    if (value === undefined) return;
    const el = form.elements.namedItem(name);
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.matches(":disabled")) return;
    if (!overwrite && el.value.trim() !== "" && !pristine.includes(el.value.trim())) return;
    el.value = String(value);
  };

  setIfUntouched("supplierCode", fields.supplierCode);
  setIfUntouched("hsCode", fields.hsCode);
  setIfUntouched("cnHsCode", fields.cnHsCode);
  setIfUntouched("declarationElements", fields.declarationElements);
  setIfUntouched("nameEn", fields.nameEn);
  setIfUntouched("nameZh", fields.nameZh);
  setIfUntouched("descriptionEn", fields.descriptionEn);
  setIfUntouched("descriptionZh", fields.descriptionZh);
  setIfUntouched("price", fields.price);
  setIfUntouched("moq", fields.moq, ["1"]);
  // Carton figures off the board. Inactive measurement fields stay mounted
  // to preserve edits, but are disabled and ignored by the fill helper.
  setIfUntouched("lengthCm", fields.lengthCm);
  setIfUntouched("widthCm", fields.widthCm);
  setIfUntouched("heightCm", fields.heightCm);
  setIfUntouched("weightKg", fields.weightKg);
  // A CBM beside three read dimensions is never taken: the dimensions
  // compute it, and an invented figure here would override them on save.
  if (!(fields.lengthCm && fields.widthCm && fields.heightCm)) {
    setIfUntouched("cbmOverride", fields.cbm);
  }
}

/** The value a named input of the form currently holds ("" when there is none). */
export function inputValue(form: HTMLFormElement | null, name: string): string {
  const el = form?.elements.namedItem(name);
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : "";
}
