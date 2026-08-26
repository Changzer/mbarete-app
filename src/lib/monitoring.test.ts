import { test } from "node:test";
import assert from "node:assert/strict";
import { makeErrorLog } from "./monitoring";

test("errors deduplicate by defect, not by occurrence", () => {
  const log = makeErrorLog();
  const boom = new Error("db exploded");
  log.record("action /orders", boom);
  log.record("action /orders", boom);
  log.record("page /catalog", new Error("different thing"));
  const recent = log.recent(60_000);
  assert.equal(recent.length, 2);
  const dbErr = recent.find((e) => e.message === "db exploded");
  assert.equal(dbErr?.count, 2);
});

test("the first sighting alerts; repeats within the mute window do not", () => {
  const mails: string[] = [];
  const log = makeErrorLog({ mail: (subject) => mails.push(subject) });
  const boom = new Error("smtp down");
  for (let i = 0; i < 50; i += 1) log.record("action", boom);
  assert.equal(mails.length, 1);
  assert.match(mails[0], /smtp down/);
});

test("a storm of distinct errors is capped at five alerts an hour", () => {
  const mails: string[] = [];
  const log = makeErrorLog({ mail: (subject) => mails.push(subject) });
  for (let i = 0; i < 20; i += 1) log.record("action", new Error(`unique failure ${i}`));
  assert.equal(mails.length, 5);
});

test("the log is bounded and forgets the quietest defect first", () => {
  let clock = 0;
  const log = makeErrorLog({ now: () => clock });
  for (let i = 0; i < 250; i += 1) {
    clock = i;
    log.record("x", new Error(`e${i}`));
  }
  const all = log.recent(Infinity);
  assert.ok(all.length <= 200, `held ${all.length}`);
  // The earliest, quietest entries are the ones gone.
  assert.equal(all.some((e) => e.message === "e0"), false);
  assert.equal(all.some((e) => e.message === "e249"), true);
});

test("recent() windows by last occurrence", () => {
  let clock = 0;
  const log = makeErrorLog({ now: () => clock });
  log.record("a", new Error("old"));
  clock = 100_000;
  log.record("a", new Error("new"));
  const recent = log.recent(1000);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].message, "new");
});
