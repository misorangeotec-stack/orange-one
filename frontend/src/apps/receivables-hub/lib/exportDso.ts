/**
 * exportDso.ts — the Excel export for "Customers with Average DSO over N Days".
 *
 * Same three rules as the other report exports:
 *
 *  1. WYSIWYG — the workbook carries exactly what was on screen (cutoff, lookback, scope, filters,
 *     view, sort, visible columns). An export that quietly differs from the thing that was reviewed
 *     is worse than no export at all, so the meta band spells all of it out.
 *  2. Money is written as NUMBERS with an INR display format, never pre-formatted strings ("₹1.20 L"
 *     looks right and is useless — Excel can't SUM it).
 *  3. **A RATIO IS NEVER SUMMED.** Every DSO / Terms / Avg-Age cell comes from the node's own
 *     value(), the same function the screen uses — which recomputes the countback from that node's
 *     summed outstanding and summed billing vector. Nobody can drag-sum a DSO column and get a
 *     meaningful total, and this file must never invite them to try.
 *
 * Three sheets. The third is deliberately "Open Bills" rather than the aged slice: this report is
 * about how slowly the WHOLE receivable turns over, not just the late part of it.
 *
 * There is no "Days to Pay" sheet, and that is a measured decision — see the note in dso.ts. The
 * receipt→invoice join lands for only 24.6% of receipt value, and the bills it MISSES are
 * systematically the older ones, so a per-customer average days-to-pay would make slow payers look
 * fast. A column that lies in the direction of the report's own question is worse than no column.
 */

import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { formatDateDMY } from "./utils";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "./xlsxStyle";
import { utilizationPct } from "./receivables";
import { NEVER_PAID, NEVER_SOLD } from "./collections";
import { lookbackDaysOf, type DsoColumn, type DsoMetrics, type DsoRow } from "./dso";
import type { EnrichedBill } from "./agingReport";
import type { GroupNode } from "./groupTree";

const INR_FMT = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';
const DAYS_FMT = '0" d";-0" d";"—"';

export interface DsoExportMeta {
  /** e.g. "Customers with Average DSO over 90 Days". */
  title: string;
  cutoff: number;
  /** e.g. "Salesperson → Customer". */
  viewLabel: string;
  /** e.g. "Both FYs (01-04-2025 → 13-07-2026)". */
  scopeLabel: string;
  /** e.g. "12 months (Aug-25 → Jul-26) = 347 days". */
  lookbackLabel: string;
  basis: string;
  asOfDate: string;
  filterSummary: string[];
  exclusions: string[];
}

const daysCell = (v: number | null): string | number =>
  v === null ? "—" : v === NEVER_PAID || v === NEVER_SOLD ? "Never" : v < 0 ? "—" : Math.round(v);

const cellFor = (col: DsoColumn, m: DsoMetrics, lookbackDays: number): string | number => {
  const v = col.value(m);
  if (v === null) return "—";
  // A capped countback is NOT a number — writing 347 would let a reader treat a floor as a
  // measurement. It goes in as text, so it can never be averaged or charted as if it were exact.
  if (col.capped?.(m)) return `> ${lookbackDays} d`;
  if (col.kind === "days") return daysCell(v);
  if (col.kind === "months") return v === NEVER_SOLD ? "None" : Math.round(v);
  return Math.round(v);
};

function flatten(
  nodes: GroupNode<DsoMetrics>[],
): { label: string; depth: number; metrics: DsoMetrics; isLeaf: boolean }[] {
  const out: { label: string; depth: number; metrics: DsoMetrics; isLeaf: boolean }[] = [];
  const walk = (list: GroupNode<DsoMetrics>[]) => {
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
  roots: GroupNode<DsoMetrics>[],
  total: DsoMetrics,
  columns: DsoColumn[],
  lookbackDays: number,
  meta: DsoExportMeta,
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [];

  aoa.push([meta.title]);
  aoa.push(["Cutoff", `DSO more than ${meta.cutoff} days`]);
  aoa.push(["Lookback", meta.lookbackLabel]);
  aoa.push(["Scope", meta.scopeLabel]);
  aoa.push(["As on", formatDateDMY(meta.asOfDate)]);
  aoa.push(["View", meta.viewLabel]);
  aoa.push(["Basis", meta.basis]);
  aoa.push([
    "Reading the DSO column",
    "A group's DSO is recomputed from ITS OWN outstanding and billings — it is NOT the average of " +
    "the rows beneath it, and averaging them will not reproduce it. Do not sum or average this column.",
  ]);
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
      ...columns.map((c) => cellFor(c, r.metrics, lookbackDays)),
    ]);
  }

  const grandRow0 = aoa.length;
  aoa.push(["GRAND TOTAL", ...columns.map((c) => cellFor(c, total, lookbackDays))]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = [{ wch: 42 }, ...columns.map(() => ({ wch: 16 }))];

  const pick = (k: DsoColumn["kind"]) =>
    columns.map((c, i) => (c.kind === k ? i + 1 : -1)).filter((i) => i >= 0);
  formatCells(ws, firstData0, rows.length + 1, pick("money"), INR_FMT);
  formatCells(ws, firstData0, rows.length + 1, pick("days"), DAYS_FMT);

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
function buildCustomerSheet(
  rows: DsoRow[],
  lookbackDays: number,
  meta: DsoExportMeta,
): XLSX.WorkSheet {
  const header = [
    "Customer", "Group", "Company", "Location", "Salesperson", "Category",
    "DSO (days)", "Beyond Lookback", "Agreed Terms (days)", "Excess over Terms (days)",
    "Naive DSO (days)", "Avg Age of Open Bills (days)",
    "Outstanding", "Net Billings (lookback)", "Gross Sales (lookback)", "Credit Notes (lookback)",
    "Overdue (bill-wise)", "180+ (bill-wise)", "Max Overdue Days",
    "Days Since Last Receipt", "Last Receipt Date", "Months Since Last Sale", "Last Sale Month",
    "Credit Limit", "Utilization %", "Risk", "Blocked",
  ];
  const MONEY_COLS = [12, 13, 14, 15, 16, 17, 23];
  const DAYS_COLS = [6, 8, 9, 10, 11, 18, 19];

  const aoa: Array<Array<string | number>> = [];
  aoa.push([`${meta.title} — ${meta.scopeLabel}`]);
  aoa.push([`Lookback: ${meta.lookbackLabel}`]);
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
      // A capped DSO goes in as TEXT — it is a floor, not a measurement.
      f.beyondLookback ? `> ${lookbackDays} d` : Math.round(f.dso),
      f.beyondLookback ? "Yes" : "No",
      f.creditPeriod > 0 ? f.creditPeriod : "Not recorded",
      f.excessOverTerms === null ? "—" : Math.round(f.excessOverTerms),
      f.naiveDso === null ? "—" : Math.round(f.naiveDso),
      f.avgAgeOpenBills === null ? "—" : Math.round(f.avgAgeOpenBills),
      Math.round(f.ar),
      Math.round(f.salesWindow),
      Math.round(f.grossSales),
      Math.round(f.creditNotes),
      Math.round(f.overdue),
      Math.round(f.over180),
      f.maxOverdueDays,
      f.daysSinceLastReceipt === NEVER_PAID ? "Never" : f.daysSinceLastReceipt,
      f.lastReceiptDate ? formatDateDMY(f.lastReceiptDate) : "Never",
      f.monthsSinceLastSale === NEVER_SOLD ? "None" : f.monthsSinceLastSale,
      f.lastSaleMonth ?? "None",
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
    { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 20 },
    { wch: 15 }, { wch: 22 },
    { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 20 },
    { wch: 17 }, { wch: 15 }, { wch: 17 },
    { wch: 20 }, { wch: 17 }, { wch: 20 }, { wch: 15 },
    { wch: 14 }, { wch: 13 }, { wch: 10 }, { wch: 9 },
  ];

  formatCells(ws, firstData0, rows.length, MONEY_COLS, INR_FMT);
  formatCells(ws, firstData0, rows.length, DAYS_COLS, DAYS_FMT);

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
 * Sheet 3 — one row per OPEN BILL behind the listed customers, oldest first.
 *
 * Deliberately every open bill, not just the overdue ones: DSO is about how slowly the whole
 * receivable turns over. A bill inside its credit period still ties cash up.
 */
function buildBillSheet(bills: EnrichedBill[], meta: DsoExportMeta): XLSX.WorkSheet {
  const header = [
    "Customer", "Group", "Company", "Location", "Salesperson",
    "Bill No.", "Bill Ref", "Bill Date", "Age (days)", "Due Date", "Days Overdue",
    "Bill Amount", "Received", "Pending", "Sale Type",
  ];
  const MONEY_COLS = [11, 12, 13];
  const DAYS_COLS = [8, 10];

  const asOf = new Date(meta.asOfDate).getTime();
  const ageOf = (iso: string): number | null => {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || Number.isNaN(asOf)) return null;
    return Math.max(0, Math.round((asOf - t) / 86_400_000));
  };

  const open = bills
    .filter((b) => (b.inv.pending ?? 0) > 0.5)
    .sort((a, b) => (ageOf(b.inv.date) ?? 0) - (ageOf(a.inv.date) ?? 0));

  const aoa: Array<Array<string | number>> = [];
  aoa.push([`Open bills behind the listed customers, as on ${formatDateDMY(meta.asOfDate)}`]);
  aoa.push([]);
  const headerRow0 = aoa.length;
  aoa.push(header);

  const firstData0 = aoa.length;
  for (const b of open) {
    const age = b.inv.date ? ageOf(b.inv.date) : null;
    aoa.push([
      b.cust.name,
      b.dims.group,
      b.cust.company,
      b.cust.location,
      b.cust.salesPerson || "Others",
      b.inv.number,
      b.inv.billRefName,
      b.inv.date ? formatDateDMY(b.inv.date) : "—",
      age === null ? "—" : age,
      b.inv.dueDate ? formatDateDMY(b.inv.dueDate) : "—",
      b.inv.overdueDays,
      Math.round(b.inv.amount),
      Math.round(b.inv.amount - b.inv.pending),
      Math.round(b.inv.pending),
      b.inv.voucherType,
    ]);
  }

  const totalRow0 = aoa.length;
  aoa.push([
    "TOTAL", "", "", "", "", "", "", "", "", "", "",
    "", "", Math.round(open.reduce((s, b) => s + b.inv.pending, 0)), "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = [
    { wch: 38 }, { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 18 },
    { wch: 20 }, { wch: 20 }, { wch: 13 }, { wch: 11 }, { wch: 13 }, { wch: 13 },
    { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 13 },
  ];

  formatCells(ws, firstData0, open.length + 1, MONEY_COLS, INR_FMT);
  formatCells(ws, firstData0, open.length, DAYS_COLS, DAYS_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  styleRow(ws, totalRow0, ncols, GRAND_TOTAL_STYLE);

  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: headerRow0, c: 0 },
      { r: headerRow0 + open.length, c: ncols - 1 },
    ),
  };
  ws["!freeze"] = { xSplit: 1, ySplit: headerRow0 + 1 };
  return ws;
}

export function exportDsoXlsx(
  roots: GroupNode<DsoMetrics>[],
  total: DsoMetrics,
  leafRows: DsoRow[],
  bills: EnrichedBill[],
  columns: DsoColumn[],
  dayVec: number[],
  meta: DsoExportMeta,
): void {
  const lookbackDays = lookbackDaysOf(dayVec);
  const wb = XLSX.utils.book_new();
  // Excel caps sheet names at 31 chars and rejects most punctuation.
  const tab = meta.title.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "DSO";
  XLSX.utils.book_append_sheet(wb, buildRollupSheet(roots, total, columns, lookbackDays, meta), tab);
  XLSX.utils.book_append_sheet(wb, buildCustomerSheet(leafRows, lookbackDays, meta), "Customers");
  XLSX.utils.book_append_sheet(wb, buildBillSheet(bills, meta), "Open Bills");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const stamp = formatDateDMY(meta.asOfDate) || "export";
  const file = meta.title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${file}_${stamp}.xlsx`,
  );
}
