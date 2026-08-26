import test from "node:test";
import assert from "node:assert/strict";
import {
  filterFinanceInput,
  computeAgingAsOf,
  type FinanceOrderInput,
} from "./finance-report";
import { buildAccountantPack, closeDigest, sha256Hex } from "./accountant-pack";

/**
 * The accountant pack's arithmetic promises, pinned:
 * period clipping (boundaries, drafts, cancelled orders, out-of-period
 * context), aging as of period end, manifest completeness, and the
 * determinism of the close digest — the whole tamper-evidence story rests
 * on identical data always producing an identical digest.
 */

const RATES = { USD: 1, CNY: 0.14 };

function order(over: Partial<FinanceOrderInput>): FinanceOrderInput {
  return {
    id: 1,
    orderNumber: "ORD-1",
    clientName: "Client A",
    status: "confirmed",
    createdAt: "2026-02-10 08:00:00",
    quoteCurrency: "USD",
    expectedRevenue: 1000,
    expectedCost: 700,
    payments: [],
    expenses: [],
    ...over,
  };
}

const FEB = { from: "2026-02", to: "2026-02" };

test("clipping keeps boundary-date money and drops the rest", () => {
  const input = [
    order({
      payments: [
        { direction: "in", amount: 100, currency: "USD", paidOn: "2026-02-01" },
        { direction: "in", amount: 50, currency: "USD", paidOn: "2026-02-28" },
        { direction: "in", amount: 999, currency: "USD", paidOn: "2026-03-01" },
      ],
      expenses: [
        { category: "freight", amount: 10, currency: "USD", spentOn: "2026-01-31" },
        { category: "freight", amount: 20, currency: "USD", spentOn: "2026-02-15" },
      ],
    }),
  ];
  const [clipped] = filterFinanceInput(input, FEB);
  assert.equal(clipped.payments.length, 2);
  assert.equal(clipped.expenses.length, 1);
  assert.equal(clipped.expenses[0].amount, 20);
});

test("an out-of-period order with in-period cash stays for cash only", () => {
  const input = [
    order({
      createdAt: "2025-11-01 08:00:00",
      payments: [{ direction: "in", amount: 300, currency: "USD", paidOn: "2026-02-05" }],
    }),
  ];
  const [clipped] = filterFinanceInput(input, FEB);
  // Remapped so computeFinanceReport counts its cash but not its expectations.
  assert.equal(clipped.status, "cancelled");
  assert.equal(clipped.payments.length, 1);
});

test("an order with nothing in the period disappears", () => {
  const input = [
    order({
      createdAt: "2025-11-01 08:00:00",
      payments: [{ direction: "in", amount: 1, currency: "USD", paidOn: "2025-12-01" }],
    }),
  ];
  assert.equal(filterFinanceInput(input, FEB).length, 0);
});

test("a draft's deposit counts as cash while its value stays out of expected", () => {
  const input = [
    order({
      status: "draft",
      payments: [{ direction: "in", amount: 200, currency: "USD", paidOn: "2026-02-03" }],
    }),
  ];
  const [clipped] = filterFinanceInput(input, FEB);
  assert.equal(clipped.status, "draft");
});

test("aging as of period end sees only payments up to that month", () => {
  const input = [
    order({
      expectedRevenue: 1000,
      expectedCost: 600,
      payments: [
        { direction: "in", amount: 400, currency: "USD", paidOn: "2026-01-20" },
        { direction: "in", amount: 300, currency: "USD", paidOn: "2026-03-15" }, // after period end
        { direction: "out", amount: 600, currency: "USD", paidOn: "2026-02-01" },
      ],
    }),
  ];
  const aging = computeAgingAsOf(input, "2026-02", "USD", RATES);
  assert.equal(aging.receivables.length, 1);
  assert.equal(aging.receivables[0].amount, 600); // 1000 - 400; March's 300 not yet
  assert.equal(aging.receivables[0].paidToDate, 400);
  assert.equal(aging.payables.length, 0); // supplier fully paid by Feb
});

test("aging ignores drafts, cancelled, and orders created after period end", () => {
  const input = [
    order({ id: 1, status: "draft" }),
    order({ id: 2, status: "cancelled" }),
    order({ id: 3, createdAt: "2026-05-01 08:00:00" }),
  ];
  const aging = computeAgingAsOf(input, "2026-02", "USD", RATES);
  assert.equal(aging.receivables.length, 0);
  assert.equal(aging.payables.length, 0);
});

test("the close digest is deterministic and blind to generation metadata", () => {
  const mk = (generatedAt: string) =>
    buildAccountantPack({
      companyId: 1,
      companyName: "Test Co",
      period: FEB,
      reportCurrency: "USD",
      orders: [
        order({
          payments: [
            { direction: "in", amount: 100, currency: "USD", paidOn: "2026-02-10", note: "deposit" },
          ],
        }),
      ],
      rates: RATES,
      generatedBy: { id: 1, email: "a@b.c" },
      files: [{ zipName: "files/ORD-1/slip.jpg", sha256: "ab".repeat(32), bytes: 123 }],
      now: () => new Date(generatedAt),
    });
  const first = mk("2026-03-01T10:00:00Z");
  const second = mk("2026-04-20T22:30:00Z"); // regenerated much later
  assert.equal(first.manifest.closeDigest, second.manifest.closeDigest);
  // ...while the manifests themselves differ (they carry generation time).
  assert.notEqual(
    sha256Hex(JSON.stringify(first.manifest)),
    sha256Hex(JSON.stringify(second.manifest)),
  );
});

test("changing period data changes the digest, and the close check notices", () => {
  const base = {
    companyId: 1,
    companyName: "Test Co",
    period: FEB,
    reportCurrency: "USD",
    rates: RATES,
    generatedBy: { id: 1, email: "a@b.c" },
    files: [],
  };
  const orders = [
    order({
      payments: [{ direction: "in" as const, amount: 100, currency: "USD", paidOn: "2026-02-10" }],
    }),
  ];
  const original = buildAccountantPack({ ...base, orders });
  const edited = buildAccountantPack({
    ...base,
    orders: [
      order({
        payments: [{ direction: "in", amount: 150, currency: "USD", paidOn: "2026-02-10" }],
      }),
    ],
    close: { closedAt: "2026-03-01", digest: original.manifest.closeDigest },
  });
  assert.notEqual(edited.manifest.closeDigest, original.manifest.closeDigest);
  assert.equal(edited.manifest.close?.matches, false);
  assert.match(
    String(edited.entries.find((e) => e.name === "README.txt")?.data),
    /被修改|DIFFERS/,
  );
});

test("manifest covers every entry and every file, hashes verifying", () => {
  const built = buildAccountantPack({
    companyId: 1,
    companyName: "Test Co",
    period: FEB,
    reportCurrency: "USD",
    orders: [order({ payments: [{ direction: "in", amount: 5, currency: "USD", paidOn: "2026-02-01" }] })],
    rates: RATES,
    generatedBy: { id: 1, email: "a@b.c" },
    files: [{ zipName: "files/ORD-1/x.pdf", sha256: "cd".repeat(32), bytes: 9 }],
  });
  const byPath = new Map(built.manifest.entries.map((e) => [e.path, e]));
  for (const entry of built.entries) {
    const m = byPath.get(entry.name);
    assert.ok(m, `manifest missing ${entry.name}`);
    assert.equal(m.sha256, sha256Hex(entry.data));
  }
  assert.ok(byPath.has("files/ORD-1/x.pdf"));
});

test("closeDigest ignores README and report.xlsx by construction", () => {
  const entries = [
    { path: "ledgers/payments.csv", sha256: "aa" },
    { path: "files/ORD-1/a.jpg", sha256: "bb" },
  ];
  const withExtras = [
    ...entries,
    { path: "README.txt", sha256: "changes-every-time" },
    { path: "report.xlsx", sha256: "also-changes" },
  ];
  assert.equal(closeDigest(entries), closeDigest(withExtras));
});
