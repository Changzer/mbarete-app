/**
 * An ISO timestamp as the phone's own wall clock, to the minute.
 *
 * Everything is stored as UTC ISO strings; showing those raw ("01:00" for a
 * 09:00 Yiwu capture) makes fresh data look stale and stale data look fresh —
 * on exactly the labels whose only job is saying how old something is.
 * Formatted by hand rather than toLocaleString so the shape is stable across
 * devices and both app languages.
 */
export function formatLocalMinute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
