import type { CurrencyRates } from "@/lib/calculations";

/**
 * The currency profit is real in — the one an order result and the finance
 * report open in. A company that sources in China earns its margin in
 * RMB whatever it bills the client in; a Brazilian importer's is real in
 * BRL. It is a Settings choice; until made, the fallback is the RMB code
 * the rate table carries (CNY, or the RMB alias), then the USD peg.
 */
const FALLBACKS = ["CNY", "RMB", "USD"];

export function resolveFunctionalCurrency(
  setting: string | null | undefined,
  rates: CurrencyRates,
): string {
  const chosen = (setting ?? "").trim().toUpperCase();
  if (chosen && rates[chosen] !== undefined) return chosen;
  for (const code of FALLBACKS) if (rates[code] !== undefined) return code;
  return "USD";
}

/**
 * The currency a page shows its converted figures in: the query string's
 * pick when the rate table knows it, else the fallback. Unknown codes fall
 * back rather than error — a stale link must still open the page.
 */
export function pickReportCurrency(
  requested: string | null | undefined,
  fallback: string,
  rates: CurrencyRates,
): string {
  const code = (requested ?? "").trim().toUpperCase();
  return code && rates[code] !== undefined ? code : fallback;
}
