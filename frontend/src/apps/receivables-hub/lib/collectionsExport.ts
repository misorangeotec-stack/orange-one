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
  type PdfBillRow,
} from "./exportCollectionsPdf";
import { saleTypeLabel } from "./salesReport";
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
  /** The report's own KPI cards for the whole report, already projected to plain data. */
  kpis: PdfKpi[];
  /**
   * The same cards recomputed for one salesperson's rows.
   *
   * Supplied by the page, because the card set, their wording and their denominators are defined
   * there and must not be reimplemented here — a second copy would drift the moment a card is
   * reworded. Passing the name (not just the rows) lets the page scope the eligible POOL too, so
   * "of N who owe money" counts that rep's debtors rather than the company's.
   */
  kpisFor: (rows: ZCRow[], salesperson: string) => PdfKpi[];
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
/**
 * The INDIVIDUAL salesperson names on a customer, with the "Others" fallback used everywhere.
 *
 * One definition, because three different places need to agree on what "this rep's customers"
 * means: the picker, the row split, and the eligible pool behind the scoped KPI cards. If they
 * disagreed, a rep's card denominator would be drawn from a different set than their table.
 */
export function salespersonNamesOf(
  c: { salesPersons?: string[] | null; salesPerson?: string | null },
): string[] {
  const list = c.salesPersons?.length ? c.salesPersons : [c.salesPerson || "Others"];
  return list.map((n) => n.trim() || "Others");
}

export function salespersonOptions(rows: ZCRow[]): SalespersonOption[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const n of salespersonNamesOf(r.customer)) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, customers]) => ({ name, customers }))
    .sort((a, b) => b.customers - a.customers || a.name.localeCompare(b.name));
}

/** The rows one salesperson owns — by membership, so shared customers are in both reps' files. */
export function rowsForSalesperson(rows: ZCRow[], name: string): ZCRow[] {
  return rows.filter((r) => salespersonNamesOf(r.customer).includes(name));
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
function customerRowsOf(
  nodes: GroupNode<ZCMetrics>[],
  bills: (node: GroupNode<ZCMetrics>) => PdfBillRow[],
): PdfCustomerRow[] {
  return nodes.map((n) => ({
    name: n.label,
    outstanding: n.metrics.outstanding,
    overdue: n.metrics.overdue,
    lastReceipt: lastReceiptText(n.metrics.lastReceiptAt),
    lastReceiptAmount: n.metrics.lastReceiptAmount ? fmtINRMoney(n.metrics.lastReceiptAmount) : "-",
    neverPaid: n.metrics.neverPaid > 0,
    over180: n.metrics.over180,
    bills: bills(n),
  }));
}

/**
 * The open past-due bills behind one customer's Overdue figure.
 *
 * Built with the SAME `buildDrillRows` the on-screen popup and the workbook's bill tab use, which
 * is what keeps three renderings of the same money in agreement. That includes the negative On
 * Account line: the bills are gross, the report's Overdue is net, and without that line a
 * customer's page sums to more than the figure that sent the reader to it.
 */
function billsFor(
  node: GroupNode<ZCMetrics>,
  rowsById: ReadonlyMap<string, ZCRow>,
  ctx: CollectionsExportContext,
): PdfBillRow[] {
  const { rows } = buildDrillRows(node.ids, rowsById, ctx.customerDetail, "overdue");
  return rows.map((r) => ({
    // Just "On Account", not the workbook's fuller "On Account (paid, tagged to no bill)": that
    // label is 36 characters and would be ellipsized into meaninglessness in a Bill No column
    // sized for bill numbers. The PDF explains it in a line under the table instead.
    number: r.isOnAccount ? "On Account" : r.number,
    date: r.date ? (formatDateDMY(r.date) || "") : "",
    // The raw ISO date alongside the printed one, purely so the renderer can order the page by
    // bill date. `formatDateDMY` is one-way for sorting purposes: it falls back to echoing an
    // unrecognised input verbatim, so a renderer parsing dd-mm-yyyy back out would be guessing.
    sortDate: r.date || "",
    dueDate: r.dueDate ? (formatDateDMY(r.dueDate) || "") : "",
    overdueDays: r.isOnAccount ? null : r.overdueDays,
    saleType: r.isOnAccount ? "" : saleTypeLabel(r.voucherType),
    amount: r.amount,
    received: r.received,
    pending: r.pending,
    isOnAccount: !!r.isOnAccount,
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

/**
 * A salesperson's artefact contains that salesperson's customers and NOBODY ELSE'S. Throws if not.
 *
 * ── WHY AN ASSERTION AND NOT JUST A FILTER ──────────────────────────────────────────
 * The filter is already correct: `rowsForSalesperson` selects by membership, and neither artefact
 * ever builds the whole book and trims it. So on today's code this can never fire, which is the
 * point — it is a TRIPWIRE over a property that must not be allowed to stop being true quietly.
 * The rows reach here through `ctx.rows` (which the page composes from period, threshold, filters
 * and KPI lenses), the membership test, and two tree builds. Any of those changing could let one
 * rep's customer into another rep's file, and that mistake is invisible on inspection: the file
 * still looks like a report, and the first person to notice is the recipient, holding a competitor
 * colleague's book. A build that dies with a named customer is enormously cheaper.
 *
 * ── IT THROWS RATHER THAN FILTERING THE STRAY ROW OUT ───────────────────────────────
 * Silently dropping it would "fix" the leak and hide the bug, and the figures on the page would
 * then disagree with the KPI cards for reasons nobody could see. Refusing to produce the file is
 * the honest failure: nothing is sent, and the message names the customer and who does own them.
 */
function assertOnlyTheirs(rows: ZCRow[], name: string): void {
  const stray = rows.find((r) => !salespersonNamesOf(r.customer).includes(name));
  if (!stray) return;
  const owners = salespersonNamesOf(stray.customer).join(", ") || "nobody";
  throw new Error(
    `Refusing to build the report for ${name}: it contains ${stray.customer.name}, ` +
    `who is worked by ${owners}. Nothing has been written or sent. This is a bug in the export, ` +
    `not a setting you can change.`,
  );
}

const scopedRows = (ctx: CollectionsExportContext, scope: ExportScope): ZCRow[] => {
  if (scope.kind === "all") return ctx.rows;
  const rows = rowsForSalesperson(ctx.rows, scope.name);
  assertOnlyTheirs(rows, scope.name);
  return rows;
};

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
        // The overlap caveat is NOT printed on the artefact. It answers a question nobody reading
        // one rep's file is asking ("why don't these add up to the consolidated report?"), and on
        // the page it just reads as a warning about the file you are holding. It is said where it
        // is actionable instead: in the picker, before the files are generated.
        : `${ctx.meta.description} Salesperson: ${scope.name}.`,
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

  const rowsById = new Map(rows.map((r) => [r.customer.id, r]));
  const bills = (node: GroupNode<ZCMetrics>) => billsFor(node, rowsById, ctx);

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
      rows: customerRowsOf(root.children, bills),
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
      rows: customerRowsOf(tree.roots, bills),
    }];

    // The second tripwire, over the ASSEMBLED DOCUMENT rather than its input.
    //
    // `assertOnlyTheirs` checked the rows going in; this checks the customers actually coming out,
    // so a roll-up that reached past its own row set (a tree built from the wrong ids, a leaf
    // pulling from ctx.customerDetail) is caught too. The two are deliberately independent: one
    // guards the filter, the other guards everything between the filter and the page.
    const allowed = new Set(rows.map((r) => r.customer.name));
    const printed = blocks[0].rows.find((r) => !allowed.has(r.name));
    if (printed) {
      throw new Error(
        `Refusing to build the report for ${scope.name}: the customer table lists ${printed.name}, ` +
        `who is not in their book. Nothing has been written or sent.`,
      );
    }
    if (blocks.length !== 1 || blocks[0].name !== scope.name) {
      throw new Error(
        `Refusing to build the report for ${scope.name}: it came out covering ` +
        `${blocks.length} salespeople. Nothing has been written or sent.`,
      );
    }
  }

  const blob = await buildCollectionsPdf({
    layout: scope.kind === "all" ? "book" : "salesperson",
    title: ctx.meta.title,
    subtitle: ctx.meta.description,
    // On a rep extract the header line names them; the league table that used to do it is gone,
    // because a "By salesperson" table with one row is scaffolding, not information.
    scopeName: scope.kind === "all" ? undefined : scope.name,
    asOfDate: ctx.meta.asOfDate,
    periodLabel: ctx.meta.periodLabel,
    filterSummary: ctx.filterSummary,
    // Scoped cards for a scoped document. See `kpisFor`.
    kpis: scope.kind === "all" ? ctx.kpis : ctx.kpisFor(rows, scope.name),
    saleTypes: saleTypeStatsOf(rows, ctx),
    kpiScopeNote: ctx.kpiScopeNote,
    // The cards may link to the appendix lists whenever they describe the same customers this
    // document lists. That now holds for a rep extract too, since their cards are rebuilt from
    // their own rows; a KPI lens is still the one case where the two populations differ.
    cardsMatchRows: !ctx.kpiScopeNote,
    salespersons: blocks,
    total,
  });

  return { blob, filename: pdfFileName(ctx.meta.title, ctx.meta.asOfDate, scopeSuffix(scope)) };
}

/**
 * What `buildBoth` is doing right now, so a caller can show honest progress.
 *
 * These are the REAL phases, not a timer pretending to be one. The PDF is by far the longest —
 * it draws every page by hand, and on a big book that is a few seconds during which a dialog
 * saying only "Building files…" looks indistinguishable from a hang.
 */
export type BuildStage = "pdf" | "workbook";

export const BUILD_STAGE_LABEL: Record<BuildStage, string> = {
  pdf: "Drawing the PDF",
  workbook: "Writing the workbook",
};

/**
 * Both artefacts for one scope.
 *
 * `onStage` fires BEFORE each phase begins, and the yield after it is what makes the callback
 * worth having: both builders are long synchronous draws, so without handing the event loop back
 * the browser never repaints and every stage arrives at once, after the work is finished.
 */
export async function buildBoth(
  ctx: CollectionsExportContext,
  scope: ExportScope,
  onStage?: (stage: BuildStage) => void,
): Promise<{ blob: Blob; filename: string }[]> {
  const yieldToPaint = () => new Promise<void>((r) => setTimeout(r, 0));

  onStage?.("pdf");
  if (onStage) await yieldToPaint();
  const pdf = await buildPdf(ctx, scope);

  onStage?.("workbook");
  if (onStage) await yieldToPaint();
  const xlsx = buildXlsx(ctx, scope);

  return [pdf, xlsx];
}
