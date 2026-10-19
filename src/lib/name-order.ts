/**
 * Alphabetical order for names in a list, the way a person reads one: case
 * and accents ignored, numbers by value (8.5-inch before 10-inch), and
 * dashes, slashes and underscores read as a space, so "FREE- Battery" sits
 * with "FREE - Charger" whatever the spacing. Chinese sorts by pinyin.
 */
export function compareNames(locale: string): (a: string, b: string) => number {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const key = (name: string) => name.replace(/\s*[-–—_/]+\s*/g, " ").replace(/\s+/g, " ").trim();
  return (a, b) => collator.compare(key(a), key(b));
}

/** A sorted copy by name; equal names keep a stable order by id. */
export function sortByName<T extends { id: number }>(
  items: T[],
  nameOf: (item: T) => string,
  locale: string,
): T[] {
  const compare = compareNames(locale);
  return [...items].sort((a, b) => compare(nameOf(a), nameOf(b)) || a.id - b.id);
}
