/**
 * Phone keyboards in comma-decimal locales (pt-BR among them) put a comma on
 * the decimal key, and <input type="number"> silently submits "" for a value
 * it cannot parse — a typed weight would vanish into "not recorded". So the
 * decimal fields are plain text inputs, normalized here on the client (for
 * the live carton estimate) and again server-side before validation.
 */
export function normalizeDecimalInput(value: string): string {
  const trimmed = value.trim();
  // Comma groups of exactly three digits are thousands separators: "1,200"
  // is 1200, not 1.2 — the difference between a scooter and a keychain.
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) return trimmed.replace(/,/g, "");
  // Otherwise a comma is a decimal separator: "10,20" -> "10.20".
  return trimmed.replace(",", ".");
}
