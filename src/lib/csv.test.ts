import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "./csv";

test("formula-leading text is neutralized for spreadsheet readers", () => {
  const payloads = [
    "=1+1",
    "+SUM(A1)",
    "-1+2",
    "@SUM(A1)",
    "\t=1+1",
    "  =1+1",
    " \t@SUM(A1)",
  ];
  for (const payload of payloads) {
    assert.equal(csvCell(payload), `'${payload}`);
  }
  assert.equal(csvCell('=HYPERLINK("https://example.invalid","click")'), '"\'=HYPERLINK(""https://example.invalid"",""click"")"');
});

test("numbers and ordinary text keep their existing CSV representation", () => {
  assert.equal(csvCell(-1), "-1");
  assert.equal(csvCell(0), "0");
  assert.equal(csvCell("ordinary"), "ordinary");
  assert.equal(csvCell("price - final"), "price - final");
  assert.equal(csvCell("'=already-text"), "'=already-text");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("CSV quoting still covers separators, quotes, and line breaks", () => {
  assert.equal(csvCell('one, "two"'), '"one, ""two"""');
  assert.equal(toCsv([{ name: "ordinary", note: "two\nlines" }]), 'name,note\r\nordinary,"two\nlines"\r\n');
});
