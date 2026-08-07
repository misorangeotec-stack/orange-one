/**
 * exportCollections.ts — the Excel export for all three Collection Performance reports
 * (Zero Collections at threshold 0, Below-30% at threshold 30, and Dormant Debtors —
 * one workbook shape, since they share one engine).
 *
 * ONE sheet, flat, built to be worked in rather than read:
 *
 *  1. Every grouping level is its OWN COLUMN and every row is a leaf. No indentation, no
 *     interleaved subtotals. That is what makes the sheet sortable, filterable and pivotable
 *     — and it means a SUM down a column is correct, which it is not when group totals sit in
 *     among the detail.
 *
 *  2. Money is written as NUMBERS with an INR display format, never as pre-formatted
 *     strings ("₹1.20 L"). Strings look right and are useless — Excel can't SUM them.
 *     Percentages get the same treatment (a numeric 12.3 with a `0.0"%"` display format),
 *     so finance can sort and filter on them.
 *
 *  3. A percentage is NEVER summed. The % cells come from each node's own
 *     Σcollected / Σcollectible via the column's value() — the same function the screen uses.
 *
 * The preamble is three lines (title, what it is, period) and nothing more. It used to carry
 * As on / View / Basis / Shortfall target / Filters too; that was seven rows of scaffolding
 * ahead of the first number. The cost is that the sheet no longer records the filters behind
 * it, so a mailed copy can't be traced back to the screen that produced it — accepted
 * deliberately, on the grounds that nobody was reading the band anyway.
 */

import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { formatDateDMY } from "./utils";
import { HEADER_STYLE, GRAND_TOTAL_STYLE, styleRow } from "./xlsxStyle";
import {
  NEVER_PAID, NEVER_SOLD,
  type ZCColumn, type ZCMetrics,
} from "./collections";
import type { GroupNode } from "./groupTree";

/** INR cell number format (whole rupees, "₹" prefixed, dash for zero). */
const INR_FMT = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';

/** A literal "%" suffix — the cell holds 12.3, not 0.123, so it stays readable AND numeric.
 *  (Excel's native `0.0%` would multiply by 100 and render 1230.0%.) */
const PCT_FMT = '0.0"%";-0.0"%";"—"';

// (No subtotal style here: this sheet exports leaf rows only — see buildRollupSheet. The shared
// TOTAL_STYLE is still used by the other receivables exports, which do carry subtotal rows.)

export interface ZCExportMeta {
  /** Report title, e.g. "Customers Below 30% Collection". */
  title: string;
  /** One line saying what the report is — the same sentence shown under the title on screen. */
  description: string;
  /** The View preset name. Not printed; the fallback header when a report renders ungrouped. */
  viewLabel: string;
  /**
   * The active grouping levels, outermost first — one exported column each on the roll-up sheet.
   * Labels, not keys ("Sale Type", not "saleType"), so the sheet reads like the screen.
   */
  dims: { key: string; label: string }[];
  /** Human-readable period, e.g. "Last 3 Months (01-05-2026 → 12-07-2026)". */
  periodLabel: string;
  /** Not printed — only stamps the downloaded filename. */
  asOfDate: string;
}

/** Days-since-receipt renders as a number, except the never-paid sentinel. */
const daysCell = (v: number): string | number =>
  v === NEVER_PAID ? "Never" : v < 0 ? "—" : v;

/** Months-since-sale renders as a number, except the never-sold sentinel. "None", not "Never":
 *  it can only ever mean "nothing billed inside the data horizon" — see CollectionFacts. */
const monthsCell = (v: number): string | number =>
  v === NEVER_SOLD ? "None" : v < 0 ? "—" : v;

/** A null percentage (no denominator) must render as a dash, never as 0%. */
const pctCell = (v: number | null): string | number =>
  v === null ? "—" : Math.round(v * 10) / 10;

/** Last-receipt cell: the yyyymmdd ordinal → dd-mm-yyyy, 0 (no receipt) → "Never". */
const dateCell = (v: number): string => {
  if (!v) return "Never";
  const s = String(v);
  return formatDateDMY(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`) || "Never";
};

/** One column's value for one node, ready to drop into a cell. `isLeaf` blanks the leaf-only
 *  columns (last receipt date/amount) on group and grand-total rows. */
const cellFor = (col: ZCColumn, m: ZCMetrics, isLeaf: boolean): string | number => {
  if (col.leafOnly && !isLeaf) return "—";
  const v = col.value(m);
  if (v === null) return "—";
  if (col.kind === "pct") return pctCell(v);
  if (col.kind === "days") return daysCell(v);
  if (col.kind === "date") return dateCell(v);
  if (col.kind === "months") return monthsCell(v);
  return Math.round(v);
};

interface FlatRow {
  /** One entry per grouping level, root first: the labels of this node's ancestors and itself.
   *  Shorter than the dimension list on a subtotal row — a salesperson subtotal has only its own
   *  label, because the customer and sale type below it are precisely what it is summing over. */
  labels: string[];
  depth: number;
  metrics: ZCMetrics;
  isLeaf: boolean;
}

/**
 * Pre-order walk of the tree → flat rows, each carrying the LABELS of its whole ancestor chain.
 *
 * The chain is what lets the sheet give every grouping level its own column. `GroupNode.path`
 * looks like it would do the job and doesn't: it carries bucket VALUES, and for Sale Type the
 * value is the raw key ("spare_parts") where the screen shows "Spare Parts". Walking the tree
 * and collecting `label` keeps Excel and the screen reading identically.
 */
function flatten(nodes: GroupNode<ZCMetrics>[]): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (list: GroupNode<ZCMetrics>[], ancestors: string[]) => {
    for (const n of list) {
      const labels = [...ancestors, n.sub ? `${n.label} (${n.sub})` : n.label];
      out.push({ labels, depth: n.depth, metrics: n.metrics, isLeaf: n.children.length === 0 });
      if (n.children.length) walk(n.children, labels);
    }
  };
  walk(nodes, []);
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
 * The sheet: a three-line preamble, then one column per grouping level beside the visible
 * metric columns, one row per leaf, then the grand total.
 */
function buildRollupSheet(
  roots: GroupNode<ZCMetrics>[],
  total: ZCMetrics,
  columns: ZCColumn[],
  meta: ZCExportMeta,
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [];

  // THREE rows and nothing else: what the report is called, what it means, and what period it
  // covers. The block used to carry As on / View / Basis / Shortfall target / Filters as well —
  // seven rows of preamble before a single figure, which read as clutter rather than context.
  // (Trade-off accepted deliberately: the sheet no longer records which filters produced it, so a
  // mailed copy can't be audited back to the screen that made it. The period is still stated.)
  aoa.push([meta.title]);
  aoa.push([meta.description]);
  aoa.push(["Period", meta.periodLabel]);
  aoa.push([]);

  /**
   * ONE COLUMN PER GROUPING LEVEL, not one indented column.
   *
   * Group by Salesperson → Customer → Sale Type and you get three real columns, so the sheet can
   * be pivoted, filtered and sorted in Excel. The old single indented column carried the same
   * information as leading spaces, which Excel cannot group, filter or pivot on at all.
   *
   * Every exported row is a LEAF, carrying its full chain, so every grouping column is filled.
   * `meta.dims` is empty only if a report ever renders ungrouped, and the fallback keeps one label
   * column so the sheet is never headerless.
   */
  const dimLabels = meta.dims.length ? meta.dims.map((d) => d.label) : [meta.viewLabel];
  const nDims = dimLabels.length;

  /**
   * "Customers" is dropped from the export.
   *
   * It counts how many customers a row covers, which is meaningful on screen where a salesperson
   * row stands for 40 of them. Every exported row is a leaf, so the column would read 1 all the
   * way down — a column of ones next to the customer name, inviting the reader to wonder what
   * they'd missed. It stays on screen; only the sheet loses it.
   */
  const metricCols = columns.filter((c) => c.key !== "customers");

  const header = [...dimLabels, ...metricCols.map((c) => c.label)];
  const headerRow0 = aoa.length;
  aoa.push(header);

  const firstData0 = aoa.length;
  /**
   * LEAVES ONLY — the interim group-total rows are deliberately not exported.
   *
   * On screen the subtotal rows are the point: they collapse and expand. In a spreadsheet they
   * are in the way — they interleave totals with detail, so a SUM over the column double-counts,
   * and any sort or filter scatters them away from the rows they were summing. A flat leaf table
   * is what Excel is good at: every grouping level is a column, so a pivot rebuilds any subtotal
   * on demand, correctly. The grand total still sits at the bottom, below the filter range.
   *
   * Nothing is lost: leaves are the finest buckets, so they add up to exactly the same grand total.
   */
  const rows = flatten(roots).filter((r) => r.isLeaf);
  for (const r of rows) {
    const dimCells: (string | number)[] = Array.from({ length: nDims }, (_, i) => r.labels[i] ?? "");
    aoa.push([...dimCells, ...metricCols.map((c) => cellFor(c, r.metrics, r.isLeaf))]);
  }

  const grandRow0 = aoa.length;
  aoa.push([
    "GRAND TOTAL",
    ...Array.from({ length: nDims - 1 }, () => ""),
    ...metricCols.map((c) => cellFor(c, total, false)),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = [
    // The first level is usually the widest (customer names run long); the rest are narrower.
    ...dimLabels.map((_, i) => ({ wch: i === 0 ? 34 : 26 })),
    ...metricCols.map(() => ({ wch: 16 })),
  ];

  // Metric columns now start after the dimension block, not after a single label column.
  // +1 on the row count → include the grand total.
  const pick = (k: ZCColumn["kind"]) =>
    metricCols.map((c, i) => (c.kind === k ? i + nDims : -1)).filter((i) => i >= 0);
  formatCells(ws, firstData0, rows.length + 1, pick("money"), INR_FMT);
  formatCells(ws, firstData0, rows.length + 1, pick("pct"), PCT_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  // No per-row styling: every data row is a leaf now, so there is no hierarchy left to signal.
  styleRow(ws, grandRow0, ncols, GRAND_TOTAL_STYLE);

  // Freeze the header block + the whole dimension block, so the grouping columns stay on screen
  // while scrolling right through the metrics.
  ws["!freeze"] = { xSplit: nDims, ySplit: headerRow0 + 1 };
  // Autofilter over the dimension columns + metrics: with real columns this sheet can now be
  // sliced in Excel the same way the Customers sheet can.
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: headerRow0, c: 0 },
      { r: grandRow0 - 1, c: ncols - 1 },
    ),
  };

  return ws;
}


/**
 * ONE sheet, not two.
 *
 * There used to be a second "Customers" tab: flat, one row per customer, every column whether or
 * not it was ticked on screen. It existed because the roll-up sheet put the whole hierarchy in a
 * single indented column, which Excel cannot filter or pivot — so finance needed somewhere to
 * slice the data. Now that each grouping level has its own real column and the sheet carries an
 * autofilter, that need is gone and a second tab is just a thing to explain.
 */
export function exportCollectionsXlsx(
  roots: GroupNode<ZCMetrics>[],
  total: ZCMetrics,
  columns: ZCColumn[],
  meta: ZCExportMeta,
): void {
  const wb = XLSX.utils.book_new();
  // Excel caps sheet names at 31 chars and rejects most punctuation.
  const tab = meta.title.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Collections";
  XLSX.utils.book_append_sheet(wb, buildRollupSheet(roots, total, columns, meta), tab);

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const stamp = formatDateDMY(meta.asOfDate) || "export";
  const file = meta.title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${file}_${stamp}.xlsx`,
  );
}
