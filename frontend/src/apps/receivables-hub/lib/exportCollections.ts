/**
 * exportCollections.ts — the Excel export for all three Collection Performance reports
 * (Zero Collections at threshold 0, Below-30% at threshold 30, and Dormant Debtors —
 * one workbook shape, since they share one engine).
 *
 * ONE sheet, flat, built to be worked in rather than read:
 *
 *  1. Every grouping level is its OWN COLUMN, and the detail rows are leaves. No indentation:
 *     that is what makes the sheet sortable, filterable and pivotable, where the old single
 *     indented column carried its hierarchy as leading spaces that Excel cannot read.
 *
 *     ONE exception to "leaves only": each TOP-LEVEL group gets a total row HEADING its block —
 *     grouped by Salesperson, that is what the sales head opens the file to read, so it comes
 *     before the detail rather than after it. The grand total leads the whole sheet for the same
 *     reason, frozen under the header. The inner levels carry no totals; a pivot rebuilds those.
 *
 *     Know the cost: a SUM down the WHOLE Outstanding column double-counts, re-sorting the sheet
 *     in Excel scatters the total rows away from their blocks, and the autofilter range now spans
 *     the totals (it has to be contiguous), so a filter can hide them. Sum within a block, or
 *     read the GRAND TOTAL at the top.
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
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "./xlsxStyle";
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

// TOTAL_STYLE (light green) marks the one subtotal row per top-level group; GRAND_TOTAL_STYLE
// (strong green) stays reserved for the single row at the bottom, so the two never read alike.

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
  /** This row is a top-level group's TOTAL, not detail — see buildRollupSheet. */
  isSubtotal?: boolean;
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
 * The sheet: a three-line preamble, then one column per grouping level beside the visible metric
 * columns — and TOTALS FIRST. The grand total sits directly under the header, and each group's
 * total heads its own block rather than closing it, so the figure arrives before the detail that
 * explains it and you never scroll to find it.
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
   * Every DETAIL row is a leaf carrying its full chain, so every grouping column is filled; the
   * subtotal rows fill the first column only. `meta.dims` is empty only if a report ever renders
   * ungrouped, and the fallback keeps one label column so the sheet is never headerless.
   */
  const dimLabels = meta.dims.length ? meta.dims.map((d) => d.label) : [meta.viewLabel];
  const nDims = dimLabels.length;

  // The metric block, written after the dimension block — every column ticked on screen, in screen
  // order. (This used to drop "Customers"; it no longer does. See cellForRow.)
  const metricCols = columns;

  /**
   * "Customers" is blanked on DETAIL rows, but only when it would be a column of ones.
   *
   * The column counts how many customers a row covers. Group by … → Customer → … and every detail
   * row is one customer by construction, so the column reads 1 all the way down: noise beside the
   * name, inviting the reader to wonder what they'd missed. Group by Salesperson → Customer Group
   * → Sale Type and a detail row covers however many customers bought that type inside that group
   * — a real number that must not be hidden.
   *
   * So the test is the GROUPING, not leaf-ness. Subtotal and grand-total rows always carry it:
   * "how many customers is this salesperson sitting on" is the whole reason the column exists.
   */
  const customerIsGrouped = meta.dims.some((d) => d.key === "customer");
  const cellForRow = (c: ZCColumn, r: FlatRow): string | number =>
    c.key === "customers" && customerIsGrouped && !r.isSubtotal
      ? ""
      : cellFor(c, r.metrics, !r.isSubtotal);

  const header = [...dimLabels, ...metricCols.map((c) => c.label)];
  const headerRow0 = aoa.length;
  aoa.push(header);

  // The grand total leads the sheet, immediately under the header, and is frozen alongside it
  // (see !freeze) so it stays on screen however far you scroll. At the bottom it was a figure you
  // had to go looking for, past however many hundred rows the report happened to produce.
  const grandRow0 = aoa.length;
  aoa.push([
    "GRAND TOTAL",
    ...Array.from({ length: nDims - 1 }, () => ""),
    ...metricCols.map((c) => cellFor(c, total, false)),
  ]);

  const firstData0 = aoa.length;
  /**
   * LEAVES, plus ONE total row per TOP-LEVEL group, HEADING its block. The inner levels stay
   * unexported.
   *
   * Every interim total used to be dropped, because interleaving totals with detail is what makes
   * a spreadsheet misbehave: a SUM down the column double-counts, and any sort or filter scatters
   * the totals away from the rows they were summing. That is still true of the INNER levels, and a
   * pivot rebuilds those on demand from the grouping columns, correctly.
   *
   * The outermost level is the exception, and it is worth the cost. Grouped by Salesperson, that
   * row is "what this person is sitting on" — the one figure the sales head reads before anything
   * else, and the reason the sheet gets opened at all. Rebuilding it by hand in Excel every time
   * is not a reasonable ask of the person it is mailed to.
   *
   * The trade-off is real and accepted: SUM the whole Outstanding column and you get double the
   * money, and re-sorting the sheet in Excel moves the total rows away from their blocks. Sum
   * within a block, or read the GRAND TOTAL at the top.
   */
  const emitted: FlatRow[] = [];
  for (const root of roots) {
    // flatten() is pre-order, so the root is always first and its subtree follows.
    const [self, ...rest] = flatten([root]);
    // A single grouping level makes the root its own leaf — emit it once, as detail. Otherwise it
    // would appear twice, as a row and as a total of itself.
    if (!rest.length) { emitted.push(self); continue; }
    // Total FIRST, then the rows it is made of: the block reads as a headline and its working,
    // and a salesperson's figure is on screen the moment you reach their name.
    emitted.push({ ...self, isSubtotal: true });
    emitted.push(...rest.filter((r) => r.isLeaf));
  }

  for (const r of emitted) {
    // A subtotal names its group in the FIRST column and leaves the levels it is summing over
    // blank — those are precisely what it collapsed.
    const dimCells: (string | number)[] = Array.from({ length: nDims }, (_, i) =>
      r.isSubtotal
        ? (i === 0 ? `${r.labels[0]} — TOTAL` : "")
        : (r.labels[i] ?? ""),
    );
    aoa.push([...dimCells, ...metricCols.map((c) => cellForRow(c, r))]);
  }

  const lastRow0 = aoa.length - 1;

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = [
    // The first level is usually the widest (customer names run long); the rest are narrower.
    ...dimLabels.map((_, i) => ({ wch: i === 0 ? 34 : 26 })),
    ...metricCols.map(() => ({ wch: 16 })),
  ];

  // Metric columns now start after the dimension block, not after a single label column. The
  // formatted span starts at the GRAND TOTAL row, which now leads the block, and runs to the end.
  const pick = (k: ZCColumn["kind"]) =>
    metricCols.map((c, i) => (c.kind === k ? i + nDims : -1)).filter((i) => i >= 0);
  const nFormatted = lastRow0 - grandRow0 + 1;
  formatCells(ws, grandRow0, nFormatted, pick("money"), INR_FMT);
  formatCells(ws, grandRow0, nFormatted, pick("pct"), PCT_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  styleRow(ws, grandRow0, ncols, GRAND_TOTAL_STYLE);
  // The only hierarchy left to signal: one total row heading each top-level group.
  emitted.forEach((r, i) => {
    if (r.isSubtotal) styleRow(ws, firstData0 + i, ncols, TOTAL_STYLE);
  });

  // Freeze the dimension block (so the grouping columns stay put when scrolling right) AND the
  // header + grand total (so the sheet's headline figure is always on screen). That pinning is
  // half the point of moving the grand total to the top.
  ws["!freeze"] = { xSplit: nDims, ySplit: grandRow0 + 1 };
  // Autofilter over the dimension columns + metrics: with real columns this sheet can now be
  // sliced in Excel the same way the Customers sheet can.
  //
  // The range has to run from the header to the LAST row, which now puts both the grand total and
  // the group totals inside it: an autofilter range must be contiguous, and with the totals moved
  // above the rows they summarise there is no longer a clean block of detail to fence off. So a
  // filter treats the total rows as data and may hide them. Frozen panes keep the grand total
  // visible regardless; a group total that vanishes under a filter is the accepted cost of having
  // it lead its block.
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: headerRow0, c: 0 },
      { r: lastRow0, c: ncols - 1 },
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
