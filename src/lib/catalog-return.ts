/**
 * Where the catalog sends you back to after an edit.
 *
 * Finding a product means a search, a category, a supplier, a sort — and
 * losing all of that on save meant finding it again. The catalog's view
 * state rides along to the edit page as one query string and comes back
 * with the redirect. Only the catalog's own keys survive the round trip,
 * with tight caps, so a crafted value can neither redirect elsewhere nor
 * inflate the URL.
 */

const KEYS = ["category", "supplier", "sort", "q", "open"] as const;
const MAX_LEN = 200;

/** The catalog query string, cleaned: "" or "category=3&q=light". */
export function catalogReturnQuery(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return "";
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  } catch {
    return "";
  }
  const out = new URLSearchParams();
  for (const key of KEYS) {
    const value = params.get(key);
    if (value === null || value === "") continue;
    if (key === "category" || key === "supplier" || key === "open") {
      if (!/^\d{1,12}$/.test(value)) continue;
    } else if (key === "sort") {
      if (value !== "price-asc") continue;
    }
    out.set(key, value.slice(0, MAX_LEN));
  }
  return out.toString();
}

/** The catalog href to land on after a save, toast included. */
export function catalogReturnHref(raw: unknown): string {
  const query = catalogReturnQuery(raw);
  return query ? `/catalog?${query}&saved=1` : "/catalog?saved=1";
}
