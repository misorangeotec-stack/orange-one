/**
 * exportCollections.ts — the Excel export for the Collection Performance reports
 * (Zero Collections at threshold 0, Below-30% at threshold 30 — same workbook shape).
 *
 * Three rules drive everything here:
 *
 *  1. WYSIWYG. The workbook carries exactly what was on screen — same period, threshold,
 *     filters, view preset, sort and visible columns. An export that quietly differs from
 *     the thing that was reviewed is worse than no export at all. Hence the Filters band:
 *     without it, a sheet mailed on Monday is unauditable by Friday.
 *
 *  2. Money is written as NUMBERS with an INR display format, never as pre-formatted
 *     strings ("₹1.20 L"). Strings look right and are useless — Excel can't SUM them.
 *     Percentages get the same treatment (a numeric 12.3 with a `0.0"%"` display format),
 *     so finance can sort and filter on them.
 *
 *  3. A percentage is NEVER summed. The roll-up sheet's % cells come from each node's own
 *     Σcollected / Σcollectible via the column's value() — the same function the screen
 *     uses. Sheet 2 additionally gets an autofilter so finance can slice it without coming
 *     back to the app, which is what they'll actually do.
 */

import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { formatDateDMY } from "./utils";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "./xlsxStyle";
import { utilizationPct } from "./receivables";
import {
  NEVER_PAID, BAND_LABELS, bandOf, shortfallOf,
  type ZCColumn, type ZCMetrics, type ZCRow,
} from "./collections";
import type { GroupNode } from "./groupTree";

/** INR cell number format (whole rupees, "₹" prefixed, dash for zero). */
const INR_FMT = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';

/** A literal "%" suffix — the cell holds 12.3, not 0.123, so it stays readable AND numeric.
 *  (Excel's native `0.0%` would multiply by 100 and render 1230.0%.) */
const PCT_FMT = '0.0"%";-0.0"%";"—"';

export interface ZCExportMeta {
  /** Report title, e.g. "Customers Below 30% Collection". */
  title: string;
  /** The View preset name, e.g. "Salesperson → Customer". */
  viewLabel: string;
  /** Human-readable period, e.g. "Last 3 Months (01-05-2026 → 12-07-2026)". */
  periodLabel: string;
  /** The basis paragraph — how the number was arrived at. */
  basis: string;
  /** Shortfall target, in percent. */
  targetPct: number;
  asOfDate: string;
  /** Active-filter lines, e.g. ["Salesperson: Rakesh, Vinay", "Min Outstanding: ≥ ₹1 L"]. */
  filterSummary: string[];
}

/** Days-since-receipt renders as a number, except the never-paid sentinel. */
const daysCell = (v: number): string | number =>
  v === NEVER_PAID ? "Never" : v < 0 ? "—" : v;

/** A null percentage (no denominator) must render as a dash, never as 0%. */
const pctCell = (v: number | null): string | number =>
  v === null ? "—" : Math.round(v * 10) / 10;

/** One column's value for one node, ready to drop into a cell. */
const cellFor = (col: ZCColumn, m: ZCMetrics): string | number => {
  const v = col.value(m);
  if (v === null) return "—";
  if (col.kind === "pct") return pctCell(v);
  if (col.kind === "days") return daysCell(v);
  return Math.round(v);
};

/** Pre-order walk of the tree → flat rows carrying their depth and whether they're a leaf. */
function flatten(
  nodes: GroupNode<ZCMetrics>[],
): { label: string; depth: number; metrics: ZCMetrics; isLeaf: boolean }[] {
  const out: { label: string; depth: number; metrics: ZCMetrics; isLeaf: boolean }[] = [];
  const walk = (list: GroupNode<ZCMetrics>[]) => {
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

/** Apply a number format to a span of columns on a span of rows (both 0-indexed). */
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

/**
 * Sheet 1 — the roll-up, exactly as displayed: title + period + filter bands, then the
 * depth-indented tree, then the grand total.
 */
function buildRollupSheet(
  roots: GroupNode<ZCMetrics>[],
  total: ZCMetrics,
  columns: ZCColumn[],
  meta: ZCExportMeta,
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [];

  aoa.push([meta.title]);
  aoa.push(["Period", meta.periodLabel]);
  aoa.push(["As on", formatDateDMY(meta.asOfDate)]);
  aoa.push(["View", meta.viewLabel]);
  aoa.push(["Basis", meta.basis]);
  aoa.push(["Shortfall target", `${meta.targetPct}%`]);
  aoa.push(["Filters", meta.filterSummary.length ? meta.filterSummary.join(" · ") : "None"]);
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
  ws["!cols"] = [{ wch: 40 }, ...columns.map(() => ({ wch: 16 }))];

  // +1 on the row count → include the grand total.
  const pick = (k: ZCColumn["kind"]) =>
    columns.map((c, i) => (c.kind === k ? i + 1 : -1)).filter((i) => i >= 0);
  formatCells(ws, firstData0, rows.length + 1, pick("money"), INR_FMT);
  formatCells(ws, firstData0, rows.length + 1, pick("pct"), PCT_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  // Parent rows are subtotals of their children — tint them so the hierarchy survives
  // the trip into Excel, where the indent alone is easy to miss.
  rows.forEach((r, i) => {
    if (!r.isLeaf) styleRow(ws, firstData0 + i, ncols, TOTAL_STYLE);
  });
  styleRow(ws, grandRow0, ncols, GRAND_TOTAL_STYLE);

  // Freeze the header block + the label column.
  ws["!freeze"] = { xSplit: 1, ySplit: headerRow0 + 1 };

  return ws;
}

/**
 * Sheet 2 — flat, one row per listed customer, every column regardless of the ColumnPicker.
 * This is the sheet finance pivots and filters in, so it gets the autofilter and the full
 * attribute set (including the leaf-only columns the roll-up can't show on a group row).
 */
function buildCustomerSheet(rows: ZCRow[], meta: ZCExportMeta): XLSX.WorkSheet {
  const header = [
    "Customer", "Group", "Company", "Location", "Salesperson", "Category",
    "Outstanding", "Overdue", "> 180 Days",
    "Opening", "Sales in Period", "Collectible", "Collected",
    "Collection %", "Collection % (net of cheque returns)", `Shortfall vs ${meta.targetPct}%`, "Band",
    "Prior Collections", "Prior %", "Δ pp",
    "Cheque Returns", "Credit Notes",
    "Max Overdue Days", "Days Since Receipt", "Last Receipt Date",
    "Credit Limit", "Utilization %", "Risk", "Blocked",
  ];
  const MONEY_COLS = [6, 7, 8, 9, 10, 11, 12, 15, 17, 20, 21, 25];
  const PCT_COLS = [13, 14, 18, 19];

  const aoa: Array<Array<string | number>> = [];
  aoa.push([`${meta.title} — ${meta.periodLabel}`]);
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
      Math.round(c.outstanding),
      Math.round(c.overdue),
      Math.round(c.agingBuckets?.["180_plus"] ?? 0),
      Math.round(f.opening),
      Math.round(f.salesInWindow),
      Math.round(f.collectible),
      Math.round(f.collected),
      pctCell(f.pct),
      pctCell(f.pctNet),
      Math.round(shortfallOf(f, meta.targetPct)),
      BAND_LABELS[bandOf(f)],
      Math.round(f.inPrior),
      pctCell(f.priorPct),
      pctCell(f.deltaPp),
      Math.round(f.chequeReturns),
      Math.round(f.creditNotes),
      c.maxOverdueDays ?? 0,
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
    { wch: 15 }, { wch: 15 }, { wch: 15 },
    { wch: 15 }, { wch: 16 }, { wch: 15 }, { wch: 15 },
    { wch: 13 }, { wch: 30 }, { wch: 17 }, { wch: 13 },
    { wch: 17 }, { wch: 11 }, { wch: 10 },
    { wch: 15 }, { wch: 14 },
    { wch: 16 }, { wch: 17 }, { wch: 16 },
    { wch: 15 }, { wch: 13 }, { wch: 10 }, { wch: 9 },
  ];

  formatCells(ws, firstData0, rows.length, MONEY_COLS, INR_FMT);
  formatCells(ws, firstData0, rows.length, PCT_COLS, PCT_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);

  // The two things that make this sheet actually usable outside the app.
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: headerRow0, c: 0 },
      { r: headerRow0 + rows.length, c: ncols - 1 },
    ),
  };
  ws["!freeze"] = { xSplit: 1, ySplit: headerRow0 + 1 };

  return ws;
}

export function exportCollectionsXlsx(
  roots: GroupNode<ZCMetrics>[],
  total: ZCMetrics,
  leafRows: ZCRow[],
  columns: ZCColumn[],
  meta: ZCExportMeta,
): void {
  const wb = XLSX.utils.book_new();
  // Excel caps sheet names at 31 chars and rejects most punctuation.
  const tab = meta.title.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Collections";
  XLSX.utils.book_append_sheet(wb, buildRollupSheet(roots, total, columns, meta), tab);
  XLSX.utils.book_append_sheet(wb, buildCustomerSheet(leafRows, meta), "Customers");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const stamp = formatDateDMY(meta.asOfDate) || "export";
  const file = meta.title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${file}_${stamp}.xlsx`,
  );
}
