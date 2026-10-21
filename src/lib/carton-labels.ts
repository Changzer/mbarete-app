/**
 * One label per carton of an order: what goes on the box the forwarder
 * receives — the order's marks, the carton's number out of all of them, the
 * product and how many pieces it holds. Cartons are numbered across the
 * order in line order, so "C/NO. 7/12" means the same box on every sheet.
 */

export type CartonLabelLine = {
  nameEn: string;
  nameZh: string;
  quantity: number;
  /** Cartons this line ships in; null or 0 when nobody measured them. */
  cartons: number | null;
  /** Pieces in a full carton; 0 when unknown. */
  perCarton: number;
};

export type CartonLabel = {
  no: number;
  of: number;
  nameEn: string;
  nameZh: string;
  /** Pieces in this carton; null when the carton size is unknown. */
  pieces: number | null;
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
      labels.push({ no: labels.length + 1, of, nameEn: line.nameEn, nameZh: line.nameZh, pieces });
    }
  }
  return { labels, unlabelled: lines.length - boxed.length };
}

/** The marks a label leads with: the order's own, else its number and destination. */
export function labelMarks(marks: string[], orderNumber: string, countryEn: string): string[] {
  if (marks.length > 0 && !(marks.length === 1 && marks[0] === "N/M")) return marks;
  return [orderNumber, countryEn.toUpperCase()].filter(Boolean);
}
