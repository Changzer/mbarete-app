import { test } from "node:test";
import assert from "node:assert/strict";
import { diffOrderEdit, type OrderChange } from "./order-log";

const sku = (id: number) => `SKU-${id}`;
const client = (id: number) => `Client ${id}`;

const base = { clientId: 1, commissionPct: 15, displayCurrency: "USD", notes: "" };
const line = (productId: number, quantity: number, sellPrice: number) => ({
  productId,
  quantity,
  sellPrice,
});

test("diff: identical orders produce no changes", () => {
  const changes = diffOrderEdit(base, [line(1, 10, 1.8)], base, [line(1, 10, 1.8)], sku, client);
  assert.deepEqual(changes, []);
});

test("diff: every head field is tracked with its old and new value", () => {
  const changes = diffOrderEdit(
    base,
    [],
    { clientId: 2, commissionPct: 10, displayCurrency: "CNY", notes: "urgent" },
    [],
    sku,
    client,
  );
  assert.deepEqual(changes, [
    { code: "client", from: "Client 1", to: "Client 2" },
    { code: "commission", from: 15, to: 10 },
    { code: "currency", from: "USD", to: "CNY" },
    { code: "notes" },
  ] satisfies OrderChange[]);
});

test("diff: line changes name the SKU and both values", () => {
  const changes = diffOrderEdit(
    base,
    [line(1, 10, 1.8), line(2, 5, 3)],
    base,
    [line(1, 20, 2.0), line(3, 7, 4)],
    sku,
    client,
  );
  assert.deepEqual(changes, [
    { code: "line_qty", sku: "SKU-1", from: 10, to: 20 },
    { code: "line_price", sku: "SKU-1", from: 1.8, to: 2.0 },
    { code: "line_added", sku: "SKU-3", qty: 7 },
    { code: "line_removed", sku: "SKU-2" },
  ] satisfies OrderChange[]);
});

test("diff: names are captured at diff time, not left as ids", () => {
  const changes = diffOrderEdit(base, [], { ...base, clientId: 9 }, [], sku, (id) =>
    id === 9 ? "Comercial Paraguay SA" : "Old Co",
  );
  assert.deepEqual(changes, [
    { code: "client", from: "Old Co", to: "Comercial Paraguay SA" },
  ]);
});
