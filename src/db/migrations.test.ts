import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The migration journal and the SQL files are maintained BY HAND
 * (drizzle/README.md) — this is the tripwire for the two ways that goes
 * wrong: a .sql file added without a journal entry never runs anywhere,
 * and a journal entry without its file crashes every boot.
 */

const dir = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string; when: number }[];
};
const sqlFiles = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .sort();

test("every migration file has a journal entry and vice versa", () => {
  const tags = journal.entries.map((e) => e.tag).sort();
  assert.deepEqual(sqlFiles, tags);
});

test("journal entries are strictly ordered — idx and timestamps both", () => {
  for (let i = 1; i < journal.entries.length; i += 1) {
    const prev = journal.entries[i - 1];
    const cur = journal.entries[i];
    assert.equal(cur.idx, prev.idx + 1, `idx gap at ${cur.tag}`);
    assert.ok(cur.when > prev.when, `non-increasing 'when' at ${cur.tag}`);
  }
});
