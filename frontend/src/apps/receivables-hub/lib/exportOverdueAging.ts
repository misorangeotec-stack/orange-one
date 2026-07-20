/**
 * exportOverdueAging.ts — the Excel export for "Customers Overdue Over N Days".
 *
 * Same three rules as exportCollections.ts:
 *
 *  1. WYSIWYG — the workbook carries exactly what was on screen (cutoff, scope, filters, view,
 *     sort, visible columns). An export that quietly differs from the thing that was reviewed is
 *     worse than no export at all, so the meta band spells all of it out.
 *  2. Money is written as NUMBERS with an INR display format, never pre-formatted strings
 *     ("₹1.20 L" looks right and is useless — Excel can't SUM it). Same for percentages.
 *  3. A percentage is NEVER summed — the % cells come from each node's own value(), the same
 *     function the screen uses.
 *
 * Three sheets. The third is the point of the whole export: "Aged Bills" is one row per bill past
 * the cutoff, which is what a collections drive is actually run off — you chase invoices, not
 * customers.
 */

import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { formatDateDMY } from "./utils";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "./xlsxStyle";
import { utilizationPct } from "./receivables";
import { NEVER_PAID } from "./collections";
import { isAged, isBroughtForward, isFullyAged, type OAColumn, type OAMetrics, type OARow } from "./overdueAging";
import type { EnrichedBill } from "./agingReport";
import type { GroupNode } from "./groupTree";

const INR_FMT = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';
/** A literal "%" suffix — the cell holds 12.3, not 0.123. (Excel's native 0.0% would render 1230%.) */
const PCT_FMT = '0.0"%";-0.0"%";"—"';

export interface OAExportMeta {
  /** e.g. "Customers Overdue Over 120 Days". */
  title: string;
  cutoff: number;
  /** e.g. "Salesperson → Customer". */
  viewLabel: string;
  /** e.g. "Both FYs (01-04-2025 → 12-07-2026)". */
  scopeLabel: string;
  /** How the number was arrived at, in words. */
  basis: string;
  /** The Aging Report tie, or the warning that there isn't one. */
  reconciliation: string;
  asOfDate: string;
  /** Active-filter lines, e.g. ["Salesperson: Rakesh", "Segment: All"]. */
  filterSummary: string[];
  /** Excluded, and why — e.g. the undated bills that cannot be aged. */
  exclusions: string[];
}

const daysCell = (v: number): string | number =>
  v === NEVER_PAID ? "Never" : v < 0 ? "—" : v;

const pctCell = (v: number | null): string | number =>
  v === null ? "—" : Math.round(v * 10) / 10;

const cellFor = (col: OAColumn, m: OAMetrics): string | number => {
  const v = col.value(m);
  if (v === null) return "—";
  if (col.kind === "pct") return pctCell(v);
  if (col.kind === "days") return daysCell(v);
  return Math.round(v);
};

function flatten(
  nodes: GroupNode<OAMetrics>[],
): { label: string; depth: number; metrics: OAMetrics; isLeaf: boolean }[] {
  const out: { label: string; depth: number; metrics: OAMetrics; isLeaf: boolean }[] = [];
  const walk = (list: GroupNode<OAMetrics>[]) => {
    for (const n of list) {
      out.push({
        label: n.sub ? `${n.label} (${n.sub})` : n.label,
        depth: n.depth,
        metrics: n.metrics,
        isLeaf: n.children.length === 0,
      });
      if (n.children.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function formatCells(
  ws: XLSX.WorkSheet,
  firstRow0: number,
  rowCount: number,
  cols0: number[],
  fmt: string,
): void {
  for (let i = 0; i < rowCount; i++) {
    for (const col of cols0) {
      const addr = XLSX.utils.encode_cell({ r: firstRow0 + i, c: col });
      const cell = (ws as Record<string, unknown>)[addr] as { v?: unknown; z?: string } | undefined;
      if (cell && typeof cell.v === "number") cell.z = fmt;
    }
  }
}

/** Sheet 1 — the roll-up, exactly as displayed. */
function buildRollupSheet(
  roots: GroupNode<OAMetrics>[],
  total: OAMetrics,
  columns: OAColumn[],
  meta: OAExportMeta,
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [];

  aoa.push([meta.title]);
  aoa.push(["Cutoff", `More than ${meta.cutoff} days past due`]);
  aoa.push(["Scope", meta.scopeLabel]);
  aoa.push(["As on", formatDateDMY(meta.asOfDate)]);
  aoa.push(["View", meta.viewLabel]);
  aoa.push(["Basis", meta.basis]);
  aoa.push(["Reconciliation", meta.reconciliation]);
  aoa.push(["Filters", meta.filterSummary.length ? meta.filterSummary.join(" · ") : "None"]);
  if (meta.exclusions.length) aoa.push(["Excluded", meta.exclusions.join(" · ")]);
  aoa.push([]);

  const header = [meta.viewLabel, ...columns.map((c) => c.label)];
  const headerRow0 = aoa.length;
  aoa.push(header);

  const firstData0 = aoa.length;
  const rows = flatten(roots);
  for (const r of rows) {
    aoa.push([
      `${"    ".repeat(r.depth)}${r.label}`,
      ...columns.map((c) => cellFor(c, r.metrics)),
    ]);
  }

  const grandRow0 = aoa.length;
  aoa.push(["GRAND TOTAL", ...columns.map((c) => cellFor(c, total))]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = [{ wch: 42 }, ...columns.map(() => ({ wch: 16 }))];

  const pick = (k: OAColumn["kind"]) =>
    columns.map((c, i) => (c.kind === k ? i + 1 : -1)).filter((i) => i >= 0);
  formatCells(ws, firstData0, rows.length + 1, pick("money"), INR_FMT);
  formatCells(ws, firstData0, rows.length + 1, pick("pct"), PCT_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  rows.forEach((r, i) => {
    if (!r.isLeaf) styleRow(ws, firstData0 + i, ncols, TOTAL_STYLE);
  });
  styleRow(ws, grandRow0, ncols, GRAND_TOTAL_STYLE);

  ws["!freeze"] = { xSplit: 1, ySplit: headerRow0 + 1 };
  return ws;
}

/** Sheet 2 — flat, one row per listed customer, every column regardless of the ColumnPicker. */
function buildCustomerSheet(rows: OARow[], meta: OAExportMeta): XLSX.WorkSheet {
  const header = [
    "Customer", "Group", "Company", "Location", "Salesperson", "Category",
    `Aged (> ${meta.cutoff}d)`, "of which Brought Forward (opening)", "of which Billed In Period", "of which 180+",
    "% Aged", "Aged Bills", "Max Overdue Days", "Oldest Bill Date",
    "Total Overdue", "Billed Outstanding", "On Account", "Unbilled Adj.", "Outstanding (net ledger)",
    "Net Credit", "Fully Aged",
    "Sales (Last 3M)", "Days Since Receipt", "Last Receipt Date",
    "Credit Limit", "Utilization %", "Risk", "Red Mark",
  ];
  const MONEY_COLS = [6, 7, 8, 9, 14, 15, 16, 17, 18, 21, 24];
  const PCT_COLS = [10, 25];

  const aoa: Array<Array<string | number>> = [];
  aoa.push([`${meta.title} — ${meta.scopeLabel}`]);
  aoa.push([]);
  const headerRow0 = aoa.length;
  aoa.push(header);

  const firstData0 = aoa.length;
  for (const r of rows) {
    const c = r.customer;
    const f = r.facts;
    aoa.push([
      c.name,
      r.group,
      c.companies?.join(" / ") || c.company,
      c.locations?.join(" / ") || c.location,
      c.salesPersons?.length ? c.salesPersons.join(", ") : c.salesPerson || "Others",
      c.categories?.length ? c.categories.join(", ") : c.category || "Uncategorized",
      Math.round(f.aged),
      Math.round(f.agedBroughtForward),
      Math.round(f.agedInPeriod),
      Math.round(f.agedOver180),
      // Denominator is billed outstanding, never the net ledger — see OA_COLUMNS.
      f.billedOutstanding > 0.5 ? Math.round((f.aged / f.billedOutstanding) * 1000) / 10 : "—",
      f.agedBillCount,
      f.oldestOverdueDays,
      f.oldestBillDate ? formatDateDMY(f.oldestBillDate) : "—",
      Math.round(f.totalOverdue),
      Math.round(f.billedOutstanding),
      Math.round(f.onAccount),
      Math.round(f.unbilledAdj),
      Math.round(f.totalOutstanding),
      f.isNetCredit ? "Yes" : "No",
      isFullyAged(f) ? "Yes" : "No",
      Math.round(f.salesInWindow),
      f.lastReceiptDate === null ? "Never" : (f.daysSinceLastReceipt ?? 0),
      f.lastReceiptDate ? formatDateDMY(f.lastReceiptDate) : "Never",
      Math.round(c.creditLimit ?? 0),
      utilizationPct(c),
      c.risk,
      c.blocked ? "Yes" : "No",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = [
    { wch: 38 }, { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 12 },
    { wch: 16 }, { wch: 22 }, { wch: 18 }, { wch: 16 },
    { wch: 10 }, { wch: 11 }, { wch: 17 }, { wch: 16 },
    { wch: 15 }, { wch: 18 }, { wch: 14 }, { wch: 15 }, { wch: 21 },
    { wch: 11 }, { wch: 11 },
    { wch: 16 }, { wch: 18 }, { wch: 17 },
    { wch: 14 }, { wch: 13 }, { wch: 10 }, { wch: 9 },
  ];

  formatCells(ws, firstData0, rows.length, MONEY_COLS, INR_FMT);
  formatCells(ws, firstData0, rows.length, PCT_COLS, PCT_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);

  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: headerRow0, c: 0 },
      { r: headerRow0 + rows.length, c: ncols - 1 },
    ),
  };
  ws["!freeze"] = { xSplit: 1, ySplit: headerRow0 + 1 };
  return ws;
}

/**
 * Sheet 3 — one row per AGED BILL. The sheet a collections drive is actually run off: you chase
 * invoices, not customers. Sorted worst-first (most overdue), with the brought-forward flag so a
 * caller can see instantly whether they're chasing this year's money or last year's.
 */
function buildBillSheet(bills: EnrichedBill[], meta: OAExportMeta, horizonStart: string): XLSX.WorkSheet {
  const header = [
    "Customer", "Group", "Company", "Location", "Salesperson",
    "Bill No.", "Bill Ref", "Bill Date", "Due Date", "Days Overdue",
    "Bill Amount", "Received", "Pending", "Sale Type", "Brought Forward",
  ];
  const MONEY_COLS = [10, 11, 12];

  const aged = bills
    .filter((b) => isAged(b, meta.cutoff))
    .sort((a, b) => b.inv.overdueDays - a.inv.overdueDays);

  const aoa: Array<Array<string | number>> = [];
  aoa.push([`Aged bills — more than ${meta.cutoff} days past due, as on ${formatDateDMY(meta.asOfDate)}`]);
  aoa.push([]);
  const headerRow0 = aoa.length;
  aoa.push(header);

  const firstData0 = aoa.length;
  for (const b of aged) {
    aoa.push([
      b.cust.name,
      b.dims.group,
      b.cust.company,
      b.cust.location,
      b.cust.salesPerson || "Others",
      b.inv.number,
      b.inv.billRefName,
      b.inv.date ? formatDateDMY(b.inv.date) : "—",
      b.inv.dueDate ? formatDateDMY(b.inv.dueDate) : "—",
      b.inv.overdueDays,
      Math.round(b.inv.amount),
      Math.round(b.inv.amount - b.inv.pending),
      Math.round(b.inv.pending),
      b.inv.voucherType,
      isBroughtForward(b, horizonStart) ? "Yes" : "No",
    ]);
  }

  const totalRow0 = aoa.length;
  aoa.push([
    "TOTAL", "", "", "", "", "", "", "", "", "",
    "", "", Math.round(aged.reduce((s, b) => s + b.inv.pending, 0)), "", "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = [
    { wch: 38 }, { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 18 },
    { wch: 20 }, { wch: 20 }, { wch: 13 }, { wch: 13 }, { wch: 13 },
    { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 13 }, { wch: 16 },
  ];

  formatCells(ws, firstData0, aged.length + 1, MONEY_COLS, INR_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  styleRow(ws, totalRow0, ncols, GRAND_TOTAL_STYLE);

  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: headerRow0, c: 0 },
      { r: headerRow0 + aged.length, c: ncols - 1 },
    ),
  };
  ws["!freeze"] = { xSplit: 1, ySplit: headerRow0 + 1 };
  return ws;
}

export function exportOverdueAgingXlsx(
  roots: GroupNode<OAMetrics>[],
  total: OAMetrics,
  leafRows: OARow[],
  bills: EnrichedBill[],
  columns: OAColumn[],
  meta: OAExportMeta,
  horizonStart: string,
): void {
  const wb = XLSX.utils.book_new();
  // Excel caps sheet names at 31 chars and rejects most punctuation.
  const tab = meta.title.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Overdue";
  XLSX.utils.book_append_sheet(wb, buildRollupSheet(roots, total, columns, meta), tab);
  XLSX.utils.book_append_sheet(wb, buildCustomerSheet(leafRows, meta), "Customers");
  XLSX.utils.book_append_sheet(wb, buildBillSheet(bills, meta, horizonStart), "Aged Bills");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const stamp = formatDateDMY(meta.asOfDate) || "export";
  const file = meta.title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${file}_${stamp}.xlsx`,
  );
}
