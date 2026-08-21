import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLocalMinute } from "./format-time";

test("formats to the minute in the machine's own zone", () => {
  const iso = "2026-04-20T09:30:45.123Z";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  assert.equal(
    formatLocalMinute(iso),
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  );
});

test("a timestamp that does not parse is shown as it is, never as NaN", () => {
  assert.equal(formatLocalMinute("not-a-date"), "not-a-date");
});
