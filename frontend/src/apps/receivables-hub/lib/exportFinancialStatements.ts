/**
 * Excel export for the Balance Sheet and P&L. One sheet per company, fully expanded (every group,
 * sub-group and ledger), because a spreadsheet has no drill-down.
 *
 * Follows the hub convention (xlsx-js-style + lib/xlsxStyle), not the portal-wide shared exporter.
 * Money is written as a NUMBER with a display format so it stays arithmetic in Excel — never as a
 * pre-formatted string. Note ws["!freeze"] is a no-op in this library, so no frozen header is attempted.
 */
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { formatDateDMY } from "./utils";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "./xlsxStyle";
import type { FsCompany, FsNode, BalanceSheetView, PnlView } from "./financialStatements";
import type { TbNode, TbView } from "./trialBalance";
import type { LedgerBillRow } from "./ledgerOutstanding";
import type { LedgerVoucherRow } from "./ledgerVouchers";

const INR_FMT = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';

type Cell = string | number;

/** Flatten a node and its descendants, indenting the label by depth. */
function flatten(node: FsNode, depth: number, negate: boolean, showReconcile: boolean, out: Cell[][]): void {
  const sign = negate ? -1 : 1;
  const row: Cell[] = [`${"    ".repeat(depth)}${node.name}`, Math.round(node.tally * sign)];
  if (showReconcile) {
    row.push(node.ours === null ? "—" : Math.round(node.ours * sign));
    row.push(node.gap === null ? "—" : Math.round(node.gap * sign));
  }
  out.push(row);
  for (const c of node.children) flatten(c, depth + 1, negate, showReconcile, out);
}

function formatMoneyCells(ws: XLSX.WorkSheet, firstRow0: number, rowCount: number, cols0: number[]): void {
  for (let i = 0; i < rowCount; i++) {
    for (const col of cols0) {
      const addr = XLSX.utils.encode_cell({ r: firstRow0 + i, c: col });
      const cell = (ws as Record<string, unknown>)[addr] as { v?: unknown; z?: string } | undefined;
      if (cell && typeof cell.v === "number") cell.z = INR_FMT;
    }
  }
}

function sheetName(c: FsCompany, used: Set<string>): string {
  const base = (c.location ? `${c.company}-${c.location}` : c.company).replace(/[\\/?*[\]:]/g, "").slice(0, 28) || "Company";
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base.slice(0, 26)}~${n++}`;
  used.add(name);
  return name;
}

function header(showReconcile: boolean): string[] {
  return showReconcile ? ["Particulars", "Tally", "Our ledgers", "Gap"] : ["Particulars", "Tally"];
}

function finish(wb: XLSX.WorkBook, title: string): void {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const stamp = formatDateDMY(new Date().toISOString().slice(0, 10));
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${stamp}.xlsx`,
  );
}

export function exportBalanceSheetXlsx(
  blocks: Array<{ company: FsCompany; view: BalanceSheetView }>,
  showReconcile: boolean,
): void {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const ncols = header(showReconcile).length;

  for (const { company, view } of blocks) {
    const aoa: Cell[][] = [];
    aoa.push([`Balance Sheet — ${company.location ? `${company.company} (${company.location})` : company.company}`]);
    aoa.push(["Book", company.rawName]);
    aoa.push(["As on", formatDateDMY(company.asOf)]);
    aoa.push(["Source", "Tally Trial Balance via ConnectWave; 'Our ledgers' is the mirror's rollup"]);
    aoa.push([]);

    const headerRow0 = aoa.length;
    aoa.push(header(showReconcile));
    const firstData0 = aoa.length;

    aoa.push(["LIABILITIES"]);
    for (const n of view.liabilities.rows) flatten(n, 1, false, showReconcile, aoa);
    const lTotal0 = aoa.length;
    aoa.push(["Total Liabilities", Math.round(view.liabilities.total)]);

    aoa.push([]);
    aoa.push(["ASSETS"]);
    for (const n of view.assets.rows) flatten(n, 1, false, showReconcile, aoa);
    const aTotal0 = aoa.length;
    aoa.push(["Total Assets", Math.round(view.assets.total)]);

    if (Math.abs(view.difference) >= 0.5) {
      aoa.push(["Difference (does not balance)", Math.round(view.difference)]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 48 }, ...Array(ncols - 1).fill({ wch: 18 })];
    formatMoneyCells(ws, firstData0, aoa.length - firstData0, [1, 2, 3].filter((c) => c < ncols));
    styleRow(ws, 0, ncols, HEADER_STYLE);
    styleRow(ws, headerRow0, ncols, HEADER_STYLE);
    styleRow(ws, lTotal0, ncols, TOTAL_STYLE);
    styleRow(ws, aTotal0, ncols, GRAND_TOTAL_STYLE);
    XLSX.utils.book_append_sheet(wb, ws, sheetName(company, used));
  }

  finish(wb, "Balance_Sheet");
}

export function exportPnlXlsx(
  blocks: Array<{ company: FsCompany; view: PnlView }>,
  showReconcile: boolean,
): void {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const ncols = header(showReconcile).length;

  for (const { company, view } of blocks) {
    const aoa: Cell[][] = [];
    aoa.push([`Profit & Loss — ${company.location ? `${company.company} (${company.location})` : company.company}`]);
    aoa.push(["Book", company.rawName]);
    aoa.push(["Period", `${formatDateDMY(company.fromDate)} to ${formatDateDMY(company.asOf)}`]);
    aoa.push(["Source", "Tally Trial Balance via ConnectWave; 'Our ledgers' is the mirror's rollup"]);
    aoa.push([]);

    const headerRow0 = aoa.length;
    aoa.push(header(showReconcile));
    const firstData0 = aoa.length;

    aoa.push(["TRADING ACCOUNT — Dr"]);
    for (const n of view.left.rows) flatten(n, 1, false, showReconcile, aoa);
    aoa.push(["TRADING ACCOUNT — Cr"]);
    for (const n of view.right.rows) flatten(n, 1, false, showReconcile, aoa);
    const gp0 = aoa.length;
    aoa.push([view.grossProfit >= 0 ? "Gross Profit" : "Gross Loss", Math.round(Math.abs(view.grossProfit))]);

    aoa.push([]);
    aoa.push(["PROFIT & LOSS ACCOUNT — Dr"]);
    for (const n of view.left2.rows) flatten(n, 1, false, showReconcile, aoa);
    aoa.push(["PROFIT & LOSS ACCOUNT — Cr"]);
    for (const n of view.right2.rows) flatten(n, 1, false, showReconcile, aoa);
    const np0 = aoa.length;
    aoa.push([view.nettProfit >= 0 ? "Nett Profit" : "Nett Loss", Math.round(Math.abs(view.nettProfit))]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 48 }, ...Array(ncols - 1).fill({ wch: 18 })];
    formatMoneyCells(ws, firstData0, aoa.length - firstData0, [1, 2, 3].filter((c) => c < ncols));
    styleRow(ws, 0, ncols, HEADER_STYLE);
    styleRow(ws, headerRow0, ncols, HEADER_STYLE);
    styleRow(ws, gp0, ncols, TOTAL_STYLE);
    styleRow(ws, np0, ncols, GRAND_TOTAL_STYLE);
    XLSX.utils.book_append_sheet(wb, ws, sheetName(company, used));
  }

  finish(wb, "Profit_And_Loss");
}

/** Trial-balance columns: Debit + Credit, plus Tally net + Gap when reconciling. */
function tbHeader(showReconcile: boolean): string[] {
  return showReconcile
    ? ["Particulars", "Debit", "Credit", "Tally net", "Gap"]
    : ["Particulars", "Debit", "Credit"];
}

/** Flatten a TbNode and its descendants, indenting the label by depth. Blank cells for a zero side,
 *  matching Tally (and the on-screen table). Tally net / Gap appear only where Tally has a figure. */
function tbFlatten(node: TbNode, depth: number, showReconcile: boolean, out: Cell[][]): void {
  const row: Cell[] = [
    `${"    ".repeat(depth)}${node.name}`,
    Math.abs(node.debit) < 0.5 ? "" : Math.round(node.debit),
    Math.abs(node.credit) < 0.5 ? "" : Math.round(node.credit),
  ];
  if (showReconcile) {
    if (node.tallyNet === null) {
      row.push("", "");
    } else {
      row.push(Math.round(node.tallyNet), Math.round(node.tallyNet - (node.debit - node.credit)));
    }
  }
  out.push(row);
  for (const c of node.children) tbFlatten(c, depth + 1, showReconcile, out);
}

export function exportTrialBalanceXlsx(
  blocks: Array<{ company: FsCompany; view: TbView }>,
  showReconcile: boolean,
): void {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const ncols = tbHeader(showReconcile).length;

  for (const { company, view } of blocks) {
    const aoa: Cell[][] = [];
    aoa.push([`Trial Balance — ${company.location ? `${company.company} (${company.location})` : company.company}`]);
    aoa.push(["Book", company.rawName]);
    aoa.push(["Period", `${formatDateDMY(company.fromDate)} to ${formatDateDMY(company.asOf)}`]);
    aoa.push(["Source", "Tally ledger balances via ConnectWave; 'Tally net' is v_fs_line's own group figure"]);
    aoa.push([]);

    const headerRow0 = aoa.length;
    aoa.push(tbHeader(showReconcile));
    const firstData0 = aoa.length;

    for (const n of view.rows) tbFlatten(n, 0, showReconcile, aoa);

    const totalRow0 = aoa.length;
    const totalRow: Cell[] = ["Grand Total", Math.round(view.totalDebit), Math.round(view.totalCredit)];
    if (showReconcile) totalRow.push("", "");
    aoa.push(totalRow);

    if (Math.abs(view.difference) >= 0.5) {
      aoa.push(["Difference (does not balance)", Math.round(view.difference)]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 48 }, ...Array(ncols - 1).fill({ wch: 18 })];
    formatMoneyCells(ws, firstData0, aoa.length - firstData0, [1, 2, 3, 4].filter((c) => c < ncols));
    styleRow(ws, 0, ncols, HEADER_STYLE);
    styleRow(ws, headerRow0, ncols, HEADER_STYLE);
    styleRow(ws, totalRow0, ncols, GRAND_TOTAL_STYLE);
    XLSX.utils.book_append_sheet(wb, ws, sheetName(company, used));
  }

  finish(wb, "Trial_Balance");
}

/** yyyymmdd → dd-mm-yyyy for the sheet (Tally date columns). */
function ymd(s: string | null): string {
  if (!s || !/^\d{8}$/.test(s)) return "";
  return `${s.slice(6, 8)}-${s.slice(4, 6)}-${s.slice(0, 4)}`;
}
/** Dr-positive amount → "<n> Dr" / "<n> Cr" text; blank at zero. Written as text (mixed Dr/Cr sign). */
function drcrCell(n: number): string {
  if (Math.abs(n) < 0.5) return "";
  return `${Math.round(Math.abs(n)).toLocaleString("en-IN")} ${n >= 0 ? "Dr" : "Cr"}`;
}

export function exportLedgerOutstandingXlsx(input: {
  ledgerName: string;
  company?: FsCompany;
  asOn: string;
  bills: LedgerBillRow[];
}): void {
  const { ledgerName, company, asOn, bills } = input;
  const wb = XLSX.utils.book_new();
  const aoa: Cell[][] = [];

  aoa.push([`Ledger Outstandings — ${ledgerName}`]);
  aoa.push(["Ledger", ledgerName]);
  if (company) {
    aoa.push(["Company", company.location ? `${company.company} (${company.location})` : company.company]);
    aoa.push(["Period", `${formatDateDMY(company.fromDate)} to ${formatDateDMY(company.asOf)}`]);
  }
  aoa.push(["As on", formatDateDMY(asOn)]);
  aoa.push(["Source", "Tally pending bills via ConnectWave (bill's own credit period; overdue as of 'As on')"]);
  aoa.push([]);

  const headerRow0 = aoa.length;
  aoa.push(["Date", "Ref No.", "Opening Amount", "Pending Amount", "Due on", "Overdue by days"]);

  let openTot = 0;
  let pendTot = 0;
  for (const b of bills) {
    openTot += b.openingAmount;
    pendTot += b.pendingAmount;
    aoa.push([
      ymd(b.billDate),
      b.isOnAccount ? "On Account" : b.billRef ?? "",
      b.isOnAccount ? "" : drcrCell(b.openingAmount),
      drcrCell(b.pendingAmount),
      ymd(b.dueDate),
      b.overdueDays && b.overdueDays > 0 ? b.overdueDays : "",
    ]);
  }

  const totalRow0 = aoa.length;
  aoa.push(["Grand Total", "", drcrCell(openTot), drcrCell(pendTot), "", ""]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 14 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 16 }];
  styleRow(ws, 0, 6, HEADER_STYLE);
  styleRow(ws, headerRow0, 6, HEADER_STYLE);
  styleRow(ws, totalRow0, 6, GRAND_TOTAL_STYLE);
  XLSX.utils.book_append_sheet(wb, ws, "Ledger Outstanding");

  finish(wb, `Ledger_Outstanding_${ledgerName}`);
}

export function exportLedgerVouchersXlsx(input: {
  ledgerName: string;
  company?: FsCompany;
  periodLabel: string;
  opening: number;
  closing: number;
  rows: { row: LedgerVoucherRow; balance: number }[];
}): void {
  const { ledgerName, company, periodLabel, opening, closing, rows } = input;
  const wb = XLSX.utils.book_new();
  const aoa: Cell[][] = [];

  aoa.push([`Ledger Vouchers — ${ledgerName}`]);
  aoa.push(["Ledger", ledgerName]);
  if (company) {
    aoa.push(["Company", company.location ? `${company.company} (${company.location})` : company.company]);
  }
  aoa.push(["Period", periodLabel]);
  aoa.push(["Source", "Tally vouchers via ConnectWave (running balance folds from the opening balance)"]);
  aoa.push([]);

  const headerRow0 = aoa.length;
  aoa.push(["Date", "Particulars", "Vch Type", "Vch No", "Debit", "Credit", "Balance"]);

  const openRow0 = aoa.length;
  aoa.push(["", "Opening Balance", "", "", "", "", drcrCell(opening)]);

  let debitTot = 0;
  let creditTot = 0;
  for (const { row, balance } of rows) {
    if (row.amount > 0) debitTot += row.amount;
    else creditTot += -row.amount;
    aoa.push([
      ymd(row.date),
      row.particulars ?? "",
      row.voucherType ?? "",
      row.voucherNo ?? "",
      row.amount > 0.5 ? Math.round(row.amount) : "",
      row.amount < -0.5 ? Math.round(-row.amount) : "",
      drcrCell(balance),
    ]);
  }

  const totalRow0 = aoa.length;
  aoa.push(["", "Current Total", "", "", Math.round(debitTot), Math.round(creditTot), ""]);
  const closeRow0 = aoa.length;
  aoa.push(["", "Closing Balance", "", "", "", "", drcrCell(closing)]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 18 }];
  formatMoneyCells(ws, headerRow0 + 2, rows.length, [4, 5]);
  formatMoneyCells(ws, totalRow0, 1, [4, 5]);
  styleRow(ws, 0, 7, HEADER_STYLE);
  styleRow(ws, headerRow0, 7, HEADER_STYLE);
  styleRow(ws, openRow0, 7, TOTAL_STYLE);
  styleRow(ws, totalRow0, 7, TOTAL_STYLE);
  styleRow(ws, closeRow0, 7, GRAND_TOTAL_STYLE);
  XLSX.utils.book_append_sheet(wb, ws, "Ledger Vouchers");

  finish(wb, `Ledger_Vouchers_${ledgerName}`);
}
