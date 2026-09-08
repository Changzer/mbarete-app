/**
 * Order lines grouped by the supplier they come from, in the order the
 * suppliers first appear, with the lines that have no supplier last. The
 * lines inside a group keep their order. Pure, so the detail page and any
 * document that wants the same grouping agree.
 */
export type SupplierGroup<T> = {
  /** null for the lines whose product has no supplier recorded */
  supplierId: number | null;
  supplierName: string | null;
  rows: T[];
};

export function groupBySupplier<T extends { supplierId: number | null; supplierName: string | null }>(
  rows: T[],
): SupplierGroup<T>[] {
  const groups = new Map<number | null, SupplierGroup<T>>();
  for (const row of rows) {
    const key = row.supplierId;
    let group = groups.get(key);
    if (!group) {
      group = { supplierId: key, supplierName: row.supplierName, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  const ordered = [...groups.values()];
  const unknown = ordered.findIndex((g) => g.supplierId === null);
  if (unknown >= 0) ordered.push(...ordered.splice(unknown, 1));
  return ordered;
}
