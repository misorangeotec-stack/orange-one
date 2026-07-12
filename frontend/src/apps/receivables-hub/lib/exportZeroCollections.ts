/**
 * exportZeroCollections.ts — the Excel export for the Zero Collections report.
 *
 * Two rules drive everything here:
 *
 *  1. WYSIWYG. The workbook carries exactly what was on screen — same period, filters,
 *     view preset, sort and visible columns. An export that quietly differs from the
 *     thing that was reviewed is worse than no export at all. Hence the Filters band:
 *     without it, a sheet mailed on Monday is unauditable by Friday.
 *
 *  2. Money is written as NUMBERS with an INR display format, never as pre-formatted
 *     strings ("₹1.20 L"). Strings look right and are useless — Excel can't SUM them.
 *     Sheet 2 additionally gets an autofilter so finance can slice it without coming
 *     back to the app, which is what they'll actually do.
 */

import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { formatDateDMY } from "./utils";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "./xlsxStyle";
import { utilizationPct } from "./receivables";
import { NEVER_PAID, type ZCColumn, type ZCMetrics, type ZCRow } from "./zeroCollections";
import type { GroupNode } from "./groupTree";

/** INR cell number format (whole rupees, "₹" prefixed, dash for zero). */
const INR_FMT = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';

export interface ZCExportMeta {
  /** The View preset name, e.g. "Salesperson → Customer". */
  viewLabel: string;
  /** Human-readable period, e.g. "Last 3 Months (01-05-2026 → 12-07-2026)". */
  periodLabel: string;
  asOfDate: string;
  /** Active-filter lines, e.g. ["Salesperson: Rakesh, Vinay", "Min Outstanding: ≥ ₹1 L"]. */
  filterSummary: string[];
}

/** Days-since-receipt renders as a number, except the never-paid sentinel. */
const daysCell = (v: number): string | number =>
  v === NEVER_PAID ? "Never" : v < 0 ? "—" : v;

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

/** Apply the INR format to a span of columns on a span of rows (both 0-indexed, inclusive). */
function formatMoney(
  ws: XLSX.WorkSheet,
  firstRow0: number,
  rowCount: number,
  moneyCols0: number[],
): void {
  for (let i = 0; i < rowCount; i++) {
    for (const col of moneyCols0) {
      const addr = XLSX.utils.encode_cell({ r: firstRow0 + i, c: col });
      const cell = (ws as Record<string, unknown>)[addr] as { v?: unknown; z?: string } | undefined;
      if (cell && typeof cell.v === "number") cell.z = INR_FMT;
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

  aoa.push(["Customers with Zero Collections"]);
  aoa.push(["Period", meta.periodLabel]);
  aoa.push(["As on", formatDateDMY(meta.asOfDate)]);
  aoa.push(["View", meta.viewLabel]);
  aoa.push([
    "Basis",
    "No receipt voucher and no Other Payment in the period. Cheque returns are reported, not netted.",
  ]);
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
      ...columns.map((c) =>
        c.kind === "days"
          ? daysCell(r.metrics[c.key])
          : Math.round(r.metrics[c.key]),
      ),
    ]);
  }

  const grandRow0 = aoa.length;
  aoa.push([
    "GRAND TOTAL",
    ...columns.map((c) =>
      c.kind === "days" ? daysCell(total[c.key]) : Math.round(total[c.key]),
    ),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = [{ wch: 40 }, ...columns.map(() => ({ wch: 16 }))];

  const moneyCols0 = columns
    .map((c, i) => (c.kind === "money" ? i + 1 : -1))
    .filter((i) => i >= 0);
  formatMoney(ws, firstData0, rows.length + 1, moneyCols0); // +1 → include the grand total

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
 * Sheet 2 — flat, one row per zero-collection customer, every column. This is the sheet
 * finance pivots and filters in, so it gets the autofilter and the full attribute set
 * (including the leaf-only columns the roll-up can't show on a group row).
 */
function buildCustomerSheet(rows: ZCRow[], meta: ZCExportMeta): XLSX.WorkSheet {
  const header = [
    "Customer", "Group", "Company", "Location", "Salesperson", "Category",
    "Outstanding", "Overdue", "> 180 Days",
    "Sales in Window", "Prior Collections", "Cheque Returns",
    "Max Overdue Days", "Days Since Receipt", "Last Receipt Date",
    "Credit Limit", "Utilization %", "Risk", "Blocked",
  ];

  const aoa: Array<Array<string | number>> = [];
  aoa.push([`Customers with Zero Collections — ${meta.periodLabel}`]);
  aoa.push([]);
  const headerRow0 = aoa.length;
  aoa.push(header);

  const firstData0 = aoa.length;
  for (const r of rows) {
    const c = r.customer;
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
      Math.round(r.facts.salesInWindow),
      Math.round(r.facts.inPrior),
      Math.round(r.facts.chequeReturns),
      c.maxOverdueDays ?? 0,
      r.facts.lastReceiptDate === null ? "Never" : (r.facts.daysSinceLastReceipt ?? 0),
      r.facts.lastReceiptDate ? formatDateDMY(r.facts.lastReceiptDate) : "Never",
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
    { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 16 }, { wch: 17 }, { wch: 15 },
    { wch: 16 }, { wch: 17 }, { wch: 16 }, { wch: 15 }, { wch: 13 }, { wch: 10 }, { wch: 9 },
  ];

  // Money columns: Outstanding … Cheque Returns (6..11), Credit Limit (15).
  formatMoney(ws, firstData0, rows.length, [6, 7, 8, 9, 10, 11, 15]);

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

export function exportZeroCollectionsXlsx(
  roots: GroupNode<ZCMetrics>[],
  total: ZCMetrics,
  leafRows: ZCRow[],
  columns: ZCColumn[],
  meta: ZCExportMeta,
): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildRollupSheet(roots, total, columns, meta), "Zero Collections");
  XLSX.utils.book_append_sheet(wb, buildCustomerSheet(leafRows, meta), "Customers");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const stamp = formatDateDMY(meta.asOfDate) || "export";
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Zero_Collections_${stamp}.xlsx`,
  );
}
