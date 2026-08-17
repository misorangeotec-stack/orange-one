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
import { saleTypeLabel } from "./salesReport";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "./xlsxStyle";
import {
  NEVER_PAID, NEVER_SOLD,
  type ZCColumn, type ZCMetrics,
} from "./collections";
import type { InvoiceDrillRow } from "../components/InvoiceDrilldownDialog";
import type { GroupNode } from "./groupTree";

/** INR cell number format (whole rupees, "₹" prefixed, dash for zero). */
const INR_FMT = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';

/** A literal "%" suffix — the cell holds 12.3, not 0.123, so it stays readable AND numeric.
 *  (Excel's native `0.0%` would multiply by 100 and render 1230.0%.) */
const PCT_FMT = '0.0"%";-0.0"%";"-"';

/** How an empty cell reads. A plain hyphen: the report's copy carries no em dashes. */
const NIL = "-";

// ── Column widths ───────────────────────────────────────────────────────────────────

/**
 * Widths are MEASURED from the cells, not guessed at a flat 34/26/16.
 *
 * The fixed widths were set for the worst case and paid for it on every sheet: a Salesperson
 * column holding "NAKUL JI" was 34 characters wide, so the reader scrolled past a screenful of
 * whitespace before reaching a number. Measuring means a column is exactly as wide as its widest
 * value and no wider.
 *
 * THE PREAMBLE IS EXCLUDED FROM THE MEASUREMENT, and that is the whole trick. Row 2 holds the
 * report's one-line description and row 3 the period label, both in column A; measured, either
 * would pin the first column to the cap on its own. Excel spills a long string across the empty
 * cells to its right anyway, so the preamble stays perfectly readable at any width.
 */
const MIN_WCH = 9;
const MAX_WCH = 38;

/** Rendered width of one cell. Money is measured as it DISPLAYS (grouped digits + the symbol),
 *  not as the raw number, or every money column comes out several characters too narrow. */
function cellWidth(v: string | number | undefined, isMoney: boolean): number {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "number") {
    const digits = Math.round(Math.abs(v)).toLocaleString("en-IN").length;
    return digits + (isMoney ? 3 : 0) + (v < 0 ? 1 : 0);
  }
  return v.length;
}

/** `!cols` sized to the widest cell in each column, clamped both ways. */
function autoWidths(
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
  ncols: number,
  moneyCols: ReadonlySet<number>,
  pad = 2,
): XLSX.ColInfo[] {
  const widest = new Array<number>(ncols).fill(0);
  for (const row of rows) {
    for (let c = 0; c < ncols; c++) {
      const w = cellWidth(row[c], moneyCols.has(c));
      if (w > widest[c]) widest[c] = w;
    }
  }
  return widest.map((w) => ({ wch: Math.min(MAX_WCH, Math.max(MIN_WCH, w + pad)) }));
}

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
  v === NEVER_PAID ? "Never" : v < 0 ? NIL : v;

/** Months-since-sale renders as a number, except the never-sold sentinel. "None", not "Never":
 *  it can only ever mean "nothing billed inside the data horizon" — see CollectionFacts. */
const monthsCell = (v: number): string | number =>
  v === NEVER_SOLD ? "None" : v < 0 ? NIL : v;

/** A null percentage (no denominator) must render as a dash, never as 0%. */
const pctCell = (v: number | null): string | number =>
  v === null ? NIL : Math.round(v * 10) / 10;

/** Last-receipt cell: the yyyymmdd ordinal → dd-mm-yyyy, 0 (no receipt) → "Never". */
const dateCell = (v: number): string => {
  if (!v) return "Never";
  const s = String(v);
  return formatDateDMY(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`) || "Never";
};

/** One column's value for one node, ready to drop into a cell. `isLeaf` blanks the leaf-only
 *  columns (last receipt date/amount) on group and grand-total rows. */
const cellFor = (col: ZCColumn, m: ZCMetrics, isLeaf: boolean): string | number => {
  if (col.leafOnly && !isLeaf) return NIL;
  const v = col.value(m);
  if (v === null) return NIL;
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
 *
 * `n.sub` IS DROPPED. For a customer it is the trading company and branch, so every name came out
 * as "ACME LTD (Enterprise / Colorix · Surat)": it roughly doubled the width of the widest column
 * on the sheet to append internal structure the reader cannot act on, and the parenthesis made the
 * customer count beside it read as though it belonged to the company rather than the customer.
 * Company and branch are still on the Overdue Bill Details tab, per bill, in their own columns.
 */
function flatten(nodes: GroupNode<ZCMetrics>[]): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (list: GroupNode<ZCMetrics>[], ancestors: string[]) => {
    for (const n of list) {
      const labels = [...ancestors, n.label];
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
  // `null` is a blank spacer row closing a top-level block. Without it the sheet is one unbroken
  // column of names and the eye cannot find where one salesperson ends and the next begins; the
  // green total row heading the next block is the only cue, and it scrolls off. The bill sheet
  // below has always separated its blocks this way, so the two now read alike.
  type EmitRow = FlatRow | null;
  const emitted: EmitRow[] = [];
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
    emitted.push(null);
  }
  // A spacer at the very end is just a blank final row, which drags the autofilter range one row
  // past the data for no benefit.
  if (emitted.length && emitted[emitted.length - 1] === null) emitted.pop();

  for (const r of emitted) {
    if (!r) { aoa.push([]); continue; }
    // A subtotal names its group in the FIRST column and leaves the levels it is summing over
    // blank — those are precisely what it collapsed.
    const dimCells: (string | number)[] = Array.from({ length: nDims }, (_, i) =>
      r.isSubtotal
        ? (i === 0 ? `${r.labels[0]} - TOTAL` : "")
        : (r.labels[i] ?? ""),
    );
    aoa.push([...dimCells, ...metricCols.map((c) => cellForRow(c, r))]);
  }

  const lastRow0 = aoa.length - 1;

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  // Measured from the header row down, so the preamble's long sentences cannot set column A's
  // width. See autoWidths.
  ws["!cols"] = autoWidths(
    aoa.slice(headerRow0),
    ncols,
    new Set(metricCols.map((c, i) => (c.kind === "money" ? i + nDims : -1)).filter((i) => i >= 0)),
  );

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
    if (r?.isSubtotal) styleRow(ws, firstData0 + i, ncols, TOTAL_STYLE);
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
  //
  // The blank row between salespersons is inside the range too, so Excel's filter dropdowns will
  // offer "(Blanks)". Accepted knowingly: the sheet is read far more often than it is filtered,
  // and the spacing is what makes it readable.
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: headerRow0, c: 0 },
      { r: lastRow0, c: ncols - 1 },
    ),
  };

  return ws;
}


/**
 * Sheet 2 — the bills behind the Overdue column.
 *
 * WHY IT EXISTS
 *   The roll-up sheet states what a customer owes; this one states WHICH BILLS make it up, so a
 *   collector can work the phone from the file instead of clicking each figure on screen.
 *
 * THE SHAPE IS DELIBERATELY NOT A DATABASE TABLE
 *   Bills are blocked per customer, each block closed by its own TOTAL and separated by a blank
 *   row. That is the explicit ask: this sheet is meant to be READ, and a solid 4,000-row grid is
 *   not readable. Know the cost, which is the same one the roll-up sheet documents at the top of
 *   this file: a SUM down the whole Pending column double-counts, and re-sorting scatters the
 *   totals away from their blocks. There is deliberately NO autofilter here — a filter over
 *   interleaved spacer and total rows produces nonsense, and this sheet is for reading, not
 *   slicing. Slice on sheet 1.
 *
 * WHY THE ON ACCOUNT LINE IS HERE
 *   `buildDrillRows` emits a negative On Account line per ledger that carries one. The bills are
 *   GROSS; the report's Overdue is net of On Account. Without that line a customer's block sums
 *   to more than the Overdue column says and looks like a data error — which is exactly the
 *   defect commit f3adec4 fixed on screen. Keeping one builder for both is what keeps them equal.
 */
function buildOverdueBillsSheet(rows: InvoiceDrillRow[], meta: ZCExportMeta): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [];

  aoa.push([meta.title]);
  aoa.push(["Overdue bill details: the open past-due bills behind the Overdue column."]);
  aoa.push(["Period", meta.periodLabel]);
  aoa.push([]);

  const header = [
    "Salesperson", "Customer", "Company", "Location",
    "Bill No", "Bill Ref", "Bill Date", "Due Date", "Overdue Days", "Sale Type",
    "Bill Amount", "Received", "Pending",
  ];
  const headerRow0 = aoa.length;
  aoa.push(header);

  // Bucket by salesperson → customer, preserving one block per customer.
  const SEP = "|||";
  const blocks = new Map<string, InvoiceDrillRow[]>();
  for (const r of rows) {
    const key = `${r.salesperson ?? "Others"}${SEP}${r.customerName}${SEP}${r.company}${SEP}${r.location}`;
    const list = blocks.get(key);
    if (list) list.push(r); else blocks.set(key, [r]);
  }

  const pendingOf = (list: InvoiceDrillRow[]) => list.reduce((s, r) => s + r.pending, 0);

  // Heaviest salesperson first, and inside them the heaviest customer — the file opens on the
  // money that matters rather than on whoever sorts first alphabetically.
  const bySalesperson = new Map<string, string[]>();
  for (const key of blocks.keys()) {
    const sp = key.split(SEP)[0];
    const list = bySalesperson.get(sp);
    if (list) list.push(key); else bySalesperson.set(sp, [key]);
  }
  const spWeight = (sp: string) =>
    (bySalesperson.get(sp) ?? []).reduce((s, k) => s + pendingOf(blocks.get(k) ?? []), 0);
  const orderedKeys = [...bySalesperson.keys()]
    .sort((a, b) => spWeight(b) - spWeight(a))
    .flatMap((sp) =>
      (bySalesperson.get(sp) ?? []).sort(
        (a, b) => pendingOf(blocks.get(b) ?? []) - pendingOf(blocks.get(a) ?? []),
      ),
    );

  const grand = { amount: 0, received: 0, pending: 0 };
  for (const r of rows) {
    grand.amount += r.amount;
    grand.received += r.received;
    grand.pending += r.pending;
  }

  // Grand total under the header and frozen with it, matching the roll-up sheet: the headline
  // figure is on screen however far you scroll.
  const grandRow0 = aoa.length;
  aoa.push([
    "GRAND TOTAL", "", "", "", "", "", "", "", "", "",
    Math.round(grand.amount), Math.round(grand.received), Math.round(grand.pending),
  ]);

  const totalRows: number[] = [];

  for (const key of orderedKeys) {
    const list = blocks.get(key) ?? [];
    const [sp, customer, company, location] = key.split(SEP);
    /**
     * BILL DATE, OLDEST FIRST. The On Account credit sinks to the bottom, where it reads as the
     * deduction that reconciles the block rather than as another bill.
     *
     * This used to rank on Overdue Days, which LOOKS like the same order and is not: due days are
     * measured from the DUE date, so a bill sold in March on 90-day terms sits below one sold in
     * June on 7-day terms. The block then reads as an unordered pile, which is exactly how it was
     * reported. Bill date is the sequence a ledger is actually worked in.
     *
     * `date` is the raw ISO `yyyy-mm-dd` off the invoice row (never the dd-mm-yyyy the cell
     * displays), so a plain string comparison is a date comparison. An undated row sinks rather
     * than leading the block on an empty string.
     */
    const sorted = [...list].sort((a, b) => {
      if (!!a.isOnAccount !== !!b.isOnAccount) return a.isOnAccount ? 1 : -1;
      if (a.date !== b.date) {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date < b.date ? -1 : 1;
      }
      return b.overdueDays - a.overdueDays || a.number.localeCompare(b.number);
    });

    for (const r of sorted) {
      aoa.push([
        sp, customer, company, location,
        r.isOnAccount ? (r.onAccountLabel ?? "On Account") : r.number,
        r.billRefName,
        r.date ? (formatDateDMY(r.date) || "") : "",
        r.dueDate ? (formatDateDMY(r.dueDate) || "") : "",
        r.isOnAccount ? "" : r.overdueDays,
        r.isOnAccount ? "" : saleTypeLabel(r.voucherType),
        Math.round(r.amount), Math.round(r.received), Math.round(r.pending),
      ]);
    }

    totalRows.push(aoa.length);
    aoa.push([
      "", `${customer} - TOTAL`, "", "", "", "", "", "", "", "",
      Math.round(sorted.reduce((s, r) => s + r.amount, 0)),
      Math.round(sorted.reduce((s, r) => s + r.received, 0)),
      Math.round(pendingOf(sorted)),
    ]);
    aoa.push([]); // the readable gap between two customers
  }

  const lastRow0 = aoa.length - 1;
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;

  // Measured, not fixed — same reasoning as the roll-up sheet, and the preamble is excluded for
  // the same reason. Bill numbers and references vary wildly in length between companies, so a
  // guessed width is either wasteful or truncating on any given export.
  ws["!cols"] = autoWidths(aoa.slice(headerRow0), ncols, new Set([10, 11, 12]));

  formatCells(ws, grandRow0, lastRow0 - grandRow0 + 1, [10, 11, 12], INR_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  styleRow(ws, grandRow0, ncols, GRAND_TOTAL_STYLE);
  for (const r of totalRows) styleRow(ws, r, ncols, TOTAL_STYLE);

  // ⚠ INERT WITH THIS WRITER, KEPT DELIBERATELY. `xlsx-js-style` has no freeze-pane writer — the
  //   string "pane" appears in its bundle only inside the legacy SpreadsheetML *reader*, and the
  //   generated xl/worksheets/sheetN.xml carries an empty <sheetViews> with no <pane> element.
  //   So this line (and the identical one on the roll-up sheet above, which predates it) does
  //   nothing today. It stays because it is the correct declaration the moment the writer gains
  //   support, and because dropping it would quietly lose the intent. Do NOT write a comment
  //   claiming a row "stays on screen while you scroll" on the strength of it — it does not.
  ws["!freeze"] = { xSplit: 2, ySplit: grandRow0 + 1 };
  // No autofilter, on purpose — see the block comment above.

  return ws;
}

/** Everything the workbook needs. `overdueRows` comes from `buildDrillRows(..., "overdue")`. */
export interface ZCWorkbookInput {
  roots: GroupNode<ZCMetrics>[];
  total: ZCMetrics;
  columns: ZCColumn[];
  meta: ZCExportMeta;
  overdueRows: InvoiceDrillRow[];
}

/**
 * TWO sheets.
 *
 * Sheet 1 is the roll-up, unchanged in shape — but the caller now hands it a tree built at
 * Salesperson → Customer regardless of how the screen happens to be grouped. The report opens on
 * Salesperson → Customer Group, and a workbook that stopped at the group level would never name
 * a customer, which is the one thing the person receiving it needs.
 *
 * Sheet 2 is the bills behind Overdue. See buildOverdueBillsSheet.
 */
export function buildCollectionsWorkbook(input: ZCWorkbookInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  // Excel caps sheet names at 31 chars and rejects most punctuation.
  const tab = input.meta.title.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Collections";
  XLSX.utils.book_append_sheet(wb, buildRollupSheet(input.roots, input.total, input.columns, input.meta), tab);
  if (input.overdueRows.length) {
    XLSX.utils.book_append_sheet(wb, buildOverdueBillsSheet(input.overdueRows, input.meta), "Overdue Bill Details");
  }
  return wb;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The workbook as bytes — so the same file can be downloaded, zipped or emailed without being
 *  built three times. */
export function collectionsWorkbookBlob(input: ZCWorkbookInput): Blob {
  const out = XLSX.write(buildCollectionsWorkbook(input), { bookType: "xlsx", type: "array" });
  return new Blob([out], { type: XLSX_MIME });
}

/** Filename stem shared by the workbook and its PDF sibling, so a pair reads as a pair. */
export function collectionsFileName(meta: ZCExportMeta, ext: string, suffix?: string): string {
  const base = meta.title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const who = suffix ? `_${suffix.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}` : "";
  return `${base}${who}_${formatDateDMY(meta.asOfDate) || "export"}.${ext}`;
}

export function exportCollectionsXlsx(input: ZCWorkbookInput, suffix?: string): string {
  const filename = collectionsFileName(input.meta, "xlsx", suffix);
  saveAs(collectionsWorkbookBlob(input), filename);
  return filename;
}
