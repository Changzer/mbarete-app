/**
 * One label per carton of an order: what goes on the box the forwarder
 * receives — the order's marks, the carton's number out of all of them, the
 * product, how many pieces it holds and what it weighs, and where it goes.
 * Cartons are numbered across the order in line order, so "C/NO. 7/12"
 * means the same box on every sheet.
 *
 * The carton figures are the line's own (as quoted, or as the factory packed
 * them once entered on the order), so the labels, the packing list and the
 * customs pack always count the same boxes.
 */

export type CartonLabelLine = {
  nameEn: string;
  nameZh: string;
  quantity: number;
  /** Cartons this line ships in; null or 0 when nobody measured them. */
  cartons: number | null;
  /** Pieces in a full carton; 0 when unknown. */
  perCarton: number;
  /** A full carton's gross weight and volume; 0 or absent when unknown. */
  cartonKg?: number;
  cartonCbm?: number;
};

export type CartonLabel = {
  no: number;
  of: number;
  nameEn: string;
  nameZh: string;
  /** Pieces in this carton; null when the carton size is unknown. */
  pieces: number | null;
  /** Gross weight of this carton; the last, part-full one weighs its share, as on the packing list. */
  grossKg: number | null;
  cbm: number | null;
};

export function cartonLabels(lines: CartonLabelLine[]): { labels: CartonLabel[]; unlabelled: number } {
  const boxed = lines.filter((l) => (l.cartons ?? 0) > 0);
  const of = boxed.reduce((sum, l) => sum + (l.cartons ?? 0), 0);
  const labels: CartonLabel[] = [];
  for (const line of boxed) {
    const cartons = line.cartons ?? 0;
    for (let k = 1; k <= cartons; k += 1) {
      // Full cartons first; the last one holds whatever is left.
      const pieces =
        line.perCarton > 0
          ? k < cartons
            ? line.perCarton
            : Math.max(0, line.quantity - line.perCarton * (cartons - 1))
          : null;
      const kg = line.cartonKg && line.cartonKg > 0 ? line.cartonKg : null;
      const grossKg =
        kg === null ? null : pieces !== null && line.perCarton > 0 ? Math.round((kg * pieces) / line.perCarton * 10) / 10 : kg;
      const cbm = line.cartonCbm && line.cartonCbm > 0 ? line.cartonCbm : null;
      labels.push({ no: labels.length + 1, of, nameEn: line.nameEn, nameZh: line.nameZh, pieces, grossKg, cbm });
    }
  }
  return { labels, unlabelled: lines.length - boxed.length };
}

/** The marks a label leads with: the order's own, else its number and destination. */
export function labelMarks(marks: string[], orderNumber: string, countryEn: string): string[] {
  if (marks.length > 0 && !(marks.length === 1 && marks[0] === "N/M")) return marks;
  return [orderNumber, countryEn.toUpperCase()].filter(Boolean);
}

/** A typed address block as it prints: trimmed lines, blanks dropped, at most `max`. */
export function addressLines(text: string, max = 4): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * The final destination when the order names none: the client as the order
 * records them — name, address and country.
 */
export function clientConsignee(client: { companyName: string; address: string; countryEn: string }): string {
  return [client.companyName, ...addressLines(client.address, 3), client.countryEn.toUpperCase()]
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}
