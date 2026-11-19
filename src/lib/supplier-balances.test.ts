import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSupplierBalances } from "./supplier-balances";

const line = (supplierId: number, lineTotal: number, currency = "CNY") => ({
  supplierId,
  supplierName: `Supplier ${supplierId}`,
  lineTotal,
  currency,
});

test("mixed orders keep each supplier's cost, paid and balance separate", () => {
  const result = computeSupplierBalances(
    [line(1, 1000), line(1, 500), line(2, 300)],
    [
      { supplierId: 1, amount: 400, currency: "CNY" },
      { supplierId: 2, amount: 300, currency: "CNY" },
    ],
    {},
  );
  assert.deepEqual(result[0].currencies[0], {
    currency: "CNY", cost: 1500, paid: 400, balance: 1100, unconvertible: [],
  });
  assert.deepEqual(result[1].currencies[0], {
    currency: "CNY", cost: 300, paid: 300, balance: 0, unconvertible: [],
  });
});

test("overpayment stays negative rather than disappearing", () => {
  const result = computeSupplierBalances([line(1, 100)], [{ supplierId: 1, amount: 150, currency: "CNY" }], {});
  assert.equal(result[0].currencies[0].balance, -50);
});

test("payments convert at their own frozen rates", () => {
  const result = computeSupplierBalances(
    [line(1, 1000)],
    [{ supplierId: 1, amount: 100, currency: "USD", rates: { USD: 1, CNY: 1 / 7 } }],
    { CNY: 1 / 6.5 },
  );
  assert.equal(result[0].currencies[0].paid, 700);
  assert.equal(result[0].currencies[0].balance, 300);
});

test("an unconvertible payment is named and never counted as paid zero silently", () => {
  const result = computeSupplierBalances([line(1, 1000)], [{ supplierId: 1, amount: 100, currency: "USD" }], {});
  assert.equal(result[0].currencies[0].paid, 0);
  assert.deepEqual(result[0].currencies[0].unconvertible, [{ amount: 100, currency: "USD" }]);
  assert.equal(result[0].currencies[0].balance, 1000);
});

test("multiple cost currencies and unassigned payments remain explicit", () => {
  const result = computeSupplierBalances(
    [line(1, 100, "CNY"), { ...line(1, 50, "USD") }],
    [{ supplierId: null, amount: 25, currency: "CNY" }],
    {},
  );
  assert.equal(result[0].currencies.length, 2);
  assert.equal(result[1].supplierId, null);
  assert.equal(result[1].currencies[0].paid, 25);
  assert.equal(result[1].currencies[0].balance, -25);
});

test("a payment-only supplier can use the caller's historical name map", () => {
  const result = computeSupplierBalances([], [{ supplierId: 7, amount: 20, currency: "CNY" }], {}, { 7: "Old supplier" });
  assert.equal(result[0].name, "Old supplier");
  assert.equal(result[0].currencies[0].cost, 0);
});
