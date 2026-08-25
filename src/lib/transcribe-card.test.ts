import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeCardTranscription, type RawCardTranscription } from "./transcribe-card";

const raw = (overrides: Partial<RawCardTranscription>): RawCardTranscription => ({
  companyNameEn: null,
  companyNameZh: null,
  contactPerson: null,
  phone: null,
  email: null,
  whatsapp: null,
  wechat: null,
  boothLocation: null,
  bankInfo: null,
  notes: null,
  ...overrides,
});

test("a full card passes through, EN name landing on companyName", () => {
  const { fields, notes } = sanitizeCardTranscription(
    raw({
      companyNameEn: "YaoYao Accessories",
      companyNameZh: "瑶瑶饰品",
      contactPerson: "陈瑶 (Chen Yao)",
      phone: "18967955270 / 13646896166",
      boothLocation:
        "No.4642, Street 9, Area C, 2/F, District 1, Yiwu International Trade City (义乌国际商贸城一区2楼C区9街4642店)",
      bankInfo: "工商银行 — 陈云娟 — 6222 0312 0800 2746 705",
      notes: "WeChat QR on card back. Factory: 义乌市宾王路508号",
    }),
  );
  assert.equal(fields.companyName, "YaoYao Accessories");
  assert.equal(fields.companyNameZh, "瑶瑶饰品");
  assert.equal(fields.contactPerson, "陈瑶 (Chen Yao)");
  assert.equal(fields.phone, "18967955270 / 13646896166");
  assert.match(fields.boothLocation!, /4642/);
  assert.match(fields.bankInfo!, /陈云娟/);
  assert.match(notes!, /QR/);
});

test("nulls and blank strings become absent fields", () => {
  const { fields, notes } = sanitizeCardTranscription(raw({ wechat: "  ", email: "" }));
  assert.deepEqual(fields, {
    companyName: undefined,
    companyNameZh: undefined,
    taxId: undefined,
    contactPerson: undefined,
    phone: undefined,
    email: undefined,
    whatsapp: undefined,
    wechat: undefined,
    boothLocation: undefined,
    bankInfo: undefined,
  });
  assert.equal(notes, null);
});
