import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffContactEdit, diffProductEdit } from "./entity-log";

const contact = {
  companyName: "YaoYao Accessories",
  companyNameZh: "瑶瑶饰品",
  contactPerson: "陈瑶 (Chen Yao)",
  phone: "13512345678",
  email: "yao@example.com",
  whatsapp: "",
  wechat: "yao888",
  boothLocation: "District 1, 2/F",
  bankInfo: "工商银行 — 陈云娟 — 6222 0312",
  notes: "",
};

describe("diffContactEdit", () => {
  it("returns nothing when nothing changed", () => {
    assert.deepEqual(diffContactEdit(contact, { ...contact }), []);
  });

  it("captures a blanked bank account with its old value", () => {
    const changes = diffContactEdit(contact, { ...contact, bankInfo: "" });
    assert.deepEqual(changes, [
      { field: "bankInfo", from: "工商银行 — 陈云娟 — 6222 0312", to: "" },
    ]);
  });

  it("reports several fields at once", () => {
    const changes = diffContactEdit(contact, {
      ...contact,
      phone: "13500000000",
      wechat: "",
    });
    assert.deepEqual(
      changes.map((c) => c.field),
      ["phone", "wechat"],
    );
  });

  it("marks notes as changed without keeping the text", () => {
    const changes = diffContactEdit(contact, { ...contact, notes: "long private note" });
    assert.deepEqual(changes, [{ field: "notes" }]);
  });

  it("ignores whitespace-only differences", () => {
    assert.deepEqual(diffContactEdit(contact, { ...contact, phone: " 13512345678 " }), []);
  });

  it("clips very long values", () => {
    const changes = diffContactEdit(contact, { ...contact, boothLocation: "x".repeat(500) });
    assert.equal(changes.length, 1);
    assert.ok(changes[0].to!.length <= 120);
    assert.ok(changes[0].to!.endsWith("…"));
  });
});

const product = {
  sku: "MB-0042",
  supplierCode: "AA012604240",
  nameEn: "Scented Candle",
  nameZh: "香薰蜡烛",
  categoryId: 1,
  descriptionEn: "",
  descriptionZh: "",
  price: 12.5,
  sellPrice: 20,
  currency: "RMB",
  moq: 100,
  qtyPerBox: 24,
  lengthCm: 40,
  widthCm: 30,
  heightCm: 30,
  weightKg: 8,
  supplierId: 7 as number | null,
  active: true,
};

const categoryNameOf = (id: number) => (id === 1 ? "Candles" : "Decor");
const supplierNameOf = (id: number | null) => (id === 7 ? "Artemis" : id === 9 ? "YaoYao" : "—");

describe("diffProductEdit", () => {
  it("returns nothing when nothing changed", () => {
    assert.deepEqual(diffProductEdit(product, { ...product }, categoryNameOf, supplierNameOf), []);
  });

  it("resolves category and supplier ids to names", () => {
    const changes = diffProductEdit(
      product,
      { ...product, categoryId: 2, supplierId: 9 },
      categoryNameOf,
      supplierNameOf,
    );
    assert.deepEqual(changes, [
      { field: "category", from: "Candles", to: "Decor" },
      { field: "supplier", from: "Artemis", to: "YaoYao" },
    ]);
  });

  it("shows a currency switch as a price change", () => {
    const changes = diffProductEdit(
      product,
      { ...product, currency: "USD" },
      categoryNameOf,
      supplierNameOf,
    );
    assert.deepEqual(
      changes.map((c) => c.field),
      ["price", "sellPrice"],
    );
    assert.equal(changes[0].from, "12.5 RMB");
    assert.equal(changes[0].to, "12.5 USD");
  });

  it("reports a deactivation as its own entry", () => {
    const changes = diffProductEdit(
      product,
      { ...product, active: false },
      categoryNameOf,
      supplierNameOf,
    );
    assert.deepEqual(changes, [{ field: "deactivated" }]);
  });

  it("groups carton dimensions into one change", () => {
    const changes = diffProductEdit(
      product,
      { ...product, lengthCm: 50 },
      categoryNameOf,
      supplierNameOf,
    );
    assert.deepEqual(changes, [
      { field: "dimensions", from: "40×30×30 cm", to: "50×30×30 cm" },
    ]);
  });

  it("marks description edits without keeping the text", () => {
    const changes = diffProductEdit(
      product,
      { ...product, descriptionEn: "new text" },
      categoryNameOf,
      supplierNameOf,
    );
    assert.deepEqual(changes, [{ field: "description" }]);
  });
});
