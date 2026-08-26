import crypto from "node:crypto";
import {
  computeFinanceReport,
  filterFinanceInput,
  computeAgingAsOf,
  type FinanceOrderInput,
  type Period,
} from "@/lib/finance-report";
import { convert, UnknownCurrencyError, roundMoney, type CurrencyRates } from "@/lib/calculations";
import { toCsv } from "@/lib/csv";

/**
 * The accountant pack: one period, one ZIP — reports plus the evidence
 * files they reference, with a manifest that makes tampering visible.
 *
 * This module is deliberately pure: it takes data in and returns the
 * entries to archive. The route owns auth, file reading and streaming, so
 * every number and every hash in here is unit-testable without a database.
 *
 * NOT accounting software: no ledger, no vouchers, no tax math. The job is
 * to hand the tenant's 代理记账 accountant the best-organized evidence
 * locker they have ever received, in a shape 用友/金蝶 users recognize.
 */

/** A file to carry into the pack, already read and hashed by the caller. */
export type PackFile = {
  /** zip path under files/, e.g. "files/ORD-123/slip-1.jpg" */
  zipName: string;
  sha256: string;
  bytes: number;
};

export type PackEntry = { name: string; data: string | Buffer };

export type PackManifest = {
  version: 1;
  companyId: number;
  period: Period;
  reportCurrency: string;
  generatedAt: string;
  generatedBy: { id: number; email: string };
  /** Deterministic digest of the period's DATA — see closeDigest(). */
  closeDigest: string;
  close?: { closedAt: string; matches: boolean };
  entries: { path: string; sha256: string; bytes: number }[];
};

export const sha256Hex = (data: string | Buffer) =>
  crypto.createHash("sha256").update(data).digest("hex");

/**
 * The tamper-evidence anchor. Deliberately NOT the hash of manifest.json:
 * the manifest embeds generation time and requester, so its hash would
 * differ on every regeneration and the close check would always cry wolf.
 * Instead: sha256 over the sorted `path:sha256` lines of the ledgers and
 * evidence files only — identical period data yields an identical digest,
 * whoever generates the pack and whenever. README.txt, report.xlsx and the
 * manifest itself stay out (they carry timestamps by design).
 */
export function closeDigest(entries: { path: string; sha256: string }[]): string {
  const lines = entries
    .filter((e) => e.path.startsWith("ledgers/") || e.path.startsWith("files/"))
    .map((e) => `${e.path}:${e.sha256}`)
    .sort();
  return sha256Hex(lines.join("\n"));
}

const fmt = (n: number) => roundMoney(n).toFixed(2);

/** Converts on the same rule the report uses; unknown currencies become 0. */
function makeConv(reportCurrency: string, rates: CurrencyRates) {
  return (amount: number, from: string, own?: CurrencyRates) => {
    try {
      const table = own && own[reportCurrency] !== undefined ? own : rates;
      return convert(amount, from, reportCurrency, table);
    } catch (err) {
      if (err instanceof UnknownCurrencyError) return 0;
      throw err;
    }
  };
}

export type BuildPackInput = {
  companyId: number;
  companyName: string;
  period: Period;
  reportCurrency: string;
  /** UNCLIPPED report input — clipping happens in here, on the shared path. */
  orders: FinanceOrderInput[];
  rates: CurrencyRates;
  generatedBy: { id: number; email: string };
  /** Evidence files the route resolved and hashed, keyed by zip path. */
  files: PackFile[];
  /** The recorded close for this exact period, when one exists. */
  close?: { closedAt: string; digest: string };
  now?: () => Date;
};

export type BuiltPack = {
  /** Text/buffer entries, README first, manifest last — archive in order. */
  entries: PackEntry[];
  manifest: PackManifest;
  report: ReturnType<typeof computeFinanceReport>;
  /** Aging as of period end — the balances sheet's rows. */
  aging: ReturnType<typeof computeAgingAsOf>;
  /** The cash ledger and expense lines, pre-shaped for accountant-xlsx. */
  cashRows: {
    date: string;
    order: string;
    client: string;
    kind: string;
    detail: string;
    currency: string;
    amount: number;
    reportAmount: number;
  }[];
  expenseLines: { category: string; date: string; order: string; note: string; reportAmount: number }[];
};

/**
 * Assembles every non-binary entry of the pack and the manifest. The
 * report.xlsx buffer is appended by the caller (accountant-xlsx.ts) —
 * it is inserted before the manifest so its hash is still recorded.
 */
export function buildAccountantPack(input: BuildPackInput): BuiltPack {
  const { period, reportCurrency, rates } = input;
  const conv = makeConv(reportCurrency, rates);

  // One clipping, shared with the finance page's semantics — never forked.
  const clipped = filterFinanceInput(input.orders, period);
  const report = computeFinanceReport(clipped, reportCurrency, rates);
  const aging = computeAgingAsOf(input.orders, period.to, reportCurrency, rates);

  // --- ledgers ------------------------------------------------------------
  const paymentRows: Record<string, unknown>[] = [];
  const expenseRows: Record<string, unknown>[] = [];
  for (const order of clipped) {
    for (const p of order.payments) {
      paymentRows.push({
        date: p.paidOn,
        order: order.orderNumber,
        client: order.clientName,
        direction: p.direction,
        amount: fmt(p.amount),
        currency: p.currency,
        [`amount_${reportCurrency.toLowerCase()}`]: fmt(conv(p.amount, p.currency, p.rates)),
        account: p.account ?? "",
        note: p.note ?? "",
        receipt: p.receiptZipPath ?? "",
      });
    }
    for (const e of order.expenses) {
      expenseRows.push({
        date: e.spentOn,
        order: order.orderNumber,
        client: order.clientName,
        category: e.category,
        amount: fmt(e.amount),
        currency: e.currency,
        [`amount_${reportCurrency.toLowerCase()}`]: fmt(conv(e.amount, e.currency, e.rates)),
        note: e.note ?? "",
        receipt: e.receiptZipPath ?? "",
      });
    }
  }
  // Bank-statement order: strictly by date, then order number, so the
  // accountant can tick lines off against the statement top to bottom.
  const byDate = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    String(a.date).localeCompare(String(b.date)) || String(a.order).localeCompare(String(b.order));
  paymentRows.sort(byDate);
  expenseRows.sort(byDate);

  const orderRows = clipped
    .map((o) => ({
      order: o.orderNumber,
      client: o.clientName,
      // The context remap (out-of-period order kept for its cash) must not
      // print as "cancelled" — that is an internal trick, not a fact.
      status: input.orders.find((x) => x.id === o.id)?.status ?? o.status,
      created: o.createdAt.slice(0, 10),
      currency: o.quoteCurrency,
      expected_revenue: fmt(o.expectedRevenue),
      expected_cost: fmt(o.expectedCost),
      [`revenue_${reportCurrency.toLowerCase()}`]: fmt(conv(o.expectedRevenue, o.quoteCurrency)),
      [`cost_${reportCurrency.toLowerCase()}`]: fmt(conv(o.expectedCost, o.quoteCurrency)),
    }))
    .sort((a, b) => String(a.order).localeCompare(String(b.order)));

  const agingRows = (rows: typeof aging.receivables) =>
    rows.map((r) => ({
      order: r.orderNumber,
      client: r.clientName,
      [`expected_${reportCurrency.toLowerCase()}`]: fmt(r.expected),
      [`paid_${reportCurrency.toLowerCase()}`]: fmt(r.paidToDate),
      [`open_${reportCurrency.toLowerCase()}`]: fmt(r.amount),
    }));

  const ledgers: PackEntry[] = [
    { name: "ledgers/payments.csv", data: toCsv(paymentRows) },
    { name: "ledgers/expenses.csv", data: toCsv(expenseRows) },
    { name: "ledgers/orders.csv", data: toCsv(orderRows) },
    { name: "ledgers/receivables-aging.csv", data: toCsv(agingRows(aging.receivables)) },
    { name: "ledgers/payables-aging.csv", data: toCsv(agingRows(aging.payables)) },
  ];

  // --- manifest + digest ---------------------------------------------------
  const hashedEntries = [
    ...ledgers.map((e) => ({ path: e.name, sha256: sha256Hex(e.data), bytes: Buffer.byteLength(e.data) })),
    ...input.files.map((f) => ({ path: f.zipName, sha256: f.sha256, bytes: f.bytes })),
  ];
  const digest = closeDigest(hashedEntries);
  const close = input.close
    ? { closedAt: input.close.closedAt, matches: input.close.digest === digest }
    : undefined;

  const generatedAt = (input.now?.() ?? new Date()).toISOString();
  const readme = buildReadme(input, report.currency, digest, close, generatedAt);
  const readmeEntry = { path: "README.txt", sha256: sha256Hex(readme), bytes: Buffer.byteLength(readme) };

  const manifest: PackManifest = {
    version: 1,
    companyId: input.companyId,
    period,
    reportCurrency,
    generatedAt,
    generatedBy: input.generatedBy,
    closeDigest: digest,
    close,
    entries: [readmeEntry, ...hashedEntries],
  };

  // The xlsx wants the same ledger as the CSVs, typed rather than stringly.
  const cashRows = [
    ...clipped.flatMap((o) =>
      o.payments.map((p) => ({
        date: p.paidOn,
        order: o.orderNumber,
        client: o.clientName,
        kind: p.direction === "in" ? "收款 in" : "付款 out",
        detail: p.account?.trim() || p.note || "",
        currency: p.currency,
        amount: p.amount,
        reportAmount: roundMoney(conv(p.amount, p.currency, p.rates)),
      })),
    ),
    ...clipped.flatMap((o) =>
      o.expenses.map((e) => ({
        date: e.spentOn,
        order: o.orderNumber,
        client: o.clientName,
        kind: "费用 expense",
        detail: e.category,
        currency: e.currency,
        amount: e.amount,
        reportAmount: roundMoney(conv(e.amount, e.currency, e.rates)),
      })),
    ),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order));

  const expenseLines = clipped
    .flatMap((o) =>
      o.expenses.map((e) => ({
        category: e.category,
        date: e.spentOn,
        order: o.orderNumber,
        note: e.note ?? "",
        reportAmount: roundMoney(conv(e.amount, e.currency, e.rates)),
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    entries: [{ name: "README.txt", data: readme }, ...ledgers],
    manifest,
    report,
    aging,
    cashRows,
    expenseLines,
  };
}

/** zh first — the audience is the tenant's Chinese accountant. */
function buildReadme(
  input: BuildPackInput,
  currency: string,
  digest: string,
  close: { closedAt: string; matches: boolean } | undefined,
  generatedAt: string,
): string {
  const { from, to } = input.period;
  const range = from === to ? from : `${from} 至/to ${to}`;
  const closeLineZh = !close
    ? "本期间尚未结账。"
    : close.matches
      ? `本期间已于 ${close.closedAt} 结账，数据摘要与结账时一致。`
      : `本期间已于 ${close.closedAt} 结账，但数据摘要与结账时不一致——期间数据在结账后被修改。`;
  const closeLineEn = !close
    ? "This period has not been closed."
    : close.matches
      ? `Closed on ${close.closedAt}; the data digest matches the hash recorded at closing.`
      : `Closed on ${close.closedAt}; the data digest DIFFERS — underlying records changed after closing.`;
  return [
    `会计资料包 / Accountant pack — ${input.companyName}`,
    `期间 / Period: ${range}    报表币种 / Report currency: ${currency}`,
    `生成时间 / Generated: ${generatedAt}`,
    "",
    "【口径说明】收付款按实际收付日期(paid_on)计入期间；费用按发生日期计入。",
    "订单在期间内创建则计入应计数字；期间外创建但期间内有收付的订单仅计入现金流。",
    "应收应付为截至期间最后一日的余额。每笔收付款按其记录当日的汇率快照折算，",
    "订单按其下单时冻结的汇率折算。",
    "Period semantics: payments count by paid_on, expenses by spent_on.",
    "Orders created in the period carry expected figures; orders from outside",
    "the period with in-period money appear in cash flow only. Receivables and",
    "payables are balances as of the period's last day. Each payment converts",
    "at its own recorded-day rate snapshot; orders at their frozen order-day rates.",
    "",
    "ledgers/  逐笔流水与余额表 / line-by-line ledgers and balances (CSV)",
    "files/    凭证原件，按订单号分组 / evidence files, grouped by order number",
    "report.xlsx  期间报表（5 个工作表）/ the period report, 5 sheets",
    "manifest.json  每个文件的 SHA-256 哈希，用于防篡改验证 /",
    "               SHA-256 per entry, for tamper evidence",
    "",
    `数据摘要 / Data digest: ${digest}`,
    closeLineZh,
    closeLineEn,
    "",
    "本文件由系统导出，未经过人工修改 / Generated by the system, unmodified.",
    "",
  ].join("\r\n");
}
