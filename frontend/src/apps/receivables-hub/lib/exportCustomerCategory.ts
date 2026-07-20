/**
 * exportCustomerCategory.ts — the Excel export for the Customer Category Report.
 *
 * Same three rules as exportCollections.ts / exportOverdueAging.ts:
 *
 *  1. WYSIWYG — the workbook carries exactly what was on screen (period, scope, view, filters,
 *     visible columns), because an export that quietly differs from the thing that was reviewed
 *     is worse than no export at all. The ONE deliberate exception is the Matrix sheet, which is
 *     written UNFOLDED (all columns) while the screen folds the tail into "Other" — Excel can
 *     take 60 columns and a screen cannot. The meta band says so.
 *  2. Money is written as NUMBERS with an INR display format, never pre-formatted strings
 *     ("₹1.20 L" looks right and is useless — Excel can't SUM it). Same for percentages.
 *  3. A percentage is NEVER summed — % cells come from each column's own value(), the same
 *     function the screen calls.
 *
 * Five sheets. The third is the point of the whole export: "Tag Mismatches" is the worklist
 * Sales/Finance actually re-tag from — every customer whose payment behaviour contradicts the
 * grade someone typed into the Credit-Limit sheet, ranked by the money at stake, with the reason
 * spelled out in English and a suggested tier.
 */

import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { formatDateDMY } from "./utils";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "./xlsxStyle";
import { utilizationPct } from "./receivables";
import { NEVER_PAID } from "./collections";
import {
  mismatchOf, mismatchReasonOf, isActive, isDormantLedger, TIER_LABELS, MATRIX_MEASURES,
  type CCColumn, type CCMetrics, type CCRow, type CategoryMatrix,
} from "./customerCategory";
import type { GroupNode } from "./groupTree";

const INR_FMT = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';
/** A literal "%" suffix — the cell holds 12.3, not 0.123. (Excel's native 0.0% would show 1230%.) */
const PCT_FMT = '0.0"%";-0.0"%";"—"';

export interface CCExportMeta {
  title: string;
  /** e.g. "Category → Customer". */
  viewLabel: string;
  /** e.g. "Both FYs · balances as on 13-07-2026 · flows in This FY (Apr-26 → Jul-26)". */
  scopeLabel: string;
  /** e.g. "This FY (Apr-26 → Jul-26)". */
  periodLabel: string;
  /** The dual-basis sentence, verbatim from the screen. */
  basis: string;
  /** The Dashboard reconciliation note (Net ties; bill-wise Overdue reads above it). */
  reconciliation: string;
  /** How the behaviour grade + mismatch were derived, in words. */
  gradeBasis: string;
  mismatchGap: number;
  asOfDate: string;
  filterSummary: string[];
  /** Excluded, and why — e.g. dormant accounts. */
  exclusions: string[];
}

const daysCell = (v: number): string | number => (v === NEVER_PAID ? "Never" : v < 0 ? "—" : v);
const pctCell = (v: number | null): string | number => (v === null ? "—" : Math.round(v * 10) / 10);

const cellFor = (col: CCColumn, m: CCMetrics, total: CCMetrics): string | number => {
  const v = col.value(m, total);
  if (v === null) return "—";
  if (col.kind === "pct") return pctCell(v);
  if (col.kind === "days") return daysCell(v);
  return Math.round(v);
};

function flatten(
  nodes: GroupNode<CCMetrics>[],
): { label: string; depth: number; metrics: CCMetrics; isLeaf: boolean }[] {
  const out: { label: string; depth: number; metrics: CCMetrics; isLeaf: boolean }[] = [];
  const walk = (list: GroupNode<CCMetrics>[]) => {
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
  ws: XLSX.WorkSheet, firstRow0: number, rowCount: number, cols0: number[], fmt: string,
): void {
  for (let i = 0; i < rowCount; i++) {
    for (const col of cols0) {
      const addr = XLSX.utils.encode_cell({ r: firstRow0 + i, c: col });
      const cell = (ws as Record<string, unknown>)[addr] as { v?: unknown; z?: string } | undefined;
      if (cell && typeof cell.v === "number") cell.z = fmt;
    }
  }
}

/* ── Sheet 1 — the roll-up, exactly as displayed ─────────────────────────────────────── */

function buildScoreboardSheet(
  roots: GroupNode<CCMetrics>[], total: CCMetrics, columns: CCColumn[], meta: CCExportMeta,
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [];

  aoa.push([meta.title]);
  aoa.push(["Scope", meta.scopeLabel]);
  aoa.push(["Period (flows)", meta.periodLabel]);
  aoa.push(["As on (balances)", formatDateDMY(meta.asOfDate)]);
  aoa.push(["View", meta.viewLabel]);
  aoa.push(["Basis", meta.basis]);
  aoa.push(["Reconciliation", meta.reconciliation]);
  aoa.push(["Behaviour grade", meta.gradeBasis]);
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
      ...columns.map((c) => cellFor(c, r.metrics, total)),
    ]);
  }

  const grandRow0 = aoa.length;
  aoa.push(["GRAND TOTAL", ...columns.map((c) => cellFor(c, total, total))]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = [{ wch: 42 }, ...columns.map(() => ({ wch: 16 }))];

  const pick = (k: CCColumn["kind"]) =>
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

/* ── Sheet 2 — flat, every attribute regardless of the ColumnPicker ──────────────────── */

const CUSTOMER_HEADER = [
  "Customer", "Group", "Company", "Location", "Salesperson",
  "Tagged Tier", "All Tags", "Behaviour Grade", "Risk Score", "Mismatch", "Suggested Tier", "Why",
  "Revenue Class", "Revenue Rank", "Revenue Decile", "Sales Share %", "Cumulative Share %",
  "Owed", "Advances", "Net Outstanding",
  "Opening", "Sales in Period", "Collectible", "Collected", "Collection %",
  "Cheque Returns", "Credit Notes",
  "Overdue", "% Overdue", "0-30", "31-60", "61-90", "91-120", "121-180", "180+", "% at 180+",
  "Open Bills", "Max Overdue Days", "Days Since Receipt", "Last Receipt Date",
  "Credit Limit", "Utilisation %", "Risk", "Red Mark", "Sale Type", "Activity",
];
const CUST_MONEY = [17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 29, 30, 31, 32, 33, 34, 40];
const CUST_PCT = [15, 16, 24, 28, 35, 41];

function buildCustomerSheet(rows: CCRow[], meta: CCExportMeta): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [];
  aoa.push([`${meta.title} — ${meta.scopeLabel}`]);
  aoa.push([]);
  const headerRow0 = aoa.length;
  aoa.push(CUSTOMER_HEADER);

  const firstData0 = aoa.length;
  for (const r of rows) {
    const c = r.customer;
    const f = r.facts;
    const mm = mismatchOf(r, meta.mismatchGap);
    const o = Math.max(1, r.owed);
    aoa.push([
      c.name,
      r.group,
      c.companies?.join(" / ") || c.company,
      c.locations?.join(" / ") || c.location,
      c.salesPersons?.length ? c.salesPersons.join(", ") : c.salesPerson || "Others",
      TIER_LABELS[r.tier],
      r.tags.length ? r.tags.join(", ") : "—",
      r.grade ?? "—",
      r.payScore === null ? "—" : Math.round(r.payScore * 10) / 10,
      mm === null ? "—" : mm === "ok" ? "In line" : mm === "over_graded" ? "Over-graded" : "Under-graded",
      // The suggested tier IS the behaviour grade — that is the whole proposal.
      mm === "over_graded" || mm === "under_graded" ? (r.grade ?? "—") : "—",
      mm === "over_graded" || mm === "under_graded" ? mismatchReasonOf(r) : "",
      r.pareto.cls === "N" ? "No sales" : r.pareto.cls,
      r.pareto.rank || "—",
      r.pareto.decile || "—",
      r.pareto.cls === "N" ? "—" : Math.round(r.pareto.sharePct * 100) / 100,
      r.pareto.cls === "N" ? "—" : Math.round(r.pareto.cumPct * 10) / 10,
      Math.round(r.owed),
      Math.round(r.advances),
      Math.round(r.net),
      Math.round(f.opening),
      Math.round(f.salesInWindow),
      Math.round(f.collectible),
      Math.round(f.collected),
      f.pct === null ? "—" : Math.round(f.pct * 10) / 10,
      Math.round(f.chequeReturns),
      Math.round(f.creditNotes),
      Math.round(r.buckets.overdue),
      r.owed > 0.5 ? Math.round((r.buckets.overdue / o) * 1000) / 10 : "—",
      Math.round(r.buckets.od_0_30),
      Math.round(r.buckets.od_31_60),
      Math.round(r.buckets.od_61_90),
      Math.round(r.buckets.od_91_120),
      Math.round(r.buckets.od_121_180),
      Math.round(r.buckets.od_180_plus),
      r.owed > 0.5 ? Math.round((r.buckets.od_180_plus / o) * 1000) / 10 : "—",
      r.buckets.billCount,
      r.maxOverdueDays,
      f.lastReceiptDate === null ? "Never" : (f.daysSinceLastReceipt ?? 0),
      f.lastReceiptDate ? formatDateDMY(f.lastReceiptDate) : "Never",
      Math.round(r.creditLimit),
      utilizationPct({ outstanding: r.net, creditLimit: r.creditLimit }),
      c.risk,
      c.blocked ? "Yes" : "No",
      r.saleType,
      isDormantLedger(r) ? "Dormant ledger" : isActive(r) ? "Active" : "No activity in period",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = CUSTOMER_HEADER.length;
  ws["!cols"] = CUSTOMER_HEADER.map((h, i) =>
    i === 0 ? { wch: 38 } : i === 1 ? { wch: 28 } : i === 11 ? { wch: 60 } : { wch: Math.max(11, h.length + 2) },
  );

  formatCells(ws, firstData0, rows.length, CUST_MONEY, INR_FMT);
  formatCells(ws, firstData0, rows.length, CUST_PCT, PCT_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ r: headerRow0, c: 0 }, { r: headerRow0 + rows.length, c: ncols - 1 }),
  };
  ws["!freeze"] = { xSplit: 1, ySplit: headerRow0 + 1 };
  return ws;
}

/* ── Sheet 3 — THE POINT: the re-tagging worklist ────────────────────────────────────── */

function buildMismatchSheet(rows: CCRow[], meta: CCExportMeta): XLSX.WorkSheet {
  const header = [
    "Customer", "Group", "Salesperson", "Company",
    "Tagged Tier", "Behaves Like", "SUGGESTED TIER", "Direction", "Why",
    "Owed", "Overdue", "180+", "% at 180+", "Max Overdue Days",
    "Sales in Period", "Collected", "Collection %", "Revenue Class", "Risk Score",
  ];
  const MONEY = [9, 10, 11, 14, 15];
  const PCT = [12, 16];

  const flagged = rows
    .map((r) => ({ r, mm: mismatchOf(r, meta.mismatchGap) }))
    .filter((x) => x.mm === "over_graded" || x.mm === "under_graded")
    // Ranked by the MONEY AT STAKE — the top of this list is the actual worklist.
    .sort((a, b) => b.r.owed - a.r.owed);

  const aoa: Array<Array<string | number>> = [];
  aoa.push([`Tag mismatches — tagged tier vs how the customer actually pays (gap ≥ ${meta.mismatchGap} grades)`]);
  aoa.push(["Basis", meta.gradeBasis]);
  aoa.push(["Scope", meta.scopeLabel]);
  aoa.push([]);
  const headerRow0 = aoa.length;
  aoa.push(header);

  const firstData0 = aoa.length;
  for (const { r, mm } of flagged) {
    const f = r.facts;
    const o = Math.max(1, r.owed);
    aoa.push([
      r.customer.name,
      r.group,
      r.customer.salesPersons?.length ? r.customer.salesPersons.join(", ") : r.customer.salesPerson || "Others",
      r.customer.companies?.join(" / ") || r.customer.company,
      TIER_LABELS[r.tier],
      r.grade ?? "—",
      r.grade ?? "—",
      mm === "over_graded" ? "Tagged too HIGH" : "Tagged too LOW",
      mismatchReasonOf(r),
      Math.round(r.owed),
      Math.round(r.buckets.overdue),
      Math.round(r.buckets.od_180_plus),
      r.owed > 0.5 ? Math.round((r.buckets.od_180_plus / o) * 1000) / 10 : "—",
      r.maxOverdueDays,
      Math.round(f.salesInWindow),
      Math.round(f.collected),
      f.pct === null ? "—" : Math.round(f.pct * 10) / 10,
      r.pareto.cls === "N" ? "No sales" : r.pareto.cls,
      r.payScore === null ? "—" : Math.round(r.payScore * 10) / 10,
    ]);
  }

  const totalRow0 = aoa.length;
  aoa.push([
    "TOTAL", "", "", "", "", "", "", `${flagged.length} customers`, "",
    Math.round(flagged.reduce((s, x) => s + x.r.owed, 0)),
    Math.round(flagged.reduce((s, x) => s + x.r.buckets.overdue, 0)),
    Math.round(flagged.reduce((s, x) => s + x.r.buckets.od_180_plus, 0)),
    "", "", "", "", "", "", "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = header.map((h, i) =>
    i === 0 ? { wch: 38 } : i === 1 ? { wch: 26 } : i === 8 ? { wch: 68 } : { wch: Math.max(12, h.length + 2) },
  );

  formatCells(ws, firstData0, flagged.length + 1, MONEY, INR_FMT);
  formatCells(ws, firstData0, flagged.length, PCT, PCT_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  styleRow(ws, totalRow0, ncols, GRAND_TOTAL_STYLE);
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ r: headerRow0, c: 0 }, { r: headerRow0 + flagged.length, c: ncols - 1 }),
  };
  ws["!freeze"] = { xSplit: 1, ySplit: headerRow0 + 1 };
  return ws;
}

/* ── Sheet 4 — the cross-tab, UNFOLDED ───────────────────────────────────────────────── */

function buildMatrixSheet(matrix: CategoryMatrix, meta: CCExportMeta): XLSX.WorkSheet {
  const measure = MATRIX_MEASURES.find((m) => m.key === matrix.measure);
  const isMoney = measure?.kind === "money";

  const aoa: Array<Array<string | number>> = [];
  aoa.push([`Customer Category × ${matrix.dim} — ${measure?.label ?? matrix.measure}`]);
  aoa.push(["Scope", meta.scopeLabel]);
  aoa.push(["Note", "All columns are shown here. The on-screen matrix folds low-volume columns into \"Other\" to fit."]);
  aoa.push([]);
  const headerRow0 = aoa.length;
  aoa.push(["Category", ...matrix.cols, "TOTAL"]);

  const firstData0 = aoa.length;
  for (const r of matrix.rows) {
    aoa.push([r.label, ...r.cells.map((v) => Math.round(v)), Math.round(r.total)]);
  }
  const totalRow0 = aoa.length;
  aoa.push(["TOTAL", ...matrix.colTotals.map((v) => Math.round(v)), Math.round(matrix.grand)]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = matrix.cols.length + 2;
  ws["!cols"] = [{ wch: 18 }, ...matrix.cols.map(() => ({ wch: 16 })), { wch: 16 }];

  if (isMoney) {
    const cols0 = Array.from({ length: matrix.cols.length + 1 }, (_, i) => i + 1);
    formatCells(ws, firstData0, matrix.rows.length + 1, cols0, INR_FMT);
  }

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  styleRow(ws, totalRow0, ncols, GRAND_TOTAL_STYLE);
  ws["!freeze"] = { xSplit: 1, ySplit: headerRow0 + 1 };
  return ws;
}

/* ── Sheet 5 — the evidence behind the Revenue Class column ──────────────────────────── */

function buildParetoSheet(rows: CCRow[], meta: CCExportMeta): XLSX.WorkSheet {
  const header = [
    "Rank", "Customer", "Salesperson", "Sales in Period", "Share %", "Cumulative %",
    "Revenue Class", "Decile", "Tagged Tier", "Behaviour Grade", "Owed",
  ];
  const MONEY = [3, 10];
  const PCT = [4, 5];

  const ranked = rows
    .filter((r) => r.pareto.cls !== "N")
    .sort((a, b) => a.pareto.rank - b.pareto.rank);

  const aoa: Array<Array<string | number>> = [];
  aoa.push([`Revenue Pareto (ABC) — ${meta.periodLabel}`]);
  aoa.push(["Basis", "Customers ranked by sales in the period. The customer that CROSSES 80% cumulative share is inside class A; same at 95% for B. Customers with no sales are class N and are not listed here."]);
  aoa.push([]);
  const headerRow0 = aoa.length;
  aoa.push(header);

  const firstData0 = aoa.length;
  for (const r of ranked) {
    aoa.push([
      r.pareto.rank,
      r.customer.name,
      r.customer.salesPersons?.length ? r.customer.salesPersons.join(", ") : r.customer.salesPerson || "Others",
      Math.round(r.facts.salesInWindow),
      Math.round(r.pareto.sharePct * 100) / 100,
      Math.round(r.pareto.cumPct * 10) / 10,
      r.pareto.cls,
      r.pareto.decile,
      TIER_LABELS[r.tier],
      r.grade ?? "—",
      Math.round(r.owed),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ncols = header.length;
  ws["!cols"] = [{ wch: 8 }, { wch: 38 }, { wch: 18 }, { wch: 17 }, { wch: 10 }, { wch: 14 },
    { wch: 14 }, { wch: 9 }, { wch: 13 }, { wch: 16 }, { wch: 14 }];

  formatCells(ws, firstData0, ranked.length, MONEY, INR_FMT);
  formatCells(ws, firstData0, ranked.length, PCT, PCT_FMT);

  styleRow(ws, 0, ncols, HEADER_STYLE);
  styleRow(ws, headerRow0, ncols, HEADER_STYLE);
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({ r: headerRow0, c: 0 }, { r: headerRow0 + ranked.length, c: ncols - 1 }),
  };
  ws["!freeze"] = { xSplit: 2, ySplit: headerRow0 + 1 };
  return ws;
}

/* ── The workbook ────────────────────────────────────────────────────────────────────── */

export function exportCustomerCategoryXlsx(
  roots: GroupNode<CCMetrics>[],
  total: CCMetrics,
  leafRows: CCRow[],
  matrix: CategoryMatrix,
  columns: CCColumn[],
  meta: CCExportMeta,
): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildScoreboardSheet(roots, total, columns, meta), "Category Scoreboard");
  XLSX.utils.book_append_sheet(wb, buildCustomerSheet(leafRows, meta), "Customers");
  XLSX.utils.book_append_sheet(wb, buildMismatchSheet(leafRows, meta), "Tag Mismatches");
  XLSX.utils.book_append_sheet(wb, buildMatrixSheet(matrix, meta), "Matrix");
  XLSX.utils.book_append_sheet(wb, buildParetoSheet(leafRows, meta), "Revenue Pareto");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const stamp = formatDateDMY(meta.asOfDate) || "export";
  const file = meta.title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  saveAs(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${file}_${stamp}.xlsx`,
  );
}
