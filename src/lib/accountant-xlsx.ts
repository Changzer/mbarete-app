import ExcelJS from "exceljs";
import type { FinanceReport, AgingRow, Period } from "@/lib/finance-report";

const BRAND = "FFC2410C"; // brand-600, ARGB — same as every export
const MONEY = "#,##0.00";

/**
 * The period report the accountant opens first: five sheets, zh-first
 * titles, every amount in the report currency and formatted as money.
 * Data arrives fully computed (accountant-pack.ts); this file is layout
 * only, in the styling conventions of order-xlsx.ts.
 */
export async function buildAccountantXlsx(input: {
  companyName: string;
  period: Period;
  report: FinanceReport;
  receivables: AgingRow[];
  payables: AgingRow[];
  /** payments and expenses as one dated ledger, pre-sorted */
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
  generatedAt: string;
}): Promise<Buffer> {
  const { report, period } = input;
  const cur = report.currency;
  const range = period.from === period.to ? period.from : `${period.from} — ${period.to}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = input.companyName;

  const sheet = (title: string, widths: number[]) => {
    const ws = wb.addWorksheet(title, {
      pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 },
    });
    ws.columns = widths.map((width) => ({ width }));
    return ws;
  };
  const header = (ws: ExcelJS.Worksheet, subtitle: string) => {
    ws.getCell(1, 1).value = input.companyName;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: BRAND } };
    ws.getCell(2, 1).value = `${subtitle} · ${range} · ${cur}`;
    ws.getCell(2, 1).font = { size: 10, color: { argb: "FF3D3D3D" } };
    return 4;
  };
  const headRow = (ws: ExcelJS.Worksheet, r: number, cols: string[]) => {
    cols.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = c;
      cell.font = { bold: true, size: 9 };
      cell.border = { bottom: { style: "thin" } };
    });
    return r + 1;
  };
  const money = (ws: ExcelJS.Worksheet, r: number, c: number, v: number | null) => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.numFmt = MONEY;
  };

  // 1 汇总 Summary --------------------------------------------------------
  {
    const ws = sheet("汇总 Summary", [34, 18]);
    let r = header(ws, "期间汇总 Period summary");
    const t = report.totals;
    const rows: [string, number | null, string?][] = [
      ["收款 Cash in", t.cashIn],
      ["付款+费用 Cash out", t.cashOut],
      ["净现金 Net cash", t.netCash],
      ["费用合计 Expenses", t.expensesTotal],
      ["应计收入 Expected revenue", t.expectedRevenue],
      ["应计成本 Expected cost", t.expectedCost],
      ["应计净利 Expected net", t.expectedNet],
      ["利润率 Margin %", t.marginPct, "0.0%"],
      ["应收（期末）Receivables at period end", t.receivables],
      ["应付（期末）Payables at period end", t.payables],
      ["报价中 Quoted pipeline (memo)", t.quotedRevenue],
    ];
    for (const [label, value, numFmt] of rows) {
      ws.getCell(r, 1).value = label;
      const cell = ws.getCell(r, 2);
      cell.value = numFmt && value !== null ? value / 100 : value;
      cell.numFmt = numFmt ?? MONEY;
      r += 1;
    }
    ws.getCell(r + 1, 1).value = `生成时间 Generated: ${input.generatedAt}`;
    ws.getCell(r + 1, 1).font = { size: 9, color: { argb: "FF3D3D3D" } };
  }

  // 2 月度 Monthly --------------------------------------------------------
  {
    const ws = sheet("月度 Monthly", [12, 10, 16, 16, 16, 16, 16]);
    let r = header(ws, "月度 Monthly");
    r = headRow(ws, r, ["月份 Month", "订单 Orders", "应计收入 Revenue", "应计净利 Net", "收款 In", "付款 Out", "净现金 Net cash"]);
    for (const m of [...report.months].sort((a, b) => a.month.localeCompare(b.month))) {
      ws.getCell(r, 1).value = m.month;
      ws.getCell(r, 2).value = m.orders;
      money(ws, r, 3, m.expectedRevenue);
      money(ws, r, 4, m.expectedNet);
      money(ws, r, 5, m.cashIn);
      money(ws, r, 6, m.cashOut);
      money(ws, r, 7, m.netCash);
      r += 1;
    }
  }

  // 3 收支 Cash flow ------------------------------------------------------
  {
    const ws = sheet("收支 Cash flow", [12, 18, 22, 14, 20, 8, 14, 14]);
    let r = header(ws, "收支流水 Cash ledger");
    r = headRow(ws, r, ["日期 Date", "订单 Order", "客户 Client", "类型 Kind", "摘要 Detail", "币种 Ccy", "金额 Amount", `折${cur} In ${cur}`]);
    for (const row of input.cashRows) {
      ws.getCell(r, 1).value = row.date;
      ws.getCell(r, 2).value = row.order;
      ws.getCell(r, 3).value = row.client;
      ws.getCell(r, 4).value = row.kind;
      ws.getCell(r, 5).value = row.detail;
      ws.getCell(r, 6).value = row.currency;
      money(ws, r, 7, row.amount);
      money(ws, r, 8, row.reportAmount);
      r += 1;
    }
  }

  // 4 费用 Expenses -------------------------------------------------------
  {
    const ws = sheet("费用 Expenses", [22, 14, 10, 12, 18, 30]);
    let r = header(ws, "费用 Expenses");
    r = headRow(ws, r, ["类别 Category", `金额 ${cur}`, "占比 %", "日期 Date", "订单 Order", "备注 Note"]);
    for (const cat of report.expensesByCategory) {
      ws.getCell(r, 1).value = cat.category;
      ws.getCell(r, 1).font = { bold: true };
      money(ws, r, 2, cat.amount);
      ws.getCell(r, 3).value = cat.pct / 100;
      ws.getCell(r, 3).numFmt = "0.0%";
      r += 1;
      for (const line of input.expenseLines.filter((l) => l.category === cat.category)) {
        money(ws, r, 2, line.reportAmount);
        ws.getCell(r, 4).value = line.date;
        ws.getCell(r, 5).value = line.order;
        ws.getCell(r, 6).value = line.note;
        r += 1;
      }
    }
  }

  // 5 应收应付 Open balances ----------------------------------------------
  {
    const ws = sheet("应收应付 Balances", [18, 22, 16, 16, 16]);
    let r = header(ws, "期末应收应付 Open balances at period end");
    ws.getCell(r, 1).value = "应收 Receivables";
    ws.getCell(r, 1).font = { bold: true, color: { argb: BRAND } };
    r += 1;
    r = headRow(ws, r, ["订单 Order", "客户 Client", `应计 Expected`, `已收 Paid`, `未收 Open`]);
    for (const row of input.receivables) {
      ws.getCell(r, 1).value = row.orderNumber;
      ws.getCell(r, 2).value = row.clientName;
      money(ws, r, 3, row.expected);
      money(ws, r, 4, row.paidToDate);
      money(ws, r, 5, row.amount);
      r += 1;
    }
    r += 1;
    ws.getCell(r, 1).value = "应付 Payables";
    ws.getCell(r, 1).font = { bold: true, color: { argb: BRAND } };
    r += 1;
    r = headRow(ws, r, ["订单 Order", "客户 Client", `应计 Expected`, `已付 Paid`, `未付 Open`]);
    for (const row of input.payables) {
      ws.getCell(r, 1).value = row.orderNumber;
      ws.getCell(r, 2).value = row.clientName;
      money(ws, r, 3, row.expected);
      money(ws, r, 4, row.paidToDate);
      money(ws, r, 5, row.amount);
      r += 1;
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
