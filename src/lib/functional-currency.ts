import type { CurrencyRates } from "@/lib/calculations";
import { canonicalCurrencyCode, canonicalCurrencyRates } from "@/lib/currency";

/**
 * The currency profit is real in — the one an order result and the finance
 * report open in. A company that sources in China earns its margin in
 * CNY whatever it bills the client in; a Brazilian importer's is real in
 * BRL. It is a Settings choice; until made, the fallback is CNY, then USD.
 */
const FALLBACKS = ["CNY", "USD"];

export function resolveFunctionalCurrency(
  setting: string | null | undefined,
  rates: CurrencyRates,
): string {
  const chosen = canonicalCurrencyCode(setting ?? "");
  const canonicalRates = canonicalCurrencyRates(rates);
  if (chosen && canonicalRates[chosen] !== undefined) return chosen;
  for (const code of FALLBACKS) if (canonicalRates[code] !== undefined) return code;
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
  const code = canonicalCurrencyCode(requested ?? "");
  return code && canonicalCurrencyRates(rates)[code] !== undefined ? code : canonicalCurrencyCode(fallback);
}
