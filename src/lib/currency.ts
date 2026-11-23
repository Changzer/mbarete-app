export function canonicalCurrencyCode(value: string): string {
  const code = value.trim().toUpperCase();
  return code === "RMB" ? "CNY" : code;
}

export function canonicalCurrencyRates(rates: Record<string, number>): Record<string, number> {
  const canonical: Record<string, number> = {};
  for (const [code, rate] of Object.entries(rates)) {
    if (code.trim().toUpperCase() !== "RMB") canonical[canonicalCurrencyCode(code)] = rate;
  }
  for (const [code, rate] of Object.entries(rates)) {
    if (code.trim().toUpperCase() === "RMB" && canonical.CNY === undefined) canonical.CNY = rate;
  }
  return canonical;
}
