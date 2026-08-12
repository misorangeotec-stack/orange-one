/**
 * collectionsExport.ts — assembles the two artefacts (branded PDF, detailed workbook) for the
 * Collection Performance reports, at either "the whole book" or "one salesperson" scope.
 *
 * It sits between the report page (which owns the data and the filters) and the two renderers
 * (which know nothing about receivables). Everything it needs arrives in one context object, so
 * the page does not grow a second copy of the roll-up configuration and the renderers do not
 * grow a dependency on the page.
 *
 * ── THE OVERLAP, STATED ONCE ──────────────────────────────────────────────────────────
 * A customer worked by two salespeople is ONE row on screen, bucketed under the combined label
 * "A, B" (see `zcDimValue`). That is right for a consolidated report: the money is counted once.
 *
 * It is wrong for a per-salesperson file. If A's report only contained rows labelled exactly "A",
 * every shared customer would silently vanish from it — the one customer most likely to need
 * chasing. So the per-rep split is by MEMBERSHIP (`salesPersons.includes(name)`), matching what
 * `exportSalesperson.ts` already does for the Risk Report.
 *
 * The consequence is real and must not be hidden: a set of per-rep files DOUBLE-COUNTS shared
 * customers, so their totals sum to more than the consolidated report. Every per-rep artefact
 * therefore carries `OVERLAP_NOTE`, and the consolidated one keeps the combined buckets so it
 * still reconciles exactly to the screen.
 */

import { buildDrillRows, type ZCColumn, type ZCMetrics, type ZCRow } from "./collections";
import { buildGroupTree, type GroupNode, type GroupTreeOptions } from "./groupTree";
import {
  collectionsFileName, collectionsWorkbookBlob,
  type ZCExportMeta,
} from "./exportCollections";
import {
  buildCollectionsPdf, pdfFileName,
  type PdfKpi, type PdfSalespersonBlock, type PdfCustomerRow, type PdfSaleTypeStat,
} from "./exportCollectionsPdf";
import { formatDateDMY, fmtINRMoney } from "./utils";
import type { CustomerDetail } from "./types";

/** Printed on every per-salesperson artefact. See the header comment. */
export const OVERLAP_NOTE =
  "This is one salesperson's extract. A customer worked by more than one salesperson appears in " +
  "each of their files, so a set of these does not add up to the consolidated report.";

/**
 * The workbook is ALWAYS Salesperson → Customer, whatever the screen is grouped by.
 *
 * The report opens on Salesperson → Customer Group, which never names a customer — and a customer
 * name is the one thing the person receiving the file needs in order to act on it.
 */
const EXPORT_DIMS = ["salesperson", "customer"] as const;

/**
 * Heaviest first, applied at EVERY level of the exported tree.
 *
 * Without it the sheet inherits whatever order the rows happened to arrive in, which is neither
 * the screen's order nor any order a reader can name: a salesperson sitting on ₹56 L lands above
 * one sitting on ₹1.79 Cr, and the customers inside each block are shuffled too. A collections
 * file is worked from the top down, so the top has to be the biggest number.
 *
 * Ties break on outstanding, then on the label, so two exports of the same data are byte-stable
 * rather than dependent on sort implementation.
 */
const byOverdueDesc = (a: GroupNode<ZCMetrics>, b: GroupNode<ZCMetrics>): number =>
  b.metrics.overdue - a.metrics.overdue ||
  b.metrics.outstanding - a.metrics.outstanding ||
  a.label.localeCompare(b.label);

export interface CollectionsExportContext {
  meta: ZCExportMeta;
  /** The columns ticked on screen — the roll-up sheet stays WYSIWYG. */
  columns: ZCColumn[];
  /** The report's own KPI cards, already projected to plain data. */
  kpis: PdfKpi[];
  /** Set when a KPI lens is active — see `kpiScopeNote` on the PDF input. */
  kpiScopeNote?: string;
  filterSummary: string[];
  /** The in-scope (focused) rows the export covers. */
  rows: ZCRow[];
  customerDetail: Record<string, CustomerDetail>;
  /** The page's roll-up configuration, so both trees are built identically. */
  treeOpts: GroupTreeOptions<ZCRow, ZCMetrics>;
}

/** A salesperson offered in the picker, with how many customers they hold in the current scope. */
export interface SalespersonOption {
  name: string;
  customers: number;
}

/**
 * Every INDIVIDUAL salesperson in scope, split out of the combined buckets.
 *
 * "A, B" is one bucket on screen but two people to send a file to, so the picker lists A and B
 * separately and each of their counts includes the shared customer.
 */
export function salespersonOptions(rows: ZCRow[]): SalespersonOption[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const names = r.customer.salesPersons?.length
      ? r.customer.salesPersons
      : [r.customer.salesPerson || "Others"];
    for (const raw of names) {
      const n = raw.trim() || "Others";
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, customers]) => ({ name, customers }))
    .sort((a, b) => b.customers - a.customers || a.name.localeCompare(b.name));
}

/** The rows one salesperson owns — by membership, so shared customers are in both reps' files. */
export function rowsForSalesperson(rows: ZCRow[], name: string): ZCRow[] {
  return rows.filter((r) => {
    const list = r.customer.salesPersons?.length
      ? r.customer.salesPersons
      : [r.customer.salesPerson || "Others"];
    return list.some((n) => (n.trim() || "Others") === name);
  });
}

// ── Formatting shared with the roll-up sheet ────────────────────────────────────────

/** Last-receipt ordinal (yyyymmdd, 0 = none) → dd-mm-yyyy. Matches the workbook's `dateCell`. */
function lastReceiptText(ordinal: number): string {
  if (!ordinal) return "Never";
  const s = String(ordinal);
  return formatDateDMY(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`) || "Never";
}

/**
 * Customer rows for a PDF block, taken from the leaf nodes of a roll-up tree.
 *
 * `n.sub` — the trading company and branch, e.g. "Enterprise / Colorix · Surat" — is deliberately
 * NOT carried through. It is internal structure that means nothing to the person working the call
 * list, and appending it to every name made the widest column twice as wide and pushed real names
 * into an ellipsis. It survives per bill on the workbook's Overdue Bill Details tab.
 */
function customerRowsOf(nodes: GroupNode<ZCMetrics>[]): PdfCustomerRow[] {
  return nodes.map((n) => ({
    name: n.label,
    outstanding: n.metrics.outstanding,
    overdue: n.metrics.overdue,
    lastReceipt: lastReceiptText(n.metrics.lastReceiptAt),
    lastReceiptAmount: n.metrics.lastReceiptAmount ? fmtINRMoney(n.metrics.lastReceiptAmount) : "-",
    neverPaid: n.metrics.neverPaid > 0,
    over180: n.metrics.over180,
  }));
}

/**
 * Overdue split by sale type, over the rows THIS document covers.
 *
 * Deliberately not the screen's `typeOverdue` memo: that one spans the rows from before the
 * sale-type filter, so that clicking a card still widens the report. On paper there is nothing to
 * click, and a strip that does not sum to the Overdue card above it reads as a broken report. The
 * tree is built with the page's own `treeOpts`, whose "saleType" dimension classifies by dominant
 * type, so every row lands in exactly one bucket and the split adds up by construction.
 */
function saleTypeStatsOf(rows: ZCRow[], ctx: CollectionsExportContext): PdfSaleTypeStat[] {
  const tree = buildGroupTree<ZCRow, ZCMetrics>(rows, ["saleType"], exportOpts(ctx));
  return tree.roots.map((n) => ({
    label: n.label,
    customers: n.metrics.customers,
    overdue: n.metrics.overdue,
  }));
}

// ── Builders ────────────────────────────────────────────────────────────────────────

/** Scope of one artefact: the whole book, or one named salesperson. */
export type ExportScope = { kind: "all" } | { kind: "salesperson"; name: string };

/**
 * The page's roll-up configuration, plus the export's own ordering.
 *
 * The screen's `treeOpts` carries no comparator (the table sorts itself afterwards), so a tree
 * built straight from it comes out in arrival order. Every export builds through this instead.
 */
const exportOpts = (ctx: CollectionsExportContext): GroupTreeOptions<ZCRow, ZCMetrics> => ({
  ...ctx.treeOpts,
  sort: byOverdueDesc,
});

const scopedRows = (ctx: CollectionsExportContext, scope: ExportScope): ZCRow[] =>
  scope.kind === "all" ? ctx.rows : rowsForSalesperson(ctx.rows, scope.name);

const scopeSuffix = (scope: ExportScope): string | undefined =>
  scope.kind === "all" ? undefined : scope.name;

/** The workbook for a scope: roll-up at Salesperson → Customer + the bills behind Overdue. */
export function buildXlsx(ctx: CollectionsExportContext, scope: ExportScope): { blob: Blob; filename: string } {
  const rows = scopedRows(ctx, scope);
  const tree = buildGroupTree<ZCRow, ZCMetrics>(rows, [...EXPORT_DIMS], exportOpts(ctx));

  const rowsById = new Map(rows.map((r) => [r.customer.id, r]));
  const { rows: overdueRows } = buildDrillRows(tree.totalIds, rowsById, ctx.customerDetail, "overdue");

  const meta: ZCExportMeta = {
    ...ctx.meta,
    dims: [
      { key: "salesperson", label: "Salesperson" },
      { key: "customer", label: "Customer" },
    ],
    description:
      scope.kind === "all"
        ? ctx.meta.description
        : `${ctx.meta.description} Salesperson: ${scope.name}. ${OVERLAP_NOTE}`,
  };

  return {
    blob: collectionsWorkbookBlob({ roots: tree.roots, total: tree.total, columns: ctx.columns, meta, overdueRows }),
    filename: collectionsFileName(ctx.meta, "xlsx", scopeSuffix(scope)),
  };
}

/** The branded PDF for a scope. */
export async function buildPdf(
  ctx: CollectionsExportContext,
  scope: ExportScope,
): Promise<{ blob: Blob; filename: string }> {
  const rows = scopedRows(ctx, scope);

  /** The book-level figures the read-out draws on, beyond the three headline totals. */
  const totalsOf = (m: ZCMetrics) => ({
    customers: m.customers,
    outstanding: m.outstanding,
    overdue: m.overdue,
    over180: m.over180,
    neverPaid: m.neverPaid,
    stillBuying: m.stillBuying,
  });

  let blocks: PdfSalespersonBlock[];
  let total: ReturnType<typeof totalsOf>;

  if (scope.kind === "all") {
    const tree = buildGroupTree<ZCRow, ZCMetrics>(rows, [...EXPORT_DIMS], exportOpts(ctx));
    blocks = tree.roots.map((root) => ({
      name: root.label,
      customers: root.metrics.customers,
      outstanding: root.metrics.outstanding,
      overdue: root.metrics.overdue,
      maxOverdueDays: root.metrics.maxOverdueDays,
      neverPaid: root.metrics.neverPaid,
      rows: customerRowsOf(root.children),
    }));
    total = totalsOf(tree.total);
  } else {
    // One rep: group by customer only, so the single block is titled with the REP's own name
    // rather than the combined "A, B" bucket a shared customer would otherwise impose on it.
    const tree = buildGroupTree<ZCRow, ZCMetrics>(rows, ["customer"], exportOpts(ctx));
    total = totalsOf(tree.total);
    blocks = [{
      name: scope.name,
      customers: total.customers,
      outstanding: total.outstanding,
      overdue: total.overdue,
      maxOverdueDays: tree.total.maxOverdueDays,
      neverPaid: tree.total.neverPaid,
      rows: customerRowsOf(tree.roots),
    }];
  }

  const blob = await buildCollectionsPdf({
    title: ctx.meta.title,
    subtitle:
      scope.kind === "all"
        ? ctx.meta.description
        : `${ctx.meta.description} Salesperson: ${scope.name}.`,
    asOfDate: ctx.meta.asOfDate,
    periodLabel: ctx.meta.periodLabel,
    filterSummary: ctx.filterSummary,
    kpis: ctx.kpis,
    saleTypes: saleTypeStatsOf(rows, ctx),
    kpiScopeNote: ctx.kpiScopeNote,
    // The cards may only link to the appendix lists when they describe the same customers: the
    // whole book, with no KPI lens narrowing the tables underneath them. See `cardsMatchRows`.
    cardsMatchRows: scope.kind === "all" && !ctx.kpiScopeNote,
    salespersons: blocks,
    total,
    overlapNote: scope.kind === "all" ? undefined : OVERLAP_NOTE,
  });

  return { blob, filename: pdfFileName(ctx.meta.title, ctx.meta.asOfDate, scopeSuffix(scope)) };
}

/** Both artefacts for one scope. */
export async function buildBoth(
  ctx: CollectionsExportContext,
  scope: ExportScope,
): Promise<{ blob: Blob; filename: string }[]> {
  const pdf = await buildPdf(ctx, scope);
  const xlsx = buildXlsx(ctx, scope);
  return [pdf, xlsx];
}
