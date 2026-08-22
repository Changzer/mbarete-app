import { db, one } from "@/db";
import { companies, exchangeRates, exchangeRateHistory } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { runWithTenant } from "@/db/tenant-context";

/**
 * Automatic exchange rates.
 *
 * A chain of keyless providers is tried in order; the first that answers
 * wins. The default chain is overridable with the FOREX_PROVIDERS env var
 * (comma-separated URLs) because reachability differs by country — the NAS
 * sits behind the Chinese firewall, where Google is out and other hosts vary.
 * Both default providers speak the same shape: a JSON object with a `rates`
 * map of USD→currency multipliers.
 *
 * Manual entry stays as the fallback: a failed refresh changes nothing, and
 * the Settings page shows where each rate came from and how old it is.
 *
 * Rates are per company (each tenant owns its rate table and can hand-tune
 * it), but the day's market rates are the same for everyone — so the
 * scheduled refresh fetches once and writes the result for every company.
 */

/** The currencies refreshed automatically; anything else stays hand-entered. */
export const AUTO_CURRENCIES = ["USD", "CNY", "RMB", "BRL"] as const;

const DEFAULT_PROVIDERS = [
  "https://open.er-api.com/v6/latest/USD",
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,BRL",
];

export type RefreshResult =
  | { ok: true; source: string; rates: Record<string, number> }
  | { ok: false; error: string };

function providerUrls(): string[] {
  const fromEnv = process.env.FOREX_PROVIDERS?.split(",").map((u) => u.trim()).filter(Boolean);
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_PROVIDERS;
}

/**
 * Providers publish "1 USD buys N units"; the rate table stores the inverse,
 * "one unit is worth this many USD", because that is what conversion uses.
 */
function parseProviderBody(body: unknown): Record<string, number> | null {
  if (typeof body !== "object" || body === null) return null;
  const rates = (body as { rates?: unknown }).rates;
  if (typeof rates !== "object" || rates === null) return null;

  const out: Record<string, number> = { USD: 1 };
  const usdPer = rates as Record<string, unknown>;
  const cny = Number(usdPer["CNY"]);
  const brl = Number(usdPer["BRL"]);
  if (Number.isFinite(cny) && cny > 0) {
    out.CNY = 1 / cny;
    // RMB and CNY are one currency under two codes; both stay in step.
    out.RMB = 1 / cny;
  }
  if (Number.isFinite(brl) && brl > 0) out.BRL = 1 / brl;

  // A provider that answered but carried neither currency is no provider.
  return out.CNY !== undefined || out.BRL !== undefined ? out : null;
}

async function fetchFromProvider(url: string): Promise<Record<string, number> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    return parseProviderBody(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the provider chain for today's rates. Pure fetch, no writes. */
async function fetchDailyRates(): Promise<{
  rates: Record<string, number>;
  source: string;
} | null> {
  for (const url of providerUrls()) {
    const rates = await fetchFromProvider(url);
    if (rates) {
      let source: string;
      try {
        source = new URL(url).hostname;
      } catch {
        source = url;
      }
      return { rates, source };
    }
  }
  return null;
}

/** Write one day's fetched rates into one company's live table and history. */
async function writeRatesForCompany(
  companyId: number,
  rates: Record<string, number>,
  source: string,
) {
  // The scheduled refresh runs with no signed-in request behind it; adopt the
  // company being written so its RLS-guarded rate tables are reachable. (For
  // the Settings button this matches the caller's own tenant — requireAdmin
  // scoped it to the same id.)
  return runWithTenant(companyId, () => writeRatesScoped(companyId, rates, source));
}

async function writeRatesScoped(
  companyId: number,
  rates: Record<string, number>,
  source: string,
) {
  const now = new Date().toISOString();
  const day = now.slice(0, 10);

  for (const [currencyCode, rateToUsd] of Object.entries(rates)) {
    const scope = and(
      eq(exchangeRates.companyId, companyId),
      eq(exchangeRates.currencyCode, currencyCode),
    );
    const existing = await db.select().from(exchangeRates).where(scope).limit(1).then(one);
    if (existing) {
      await db
        .update(exchangeRates)
        .set({ rateToUsd, source: "auto", updatedAt: now })
        .where(scope);
    } else {
      await db
        .insert(exchangeRates)
        .values({ companyId, currencyCode, rateToUsd, source: "auto", updatedAt: now });
    }

    // One record per currency per day; a later fetch the same day wins.
    await db
      .insert(exchangeRateHistory)
      .values({ companyId, day, currencyCode, rateToUsd, source })
      .onConflictDoUpdate({
        target: [
          exchangeRateHistory.companyId,
          exchangeRateHistory.day,
          exchangeRateHistory.currencyCode,
        ],
        set: { rateToUsd, source },
      });
  }
}

/** Fetch the day's rates and write them for ONE company — the Settings button. */
export async function refreshExchangeRates(companyId: number): Promise<RefreshResult> {
  const fetched = await fetchDailyRates();
  if (!fetched) return { ok: false, error: "no provider reachable" };
  await writeRatesForCompany(companyId, fetched.rates, fetched.source);
  return { ok: true, source: fetched.source, rates: fetched.rates };
}

/** The scheduled refresh: one fetch, written for every company. */
export async function refreshExchangeRatesForAllCompanies(): Promise<RefreshResult> {
  const fetched = await fetchDailyRates();
  if (!fetched) return { ok: false, error: "no provider reachable" };
  const rows = await db.select({ id: companies.id }).from(companies);
  for (const row of rows) {
    await writeRatesForCompany(row.id, fetched.rates, fetched.source);
  }
  return { ok: true, source: fetched.source, rates: fetched.rates };
}

const STARTED = Symbol.for("mbarete.forex.autorefresh");

/**
 * Refresh on boot and every six hours after. Failures are logged and cost
 * nothing: the last known rates stay in force, exactly as if they had been
 * typed by hand. Guarded so hot reloads do not stack intervals.
 */
export function startForexAutoRefresh() {
  const g = globalThis as Record<symbol, unknown>;
  if (g[STARTED]) return;
  g[STARTED] = true;

  const run = async () => {
    const result = await refreshExchangeRatesForAllCompanies();
    if (result.ok) {
      console.log(`[forex] rates refreshed from ${result.source}`);
    } else {
      console.log(`[forex] refresh failed (${result.error}) — keeping current rates`);
    }
  };

  void run();
  setInterval(run, 6 * 60 * 60 * 1000);
}
