import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  hashSecret,
  newAssistantKey,
  parseAssistantKey,
  parseScopes,
  scopesText,
  secretMatches,
} from "./assistant-keys";
import { cardView, contactView, likePattern, matchesQuery, haystack, STAGE_NAMES, type CardInput } from "./assistant-views";
import { FOLLOWUP_STAGES } from "./followup-stages";

test("a key names its account and carries a secret that only its hash can check", () => {
  const { key, hash } = newAssistantKey(42);
  assert.match(key, /^mbk_42_[A-Za-z0-9_-]{43}$/);
  const parsed = parseAssistantKey(`Bearer ${key}`);
  assert.equal(parsed?.userId, 42);
  assert.equal(hashSecret(parsed!.secret), hash);
  assert.equal(secretMatches(parsed!.secret, hash), true);
  assert.equal(secretMatches(parsed!.secret, newAssistantKey(42).hash), false, "another key of the same account");
  assert.notEqual(newAssistantKey(42).key, key, "every key is new");
});

test("anything not exactly a bearer key is refused before a query runs", () => {
  const { key } = newAssistantKey(7);
  for (const header of [
    null,
    "",
    key,
    `bearer ${key}`,
    `Bearer  ${key}`,
    `Bearer ${key} x`,
    `Bearer ${key}x`,
    `Bearer ${key.replace("mbk_7_", "mbk_0_")}`,
    `Bearer ${key.replace("mbk_7_", "mbk_07_")}`,
    `Bearer ${key.replace("mbk_7_", "mbk_99999999999_")}`,
    `Bearer ${key.slice(0, -1)}!`,
    "Bearer mbk_7_" + "a".repeat(42),
  ]) {
    assert.equal(parseAssistantKey(header), null, String(header));
  }
});

test("scopes: only known ones, in one order, unknown ones never granted", () => {
  assert.deepEqual([...parseScopes("prices, followup,admin,,delete")], ["prices", "followup"]);
  assert.equal(scopesText(["prices", "contacts", "followup", "platform"]), "followup,contacts,prices");
  assert.equal(scopesText([]), "");
  assert.equal(parseScopes("").size, 0);
});

const supplierCard: CardInput = {
  id: 5,
  version: 3,
  kind: "supplier",
  stage: "deposit",
  orderId: 9,
  orderNumber: "ORD-20261022-123456",
  clientName: "Loja Azul",
  nextStep: "Pay deposit",
  nextDue: "2026-10-25",
  nextOwnerId: 2,
  problem: "",
  comments: 1,
  checklistDone: 1,
  checklistTotal: 3,
  touchedAt: "2026-10-22T10:00:00.000Z",
  supplierName: "义乌饰品",
  supplierNameAlt: "Yiwu Jewelry",
  mainProductName: "Bracelet",
  otherLines: 2,
  pieces: 1200,
  cost: [{ currency: "CNY", amount: 8400 }],
};

test("a card says what an assistant needs to act, and money only when prices are allowed", () => {
  const people = new Map([[2, "Lily"]]);
  const hidden = cardView(supplierCard, people, false);
  assert.equal("cost" in hidden, false);
  assert.deepEqual(hidden.nextOwner, { id: 2, name: "Lily" });
  assert.equal(hidden.version, 3);
  assert.deepEqual("stageName" in hidden && hidden.stageName, { en: "Deposit due", zh: "待付定金" });
  const shown = cardView(supplierCard, people, true);
  assert.deepEqual("cost" in shown && shown.cost, [{ currency: "CNY", amount: 8400 }]);
  assert.equal(JSON.stringify(hidden).includes("8400"), false);
});

test("stage names match what the board says in both languages", () => {
  const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8")).followup;
  const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8")).followup;
  for (const stage of FOLLOWUP_STAGES) {
    assert.equal(STAGE_NAMES[stage].en, en[`stage_${stage}`]);
    assert.equal(STAGE_NAMES[stage].zh, en[`stageAlt_${stage}`]);
    assert.equal(STAGE_NAMES[stage].zh, zh[`stage_${stage}`]);
  }
});

test("bank details never leave through a contact", () => {
  const view = contactView({
    id: 1,
    type: "supplier",
    companyName: "Yiwu Jewelry",
    companyNameZh: "义乌饰品",
    contactPerson: "王小姐",
    phone: "138",
    email: "",
    whatsapp: "",
    wechat: "wang",
    boothLocation: "F1-123",
    province: "浙江省",
    city: "义乌市",
    taxId: "",
    notes: "",
    active: true,
    ...({ bankInfo: "ICBC 6222 0000 1111" } as object),
  } as Parameters<typeof contactView>[0]);
  assert.equal(JSON.stringify(view).includes("6222"), false);
  assert.equal(view.nameZh, "义乌饰品");
});

test("searching: literal LIKE patterns, every word must appear", () => {
  assert.equal(likePattern("50%_off\\x"), "%50\\%\\_off\\\\x%");
  const text = haystack(["ORD-20261022-123456", "Loja Azul", "义乌饰品", null, "Bracelet"]);
  assert.equal(matchesQuery(text, "azul 123456"), true);
  assert.equal(matchesQuery(text, "义乌"), true);
  assert.equal(matchesQuery(text, "azul necklace"), false);
});

test("the OpenClaw skill file is a skill, names every stage, and holds no key", () => {
  const skill = fs.readFileSync("integrations/openclaw/mbarete/SKILL.md", "utf8");
  assert.match(skill, /^---\nname: mbarete\ndescription: .+\nmetadata: (\{.+\})\n---\n/);
  const metadata = JSON.parse(/^metadata: (\{.+\})$/m.exec(skill)![1]);
  assert.deepEqual(metadata.openclaw.requires.env, ["MBARETE_API_KEY"]);
  for (const stage of FOLLOWUP_STAGES) assert.ok(skill.includes(`\`${stage}\``), stage);
  assert.ok(skill.includes("{{ORIGIN}}/api/assistant/v1"));
  assert.doesNotMatch(skill, /mbk_\d/);
});
