/**
 * The Collection report, built end to end with nobody logged in.
 *
 * This is the piece the scheduled send (RC-2) calls: hand it the raw ConnectWave book and a
 * period, and it returns the same `CollectionsExportContext` the screen's Export button assembles
 * — which `buildPdf` / `buildXlsx` then render into the very files a person downloads by hand.
 *
 * NOTHING HERE DECIDES ANYTHING ABOUT THE REPORT. Every rule it applies is imported:
 *
 *   who is eligible          selectEligible        lib/collectionScope
 *   who is listed            listReportRows        lib/collectionScope
 *   the sale-type scope      makeSaleTypeScope     lib/collectionScope
 *   the KPI numbers          computeKpis           lib/collectionCards
 *   the cards and wording    cardFactsFor          lib/collectionCards
 *   the filter record        buildFilterSummary    lib/collectionScope
 *   the roll-up tree         makeMetricsOf etc.    lib/collections
 *
 * If a rule needs changing it changes in one of those files and BOTH the screen and the mail move
 * together. A `.filter()` written in this file would be the beginning of the drift this whole
 * exercise exists to prevent.
 *
 * ⚠ THE PERIOD IS AN INPUT, NOT A DEFAULT. Guessing it is the one way to produce a report that
 *   looks entirely plausible and is answering a different question — a 15-month window against a
 *   screen set to 15 days lists 359 customers where the screen lists 247, with no error anywhere.
 *   The caller must pass the saved report settings.
 */

import {
  ZC_COLUMNS, addMetrics, buildLastReceiptAmounts, buildLastReceiptDates, buildLedgerBalances,
  buildMonthlySeries, buildOutstandingByType, dominantSaleTypeOf, emptyMetrics, makeMetricsOf,
  zcDimValue,
  type RangeFacts, type ZCColumn, type ZCMetrics, type ZCRow,
} from "./collections";
import { buildCollectionsAppData, type RawCollectionsData } from "./collectionsAppData";
import { dataUpdatedTillISO } from "./collectionsRange";
import { cardFactsFor, computeKpis, toPdfKpi, type CardContext, type ZCMode } from "./collectionCards";
import {
  buildFilterSummary, listReportRows, makeSaleTypeScope, selectEligible, type ZCFilters,
} from "./collectionScope";
import { groupNameOf } from "./customerGroups";
import { saleTypeLabel } from "./salesReport";
import type { CollectionsExportContext } from "./collectionsExport";

/** Everything the caller must decide. None of it is guessed — see the header. */
export interface CollectionsReportRequest {
  mode: ZCMode;
  /** The threshold report's bar. Ignored by the zero and dormant reports. */
  threshold: number;
  /** The shortfall target the KPI strip measures against. */
  target: number;
  filters: ZCFilters;
  /** Grouping for the roll-up, e.g. ["salesperson", "group"]. */
  groupBy: string[];
  /** Which columns the roll-up carries. Defaults to every column the report defines. */
  columnKeys?: string[];
  /** The period, in the report's own month labels. */
  windowMonths: string[];
  prevMonths: string[];
  /** Custom date range instead of whole months. Both must be supplied together. */
  usingDateRange?: boolean;
  range?: Map<string, RangeFacts> | null;
  countJournalSettlements: boolean;
  /** Printed on the document, e.g. "Last 15 Days (05-08-2026 – 20-08-2026)". */
  periodLabel: string;
  /** The view's name, printed when the report is otherwise ungrouped. */
  viewLabel: string;
  title: string;
  subtitle: string;
  /** What the prior period is called, for the two comparison cards. */
  priorLabel: string;
}

export interface CollectionsReportResult {
  ctx: CollectionsExportContext;
  /** Counts worth logging on a scheduled run, so a bad night is diagnosable after the fact. */
  stats: { eligible: number; listed: number; salespersons: number };
}

export function buildCollectionsReportContext(
  raw: RawCollectionsData,
  req: CollectionsReportRequest,
): CollectionsReportResult {
  const app = buildCollectionsAppData(raw);
  const { allCustomers, consolidatedCustomers, customerDetail, customerGroupMap, dashboard } = app;

  const months = (dashboard?.trend ?? []).map((t) => t.month);
  const asOfDate = dashboard?.asOfDate ?? "";
  const groupOf = (c: Parameters<typeof groupNameOf>[0]) => groupNameOf(c, customerGroupMap);

  // The same five derivations the page makes, from the same builders.
  //
  // "live" is `CollectionsSource`'s name for ConnectWave — the value the page passes when the
  // Live (Tally) toggle is on, which is its default. It is NOT the string "connectwave"; that is
  // `ReceivablesSource`, a different vocabulary for the same choice.
  const series = buildMonthlySeries(allCustomers, customerDetail, "live");
  const lastDates = buildLastReceiptDates(allCustomers, customerDetail, "live");
  const lastAmounts = buildLastReceiptAmounts(allCustomers, customerDetail, "live");
  const balances = buildLedgerBalances(allCustomers);
  const outstandingByType = buildOutstandingByType(allCustomers);

  // Eligible pool first, sale type applied a step later — see collectionScope's header.
  const eligibleAllTypes = selectEligible(consolidatedCustomers, req.filters, groupOf);
  const inScope = makeSaleTypeScope(req.filters.saleTypes, outstandingByType);
  const eligible = eligibleAllTypes.filter(inScope);

  const { rows: allTypeRows } = listReportRows(eligibleAllTypes, {
    mode: req.mode,
    threshold: req.threshold,
    months,
    windowMonths: req.windowMonths,
    prevMonths: req.prevMonths,
    asOfDate,
    countJournalSettlements: req.countJournalSettlements,
    usingDateRange: !!req.usingDateRange,
    range: req.range ?? null,
    hasPrevRange: req.prevMonths.length > 0,
    series, lastDates, lastAmounts, balances,
  }, groupOf);
  const rows = allTypeRows.filter((r) => inScope(r.customer));

  const cardCtx: CardContext = {
    mode: req.mode,
    threshold: req.threshold,
    target: req.target,
    hasPrior: req.prevMonths.length > 0,
    priorLabel: req.priorLabel,
    horizonLabel: months[0] ?? "—",
  };

  const columns: ZCColumn[] = req.columnKeys?.length
    ? ZC_COLUMNS.filter((c) => req.columnKeys!.includes(c.key))
    : ZC_COLUMNS;

  const metricsOf = makeMetricsOf(req.target);
  const treeOpts = {
    // "Sale Type" is resolved here, not in the shared zcDimValue: the classifier needs the
    // ledger-scoped outstandingByType map. Same dominantSaleTypeOf as the filter ⇒ groups and
    // filter agree. Identical to the page's treeOpts.
    dimValue: (r: ZCRow, dim: string) => {
      if (dim === "saleType") {
        const st = dominantSaleTypeOf(r.customer, outstandingByType);
        return { value: st, label: saleTypeLabel(st) };
      }
      return zcDimValue(r, dim);
    },
    idOf: (r: ZCRow) => r.customer.id,
    metricsOf,
    empty: emptyMetrics,
    add: addMetrics,
  };

  const ctx: CollectionsExportContext = {
    meta: {
      title: req.title,
      description: req.subtitle,
      viewLabel: req.viewLabel,
      dims: req.groupBy.map((d) => ({ key: d, label: d })),
      periodLabel: req.periodLabel,
      asOfDate,
      dataUpdatedTill: dataUpdatedTillISO(asOfDate),
    },
    columns,
    kpis: cardFactsFor(computeKpis(rows, eligible, req.target), cardCtx).map(toPdfKpi),
    // Rebuilt per salesperson from the SAME card definitions, so a rep's extract states the rep's
    // position. Their eligible pool is scoped too, or "of N who owe money" would still count the
    // company's debtors rather than theirs.
    kpisFor: (subset: ZCRow[], salesperson: string) =>
      cardFactsFor(
        computeKpis(
          subset,
          eligible.filter((c) =>
            (c.salesPersons?.length ? c.salesPersons : [c.salesPerson]).includes(salesperson),
          ),
          req.target,
        ),
        cardCtx,
      ).map(toPdfKpi),
    // No KPI lens on a scheduled run: the cards and the table describe the same set, so the note
    // the screen shows when a lens narrows the table below the cards does not apply.
    filterSummary: buildFilterSummary(req.filters, [], [], {}),
    rows,
    customerDetail,
    treeOpts,
  } as CollectionsExportContext;

  return {
    ctx,
    stats: {
      eligible: eligible.length,
      listed: rows.length,
      salespersons: new Set(
        rows.flatMap((r) =>
          r.customer.salesPersons?.length ? r.customer.salesPersons : [r.customer.salesPerson],
        ).filter(Boolean),
      ).size,
    },
  };
}
