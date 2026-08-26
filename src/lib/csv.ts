/**
 * The one CSV writer. Extracted from the backup route so the accountant
 * pack and the backup speak identical CSV: CRLF line ends (Excel on the
 * accountant's Windows machine is the reader), quoted only when a value
 * needs it, objects as JSON.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], omit: string[] = []): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]).filter((c) => !omit.includes(c));
  const lines = [cols.join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => csvCell(row[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
