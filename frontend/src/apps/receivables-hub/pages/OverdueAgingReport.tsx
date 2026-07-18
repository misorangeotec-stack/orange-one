import {
  useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback, Fragment,
  type ReactNode, type CSSProperties,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlarmClock, ChevronRight, ChevronDown, Download, ArrowLeft, Info, Pin, Search, X,
  ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, Hourglass, Users, CalendarX2,
  ShoppingCart, Ban, History, Layers, AlertTriangle,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@hub/components/ui/pagination";
import { Tooltip, TooltipContent, TooltipTrigger } from "@hub/components/ui/tooltip";
import { MultiSelect } from "@hub/components/MultiSelect";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { SaleTypeMultiSelect } from "@hub/components/SaleTypeMultiSelect";
import { CustomerCategoryMultiSelect, matchesCategory } from "@hub/components/CustomerCategoryMultiSelect";
import { ColumnPicker, type ColumnOption } from "@hub/components/ColumnPicker";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { GroupByBuilder } from "@hub/components/GroupByBuilder";
import { InvoiceDrilldownDialog, type InvoiceDrillRow } from "@hub/components/InvoiceDrilldownDialog";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData, groupNameOf, allGroupNames } from "@hub/lib/useAppData";
import { ReceivablesSourceProvider } from "@hub/lib/sourceContext";
import { FYProvider } from "@hub/lib/fyContext";
import { buildGroupTree, sortTree, type GroupNode } from "@hub/lib/groupTree";
import { fmtINRMoney, formatDateDMY } from "@hub/lib/utils";
import {
  enumerateBills, ledgerAdjBill, type EnrichedBill,
} from "@hub/lib/agingReport";
import {
  buildMonthlySeries, buildLastReceiptDates, resolveWindow, zcDimValue, detailPathFor,
  NEVER_PAID, type ZCDim,
} from "@hub/lib/collections";
import {
  buildOverdueRows, applyOAFocus, oaTotalsOf, oaMetricsOf, addOAMetrics, emptyOAMetrics,
  isAged, isBroughtForward, horizonStartFrom, parseCutoff, reconcilesToAging,
  CUTOFF_PRESETS, DEFAULT_OA_COLUMNS, EPS, OA_COLUMNS, OA_DIMENSIONS, OA_PRESETS,
  OA_FOCUS_LABELS,
  type OAColumn, type OAColumnKey, type OADim, type OAFocus, type OAMetrics, type OARow,
} from "@hub/lib/overdueAging";
import { exportOverdueAgingXlsx } from "@hub/lib/exportOverdueAging";
import type { ConsolidatedCustomer, SaleType } from "@hub/lib/types";

/**
 * Customers Overdue Over N Days — the aged-debt report.
 *
 *   ?over=120  → "Customers Overdue Over 120 Days"  (the card management asked for)
 *   ?over=90 / ?over=180 / any custom cutoff.
 *
 * The headline is the AGED SLICE — Σ pending of the bills that are themselves past the cutoff,
 * not the customer's whole balance. The engine (lib/overdueAging.ts) carries the reasoning: why
 * every rupee is bill-wise rather than read off Customer.agingBuckets, why the cutoffs 90/120/180
 * reconcile exactly to the Aging Report's columns, and why % Aged divides by billed outstanding.
 *
 * PINNED TWICE, both deliberate:
 *
 *  1. SOURCE → the pipeline. The admin "Live (Tally)" topbar toggle must not be able to change a
 *     number on a report that goes to management. (Same as CollectionPerformanceReport / Followups.)
 *
 *  2. SCOPE → Both FYs. This is the subtle one. On a single-FY view the figure barely moves but its
 *     MEANING flips: FY 26-27 is ~100 days old, so no invoice raised inside it can yet be 120 days
 *     overdue — 100% of the number would silently be pre-FY debt. Aging is a property of the whole
 *     book, so the report reads the whole book. The nested FYProvider below re-bases the FY context
 *     to its default (Both FYs), and UserLayout hides the FY selector on this route so the topbar
 *     can never contradict the data.
 */

const PAGE_SIZE_OPTIONS = [25, 50, 100, "all"] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type Segment = "all" | "active" | "no_activity";

/** Cut the long tail without a fiddly ₹ input. Reads the AGED slice, not the whole balance. */
const MIN_AGED_OPTIONS = [
  { key: "0", label: "All", value: 0 },
  { key: "1L", label: "≥ ₹1 L", value: 100_000 },
  { key: "5L", label: "≥ ₹5 L", value: 500_000 },
] as const;
type MinAgedKey = (typeof MIN_AGED_OPTIONS)[number]["key"];

/** The number of sale types. A full selection means "no filter" — see the anchoring note below. */
const SALE_TYPE_COUNT = 5;

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

/** The never-paid sentinel must never render as 9007199254740991. */
const daysText = (v: number): string =>
  v === NEVER_PAID ? "Never" : v < 0 ? "—" : `${v}d`;

/** Map an enumerated bill to the drill-down dialog's row shape. */
function toDrillRow(b: EnrichedBill): InvoiceDrillRow {
  return {
    customerName: b.cust.name,
    groupName: b.dims.group,
    company: b.cust.company,
    location: b.cust.location,
    number: b.inv.number,
    billRefName: b.inv.billRefName,
    date: b.inv.date,
    amount: b.inv.amount,
    received: b.inv.amount - b.inv.pending,
    pending: b.inv.pending,
    dueDate: b.inv.dueDate,
    overdueDays: b.inv.overdueDays,
    status: b.inv.status,
    voucherType: b.inv.voucherType,
  };
}

function OverdueAgingInner() {
  // ── The cutoff: the one control that decides what this report is ──────────────────
  const [params, setParams] = useSearchParams();
  const cutoff = useMemo(() => parseCutoff(params.get("over")), [params]);
  const setCutoff = (n: number) =>
    setParams((p) => { p.set("over", String(n)); return p; }, { replace: true });
  const [customCutoff, setCustomCutoff] = useState("");

  const title = `Customers Overdue Over ${cutoff} Days`;
  const ties = reconcilesToAging(cutoff);

  const {
    loading, allCustomers, consolidatedCustomers, customerDetail, customerGroupMap,
    dashboard, salesPersonOptions,
  } = useAppData({});
  const asOfDate = dashboard?.asOfDate ?? "";

  const months = useMemo(() => (dashboard?.trend ?? []).map((t) => t.month), [dashboard]);
  /** "Still buying" is judged on the trailing quarter — the window that makes a manager act. */
  const windowMonths = useMemo(() => resolveWindow(months, "3m"), [months]);
  /**
   * The brought-forward boundary: the first month we hold data for. NOT the current financial-year
   * start — see isBroughtForward. Empty when there is no trend, in which case the split is hidden
   * rather than reported as 100% billed-in-period, which would be a lie.
   */
  const horizonStart = useMemo(() => horizonStartFrom(months), [months]);

  // ── Filters ───────────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  const [groupNamesSel, setGroupNamesSel] = useState<string[]>([]);
  const [salespersons, setSalespersons] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [saleTypes, setSaleTypes] = useState<string[]>([]);
  const [minAged, setMinAged] = useState<MinAgedKey>("0");
  // "More"
  // Defaults to ALL, NOT "active" like the Aging Report. A dormant customer sitting on a 400-day-old
  // unpaid bill is precisely who management is asking about — excluding them would be the whole
  // point of the report, missed. Consequence: this report's total is >= the Aging Report's "Total
  // 120+" until both segments are set the same. The basis panel says so.
  const [segment, setSegment] = useState<Segment>("all");
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [excludeBF, setExcludeBF] = useState(false);

  const companyOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => c.company).filter(Boolean))].sort(),
    [allCustomers],
  );
  const locationOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => c.location).filter(Boolean))].sort(),
    [allCustomers],
  );
  const customerOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => c.name).filter(Boolean))].sort(),
    [allCustomers],
  );
  const realGroupNames = useMemo(
    () => allGroupNames(customerGroupMap),
    [customerGroupMap],
  );
  const groupOptions = useMemo(() => [...realGroupNames].sort(), [realGroupNames]);

  const groupOf = useCallback(
    (c: ConsolidatedCustomer) => groupNameOf(c, customerGroupMap),
    [customerGroupMap],
  );

  // ── Scope the RAW ledgers ─────────────────────────────────────────────────────────
  // Mirrors AgingReport: the dimension filters are applied here AND (identically) inside
  // enumerateBills, so `scopedLedgers` and the bill list always agree — which is what makes the
  // ledger-anchoring identity below hold. Segment is judged on the customer's COMBINED
  // (by-name) activity, so an opening-balance-only ledger of a customer who is active elsewhere
  // stays in "Active".
  const scopedLedgers = useMemo(() => {
    let d = allCustomers.filter((c) => matchesCategory(c, categories));
    if (companies.length)    { const s = new Set(companies);    d = d.filter((c) => s.has(c.company)); }
    if (locations.length)    { const s = new Set(locations);    d = d.filter((c) => s.has(c.location)); }
    if (salespersons.length) { const s = new Set(salespersons); d = d.filter((c) => s.has(c.salesPerson)); }
    if (customerNames.length){ const s = new Set(customerNames);d = d.filter((c) => s.has(c.name)); }
    if (groupNamesSel.length){ const s = new Set(groupNamesSel);d = d.filter((c) => s.has(groupNameOf(c, customerGroupMap))); }
    if (segment !== "all") {
      const act = new Map<string, number>();
      for (const c of d) {
        const a = c.sales + c.receipts + c.creditNotes + (c.otherPayments ?? 0);
        act.set(c.name, (act.get(c.name) ?? 0) + a);
      }
      d = d.filter((c) =>
        segment === "active" ? (act.get(c.name) ?? 0) > 0 : (act.get(c.name) ?? 0) <= 0,
      );
    }
    if (blockedOnly) d = d.filter((c) => c.blocked === true);
    return d;
  }, [
    allCustomers, categories, companies, locations, salespersons, customerNames, groupNamesSel,
    segment, blockedOnly, customerGroupMap,
  ]);

  /** The chokepoint that keeps every money figure inside the filter. See the engine header. */
  const inScopeLedgerIds = useMemo(
    () => new Set(scopedLedgers.map((c) => c.id)),
    [scopedLedgers],
  );

  // ── Bills ─────────────────────────────────────────────────────────────────────────
  const filters = useMemo(
    () => ({ companies, locations, salespersons, saleTypes: saleTypes as SaleType[], customerNames }),
    [companies, locations, salespersons, saleTypes, customerNames],
  );

  const baseBills = useMemo(
    () => enumerateBills(scopedLedgers, customerDetail, asOfDate, filters, customerGroupMap),
    [scopedLedgers, customerDetail, asOfDate, filters, customerGroupMap],
  );

  /** A sale-type filter is active only when it is a PROPER subset — selecting all 5 means "no
   *  filter". (Same guard as AgingReport; if the option count ever changes, so must this.) */
  const saleTypeActive = saleTypes.length > 0 && saleTypes.length < SALE_TYPE_COUNT;

  /**
   * Anchor each customer's Outstanding to its NET ledger balance by injecting one synthetic line
   * per ledger carrying (c.outstanding − Σ its real bills). It lands in "Unbilled Adj." and can
   * never enter an overdue bucket (overdueDays 0), so the HEADLINE IS UNAFFECTED — only the
   * Outstanding column and the dashboard tie depend on it.
   *
   * Skipped under a sale-type filter: c.outstanding isn't split by type, so there is nothing to
   * anchor to. Outstanding then falls back to bill-wise gross. The banner says so.
   */
  const bills = useMemo(() => {
    if (saleTypeActive) return baseBills;
    const billNet = new Map<string, number>();
    for (const b of baseBills) billNet.set(b.cust.id, (billNet.get(b.cust.id) ?? 0) + b.inv.pending);
    const extra: EnrichedBill[] = [];
    for (const c of scopedLedgers) {
      const adj = c.outstanding - (billNet.get(c.id) ?? 0);
      if (Math.abs(adj) >= EPS) extra.push(ledgerAdjBill(c, adj, customerGroupMap));
    }
    return extra.length ? [...baseBills, ...extra] : baseBills;
  }, [baseBills, scopedLedgers, customerGroupMap, saleTypeActive]);

  const billsByLedger = useMemo(() => {
    const m = new Map<string, EnrichedBill[]>();
    for (const b of bills) {
      const arr = m.get(b.cust.id);
      if (arr) arr.push(b);
      else m.set(b.cust.id, [b]);
    }
    return m;
  }, [bills]);

  /**
   * Open bills with NO due date. The pipeline scores them overdue_days = 0, so they can never be
   * aged — they are invisible on every aging report in the product. ₹0.71 cr of them today. Rather
   * than let them stay lost, the report says out loud that it excluded them and shows the list.
   */
  const undatedBills = useMemo(
    () => bills.filter((b) => !b.isLedgerAdj && b.inv.pending > 0 && !b.inv.dueDate),
    [bills],
  );
  const undatedTotal = useMemo(
    () => undatedBills.reduce((s, b) => s + b.inv.pending, 0),
    [undatedBills],
  );

  // ── Receipt-derived columns (source-aware helpers, pinned to "pipeline") ───────────
  // Summed over constituentIds ∩ inScopeLedgerIds inside buildOverdueRows — NOT via factsFor(),
  // which sums over EVERY constituent ledger and would leak another company's sales into a
  // company-filtered view.
  const series = useMemo(
    () => buildMonthlySeries(allCustomers, customerDetail, "pipeline"),
    [allCustomers, customerDetail],
  );
  const salesByLedgerMonth = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    for (const [id, byMonth] of series) {
      const m = new Map<string, number>();
      for (const [label, facts] of byMonth) m.set(label, facts.sales);
      out.set(id, m);
    }
    return out;
  }, [series]);
  const lastReceiptByLedger = useMemo(
    () => buildLastReceiptDates(allCustomers, customerDetail, "pipeline"),
    [allCustomers, customerDetail],
  );

  // ── Rows ──────────────────────────────────────────────────────────────────────────
  const eligible = useMemo(() => {
    // Consolidated customers that still have at least one in-scope ledger.
    let d = consolidatedCustomers.filter((c) =>
      (c.constituentIds?.length ? c.constituentIds : [c.id]).some((id) => inScopeLedgerIds.has(id)),
    );
    const q = search.trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      d = d.filter((c) => {
        const text = `${c.name} ${groupOf(c)} ${c.salesPersons?.join(" ") ?? c.salesPerson}`.toLowerCase();
        return tokens.every((t) => text.includes(t));
      });
    }
    return d;
  }, [consolidatedCustomers, inScopeLedgerIds, search, groupOf]);

  const allRows = useMemo(
    () =>
      buildOverdueRows({
        customers: eligible,
        billsByLedger,
        inScopeLedgerIds,
        salesByLedgerMonth,
        windowMonths,
        lastReceiptByLedger,
        groupOf,
        cutoff,
        horizonStart,
        asOfDate,
        excludeBroughtForward: excludeBF,
      }),
    [
      eligible, billsByLedger, inScopeLedgerIds, salesByLedgerMonth, windowMonths,
      lastReceiptByLedger, groupOf, cutoff, horizonStart, asOfDate, excludeBF,
    ],
  );

  const rows = useMemo(() => {
    const min = MIN_AGED_OPTIONS.find((o) => o.key === minAged)?.value ?? 0;
    return min > 0 ? allRows.filter((r) => r.facts.aged >= min) : allRows;
  }, [allRows, minAged]);

  // ── Focus (the clickable KPI cards) ───────────────────────────────────────────────
  const [focus, setFocus] = useState<Set<OAFocus>>(new Set());
  const toggleFocus = (f: OAFocus) =>
    setFocus((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  const focusedRows = useMemo(() => applyOAFocus(rows, focus), [rows, focus]);

  // ── View / columns / sort ─────────────────────────────────────────────────────────
  const [groupBy, setGroupBy] = useState<OADim[]>(["customer"]);
  const viewLabel = useMemo(
    () => groupBy.map((d) => OA_DIMENSIONS.find((x) => x.key === d)?.label ?? d).join(" → "),
    [groupBy],
  );

  const columnOptions: ColumnOption[] = OA_COLUMNS.map((c) => ({ key: c.key, label: c.label }));
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_OA_COLUMNS);
  const columns = useMemo<OAColumn[]>(
    () => OA_COLUMNS.filter((c) => visibleCols.includes(c.key)),
    [visibleCols],
  );
  const colByKey = useMemo(() => new Map(OA_COLUMNS.map((c) => [c.key, c])), []);

  type SortKey = OAColumnKey | "label";
  const [sortKey, setSortKey] = useState<SortKey>("aged");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "label" ? "asc" : "desc"); }
  };
  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-30 inline" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 inline" /> : <ArrowDown className="h-3 w-3 inline" />;
  };

  const [basisOpen, setBasisOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  useEffect(() => {
    setExpanded(new Set());
    setPage(1);
  }, [groupBy, search, customerNames, groupNamesSel, salespersons, companies, locations, categories, saleTypes, minAged, segment, blockedOnly, excludeBF, focus, cutoff]);

  // ── Roll-up ───────────────────────────────────────────────────────────────────────
  // Built from the FOCUSED rows, so the table, its grand total, pagination and the export all
  // follow the active lenses. The KPI cards deliberately do NOT — see `allTotals`.
  const tree = useMemo(
    () =>
      buildGroupTree<OARow, OAMetrics>(focusedRows, groupBy, {
        // Shared with the two collection reports so group labels and drill-through never drift.
        dimValue: zcDimValue,
        idOf: (r) => r.customer.id,
        metricsOf: oaMetricsOf,
        empty: emptyOAMetrics,
        add: addOAMetrics,
      }),
    [focusedRows, groupBy],
  );

  // Nulls sort LAST in both directions — a "—" floating to the top of a descending sort reads as
  // if it were the worst offender.
  const sortedRoots = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "label")
      return sortTree(tree.roots, (a, b) => dir * a.label.localeCompare(b.label));
    const col = colByKey.get(sortKey);
    if (!col) return tree.roots;
    return sortTree(tree.roots, (a, b) => {
      const av = col.value(a.metrics);
      const bv = col.value(b.metrics);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return dir * (av - bv);
    });
  }, [tree.roots, sortKey, sortDir, colByKey]);

  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(sortedRoots.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRoots = pageSize === "all"
    ? sortedRoots
    : sortedRoots.slice((safePage - 1) * pageSize, safePage * pageSize);

  // ── KPIs ──────────────────────────────────────────────────────────────────────────
  // CRITICAL: over `rows` — the UNFOCUSED set — never over tree.total. The cards are a fixed set
  // of lenses over the same customers; if they recomputed under the active focus, the number
  // printed on a card would stop matching what clicking it shows.
  const allTotals = useMemo(() => oaTotalsOf(rows), [rows]);
  const agedBillTotal = useMemo(
    () => bills.filter((b) => isAged(b, cutoff)).length,
    [bills, cutoff],
  );

  interface KpiCard {
    label: string;
    icon: typeof AlarmClock;
    value: string;
    sub: string;
    focusKey: OAFocus | null;
    count: number;
    explain: ReactNode;
  }

  const t = allTotals;
  const bfPct = t.aged > EPS ? (t.agedBroughtForward / t.aged) * 100 : 0;

  const kpiCards: KpiCard[] = [
    {
      label: `Overdue > ${cutoff} Days`, icon: Hourglass, focusKey: null,
      value: fmtINRMoney(t.aged),
      sub: `across ${t.agedBillCount} bill${t.agedBillCount === 1 ? "" : "s"}`,
      count: rows.length,
      explain: (
        <>
          Money sitting on bills that are <strong>more than {cutoff} days past their due date</strong> —{" "}
          <strong>{fmtINRMoney(t.aged)}</strong> across <strong>{t.agedBillCount}</strong> open bills.
          <br />
          <br />
          This is the aged slice <em>only</em>. A customer who owes ₹50 L of which ₹8 L is past{" "}
          {cutoff} days contributes ₹8 L, not ₹50 L. Every rupee here traces to a named invoice —
          click the figure in any row to see them.
        </>
      ),
    },
    {
      label: "Customers", icon: Users, focusKey: null,
      value: String(rows.length),
      sub: "carrying aged debt",
      count: rows.length,
      explain: (
        <>
          <strong>{rows.length}</strong> customers have at least one bill more than {cutoff} days
          overdue. Ledgers with the same name are merged, so a customer trading through three
          companies counts once.
        </>
      ),
    },
    {
      label: "Brought Forward", icon: History, focusKey: "broughtForward",
      value: fmtINRMoney(t.agedBroughtForward),
      sub: `${bfPct.toFixed(0)}% of the aged total`,
      count: t.agedBroughtForward,
      explain: (
        <>
          Of the {fmtINRMoney(t.aged)} above, <strong>{fmtINRMoney(t.agedBroughtForward)}</strong> (
          {bfPct.toFixed(0)}%) is <strong>opening debt</strong> — bills dated before{" "}
          {formatDateDMY(horizonStart)}, carried into the system rather than billed on our watch.
          <br />
          <br />
          It is real, genuinely overdue, and the oldest money on the books, so it is counted. But it
          is a different conversation from debt that went bad since we started recording — which is
          why the split is always on screen. Use <em>Exclude brought-forward</em> under More to drop
          it.
        </>
      ),
    },
    {
      label: "> 180 Days", icon: CalendarX2, focusKey: "over180",
      value: fmtINRMoney(t.agedOver180),
      sub: "the oldest, hardest money",
      count: t.agedOver180,
      explain: (
        <>
          Of the aged total, <strong>{fmtINRMoney(t.agedOver180)}</strong> is more than{" "}
          <strong>180 days</strong> past due. Recovery odds fall off a cliff here.
          <br />
          <br />
          Derived from the bills themselves — not from the stored aging buckets, which fold in
          opening-balance residue that no invoice backs.
        </>
      ),
    },
    {
      label: "Still Buying", icon: ShoppingCart, focusKey: "stillBuying",
      value: String(t.stillBuying),
      sub: `${fmtINRMoney(t.salesInWindow)} billed in 3 months`,
      count: t.stillBuying,
      explain: (
        <>
          <strong>{t.stillBuying}</strong> of these customers were <strong>still being supplied</strong>{" "}
          in the last three months — <strong>{fmtINRMoney(t.salesInWindow)}</strong> of fresh billing to
          people who haven't paid a bill in over {cutoff} days.
          <br />
          <br />
          This is the column that gets a decision made. Combine it with <em>Never Paid</em> for the
          most damning list on the report.
        </>
      ),
    },
    {
      label: "Never Paid", icon: Ban, focusKey: "neverPaid",
      value: String(t.neverPaid),
      sub: "no receipt since 01-04-2025",
      count: t.neverPaid,
      explain: (
        <>
          <strong>{t.neverPaid}</strong> have <strong>never paid us a rupee</strong> — no receipt
          voucher and no manual Other Payment in the entire data horizon, which starts{" "}
          <strong>01-04-2025</strong>.
        </>
      ),
    },
    {
      label: "Fully Aged", icon: Layers, focusKey: "fullyAged",
      value: String(t.fullyAged),
      sub: "whole balance is past the cutoff",
      count: t.fullyAged,
      explain: (
        <>
          <strong>{t.fullyAged}</strong> customers whose <strong>entire</strong> open-bill balance is
          past {cutoff} days — nothing recent is holding the account up. These are dead accounts, not
          slow ones.
        </>
      ),
    },
  ];

  // ── Drill-down ────────────────────────────────────────────────────────────────────
  const [drill, setDrill] = useState<{ open: boolean; title: string; subtitle: string; rows: InvoiceDrillRow[] }>(
    { open: false, title: "", subtitle: "", rows: [] },
  );

  const openDrill = (node: GroupNode<OAMetrics> | null, col: OAColumn) => {
    if (!col.drill) return;
    // The node's customers → their in-scope ledgers → the bills behind the clicked lens.
    const wanted = new Set(
      (node ? node.ids : focusedRows.map((r) => r.customer.id)),
    );
    const byId = new Map(focusedRows.map((r) => [r.customer.id, r]));
    const ledgerIds = new Set<string>();
    for (const id of wanted) {
      const r = byId.get(id);
      if (!r) continue;
      for (const lid of (r.customer.constituentIds?.length ? r.customer.constituentIds : [r.customer.id])) {
        if (inScopeLedgerIds.has(lid)) ledgerIds.add(lid);
      }
    }

    const out: InvoiceDrillRow[] = [];
    for (const lid of ledgerIds) {
      for (const b of billsByLedger.get(lid) ?? []) {
        if (b.isLedgerAdj) continue;
        if (excludeBF && isBroughtForward(b, horizonStart)) continue;
        const keep =
          col.drill === "aged" ? isAged(b, cutoff)
          : col.drill === "totalOverdue" ? b.inv.pending > 0 && b.inv.overdueDays > 0
          : b.inv.pending > 0; // billedOutstanding
        if (keep) out.push(toDrillRow(b));
      }
    }
    if (out.length === 0) return;
    setDrill({
      open: true,
      title: `${col.label} — open bills`,
      subtitle: node ? (node.sub ? `${node.label} · ${node.sub}` : node.label) : "All rows",
      rows: out,
    });
  };

  // ── Freeze panes ──────────────────────────────────────────────────────────────────
  const [freezeLevel, setFreezeLevel] = useState<0 | 1>(1);
  const chevRef = useRef<HTMLTableCellElement>(null);
  const labelRef = useRef<HTMLTableCellElement>(null);
  const [colW, setColW] = useState({ chev: 32, label: 240 });
  const measureCols = useCallback(() => {
    const chev = chevRef.current?.offsetWidth ?? 32;
    const label = labelRef.current?.offsetWidth ?? 240;
    setColW((prev) => (prev.chev === chev && prev.label === label ? prev : { chev, label }));
  }, []);
  useLayoutEffect(measureCols); // re-measure every render; the setState is guarded so it can't loop
  useEffect(() => {
    window.addEventListener("resize", measureCols);
    return () => window.removeEventListener("resize", measureCols);
  }, [measureCols]);

  type FreezeId = "chevron" | "label";
  const freezeStick = (
    id: FreezeId,
    opts?: { header?: boolean; bg?: string },
  ): { className: string; style?: CSSProperties } => {
    if (freezeLevel < 1) return { className: "" };
    const bg = opts?.bg ?? (opts?.header ? "bg-muted" : "bg-surface");
    const shadow = id === "label" ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.18)]" : "";
    return {
      className: `sticky ${opts?.header ? "z-20" : "z-10"} ${bg} ${shadow}`,
      style: { left: id === "chevron" ? 0 : colW.chev },
    };
  };
  const freezePin = () => {
    const active = freezeLevel >= 1;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setFreezeLevel(active ? 0 : 1); }}
        className={`ml-1 inline-flex items-center justify-center h-4 w-4 rounded shrink-0 ${active ? "text-primary" : "text-foreground/35 hover:text-foreground/70"}`}
        title={active ? "Unfreeze the name column" : "Freeze the name column while scrolling"}
      >
        <Pin className={`h-3 w-3 ${active ? "fill-primary" : ""}`} />
      </button>
    );
  };

  // ── Filter chips ──────────────────────────────────────────────────────────────────
  const chips: FilterChip[] = [
    ...(search ? [{ label: `Search: ${search}`, onRemove: () => setSearch("") }] : []),
    ...(customerNames.length ? [{ label: `Customers: ${customerNames.length}`, onRemove: () => setCustomerNames([]) }] : []),
    ...(groupNamesSel.length ? [{ label: `Groups: ${groupNamesSel.length}`, onRemove: () => setGroupNamesSel([]) }] : []),
    ...(salespersons.length ? [{ label: `Salesperson: ${salespersons.join(", ")}`, onRemove: () => setSalespersons([]) }] : []),
    ...(companies.length ? [{ label: `Company: ${companies.join(", ")}`, onRemove: () => setCompanies([]) }] : []),
    ...(locations.length ? [{ label: `Location: ${locations.join(", ")}`, onRemove: () => setLocations([]) }] : []),
    ...(categories.length ? [{ label: `Category: ${categories.join(", ")}`, onRemove: () => setCategories([]) }] : []),
    ...(saleTypes.length ? [{ label: `Sale Type: ${saleTypes.length}`, onRemove: () => setSaleTypes([]) }] : []),
    ...(minAged !== "0" ? [{ label: `Min Aged: ${MIN_AGED_OPTIONS.find((o) => o.key === minAged)?.label}`, onRemove: () => setMinAged("0") }] : []),
    ...(segment !== "all" ? [{ label: `Segment: ${segment === "active" ? "Active" : "Dormant"}`, onRemove: () => setSegment("all") }] : []),
    ...(blockedOnly ? [{ label: "Blocked only", onRemove: () => setBlockedOnly(false) }] : []),
    ...(excludeBF ? [{ label: "Excluding brought-forward", onRemove: () => setExcludeBF(false) }] : []),
  ];
  const clearFilters = () => {
    setSearch(""); setCustomerNames([]); setGroupNamesSel([]); setSalespersons([]);
    setCompanies([]); setLocations([]); setCategories([]); setSaleTypes([]);
    setMinAged("0"); setSegment("all"); setBlockedOnly(false); setExcludeBF(false);
  };

  // ── Export ────────────────────────────────────────────────────────────────────────
  const scopeLabel = `Both FYs (01-04-2025 → ${formatDateDMY(asOfDate)})`;
  const reconciliation = ties === "od_120_plus"
    ? 'Ties exactly to the Aging Report\'s "Total 120+" column (same bills, same boundaries).'
    : ties === "od_180_plus"
      ? 'Ties exactly to the Aging Report\'s "180+" column.'
      : ties === "od_90_plus"
        ? 'Ties exactly to the Aging Report\'s 91-120 + 121-180 + 180+ columns combined.'
        : `A ${cutoff}-day cutoff lands mid-bucket, so it matches no single Aging Report column.`;

  const handleExport = () => {
    exportOverdueAgingXlsx(
      sortedRoots,
      tree.total,
      focusedRows,
      // The Aged Bills sheet lists the bills behind the LISTED customers only.
      bills.filter((b) => inScopeLedgerIds.has(b.cust.id) && (!excludeBF || !isBroughtForward(b, horizonStart))),
      columns,
      {
        title,
        cutoff,
        viewLabel,
        scopeLabel,
        basis: `Sum of the pending amount on every open bill more than ${cutoff} days past its due date. Bill-wise, not from the stored aging buckets. Outstanding is the net ledger balance.`,
        reconciliation,
        asOfDate,
        filterSummary: chips.map((c) => c.label),
        exclusions: undatedBills.length
          ? [`${undatedBills.length} open bills (${fmtINRMoney(undatedTotal)}) have no due date in Tally and cannot be aged`]
          : [],
      },
      horizonStart,
    );
  };

  // ── Cells ─────────────────────────────────────────────────────────────────────────
  const metricCells = (node: GroupNode<OAMetrics> | null, isTotal: boolean): ReactNode =>
    columns.map((col) => {
      const m = node ? node.metrics : tree.total;
      const v = col.value(m);
      const clickable = !!col.drill && v !== null && Math.abs(v) >= EPS;

      const alarm =
        v === null ? false
        : col.kind === "days" ? !!col.alarm && (v === NEVER_PAID || v > 180)
        : !!col.alarm && v > EPS;

      const text =
        v === null ? "—"
        : col.kind === "money" ? fmtINRMoney(v)
        : col.kind === "days" ? daysText(v)
        : col.kind === "pct" ? `${v.toFixed(1)}%`
        : String(v);

      return (
        <TableCell
          key={col.key}
          onClick={clickable ? (e) => { e.stopPropagation(); openDrill(node, col); } : undefined}
          title={clickable ? "Click to see the bills" : undefined}
          className={`text-right font-mono whitespace-nowrap ${isTotal ? "text-sm" : "text-[13px]"} ${alarm ? "text-destructive" : ""} ${clickable ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
        >
          {text}
        </TableCell>
      );
    });

  const detailPathOf = (n: GroupNode<OAMetrics>): string | null => {
    const dim = n.path[n.path.length - 1]?.dim as ZCDim | undefined;
    return detailPathFor(dim, n.label, realGroupNames);
  };
  const openDetail = (path: string) => window.open(path, "_blank", "noopener");

  /** A customer row whose whole balance nets to a credit — an aged bill offset by a bigger advance.
   *  Flagged, never hidden: hiding them would break the tie to the Aging Report, which counts them. */
  const netCreditIds = useMemo(
    () => new Set(focusedRows.filter((r) => r.facts.isNetCredit).map((r) => r.customer.id)),
    [focusedRows],
  );

  const renderNodes = (nodes: GroupNode<OAMetrics>[]): ReactNode =>
    nodes.map((n) => {
      const hasChildren = n.children.length > 0;
      const isOpen = expanded.has(n.key);
      const path = detailPathOf(n);
      const tint = n.depth === 0 ? "" : n.depth === 1 ? "bg-muted/20" : "bg-muted/10";
      const bg = "bg-surface group-hover:bg-[hsl(var(--muted))]";
      const chev = freezeStick("chevron", { bg });
      const lab = freezeStick("label", { bg });
      const isNetCredit = !hasChildren && n.ids.length === 1 && netCreditIds.has(n.ids[0]);
      const onRowClick = path ? () => openDetail(path) : hasChildren ? () => toggle(n.key) : undefined;
      return (
        <Fragment key={n.key}>
          <TableRow
            className={`group ${tint} ${onRowClick ? "cursor-pointer hover:bg-muted/40" : ""} transition-colors`}
            onClick={onRowClick}
          >
            <TableCell style={chev.style} className={`text-muted-foreground ${chev.className}`}>
              {hasChildren && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggle(n.key); }}
                  className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/50"
                  aria-label={isOpen ? "Collapse" : "Expand"}
                >
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              )}
            </TableCell>
            <TableCell
              style={{ ...lab.style, paddingLeft: 8 + n.depth * 18 }}
              className={`whitespace-nowrap ${n.depth === 0 ? "font-medium text-sm" : "text-[13px] text-muted-foreground"} ${lab.className}`}
              title={path ? "Open in a new tab" : undefined}
            >
              <span className={path ? "group-hover:text-primary group-hover:underline" : ""}>{n.label}</span>
              {n.sub && <span className="ml-1.5 text-[10px] font-normal opacity-70">{n.sub}</span>}
              {hasChildren && <span className="ml-1.5 text-[11px] opacity-70">({n.children.length})</span>}
              {isNetCredit && (
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <span className="ml-1.5 inline-flex items-center rounded-button bg-muted px-1.5 py-0 text-[10px] text-muted-foreground border border-border">
                      net credit
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    This customer has an aged bill, but a larger advance or on-account credit sitting
                    against it — so their overall balance is in credit. The aged bill is real and still
                    needs settling; the Outstanding column is negative because we hold their money.
                  </TooltipContent>
                </Tooltip>
              )}
            </TableCell>
            {metricCells(n, false)}
          </TableRow>
          {isOpen && hasChildren && renderNodes(n.children)}
        </Fragment>
      );
    });

  const kpiGridClass = "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3";

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to="/outstanding-dashboard/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Reports
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlarmClock className="h-6 w-6 text-primary" /> {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customers with money stuck on bills more than {cutoff} days past their due date.
            {asOfDate && <span className="text-foreground/70"> As on {formatDateDMY(asOfDate)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ColumnPicker columns={columnOptions} visible={visibleCols} onChange={setVisibleCols} />
          <Button
            onClick={handleExport}
            disabled={focusedRows.length === 0}
            size="sm"
            className="rounded-button bg-primary hover:bg-primary-hover text-primary-foreground"
          >
            <Download className="h-4 w-4 mr-1.5" /> Export
          </Button>
        </div>
      </div>

      {/* Cutoff + scope */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Overdue more than</span>
            {CUTOFF_PRESETS.map((c) => (
              <Button
                key={c}
                variant={cutoff === c ? "default" : "outline"}
                size="sm"
                onClick={() => setCutoff(c)}
                className={`h-7 text-xs rounded-button ${cutoff === c ? "bg-primary text-primary-foreground" : "border-border"}`}
              >
                {c} days
              </Button>
            ))}
            {!CUTOFF_PRESETS.includes(cutoff as (typeof CUTOFF_PRESETS)[number]) && (
              <span className="h-7 px-2.5 inline-flex items-center text-xs rounded-button bg-primary text-primary-foreground">
                {cutoff} days
              </span>
            )}
            <div className="flex items-center gap-1 ml-2">
              <input
                type="number"
                min={1}
                max={3650}
                value={customCutoff}
                onChange={(e) => setCustomCutoff(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customCutoff) { setCutoff(parseCutoff(customCutoff)); setCustomCutoff(""); }
                }}
                placeholder="Custom"
                className="h-7 w-20 px-2 text-xs rounded-input border border-border bg-surface text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <span className="text-[11px] text-muted-foreground">days ↵</span>
            </div>
          </div>

          {/* The scope pin, explained. This is the report's biggest foot-gun, disarmed. */}
          <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/60">
            <span className="pt-2 inline-block">
              <strong className="text-foreground/80">Scope: {scopeLabel}.</strong> Aging is measured
              across the whole book, so this report ignores the financial-year selector — a single
              financial year cannot contain a {cutoff}-day-old invoice until it is {cutoff} days old,
              which would silently make 100% of this figure look like brought-forward debt.
            </span>
          </p>

          {!ties && (
            <div className="flex items-start gap-2 rounded-input bg-amber-500/10 border border-amber-500/30 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[11px] text-foreground/80">
                A <strong>{cutoff}-day</strong> cutoff lands mid-bucket, so it matches no single column
                on the Aging Report. The 90, 120 and 180 day cutoffs each tie to it exactly.
              </p>
            </div>
          )}

          {saleTypeActive && (
            <div className="flex items-start gap-2 rounded-input bg-amber-500/10 border border-amber-500/30 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[11px] text-foreground/80">
                A <strong>Sale Type</strong> filter is active. The <strong>Aged</strong> figure is
                unaffected — it is bill-wise, and a bill has one sale type. But the ledger balance is
                not split by type, so <strong>Outstanding</strong> falls back to bill-wise gross
                instead of the net ledger, and will not tie to the dashboard.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* The brought-forward split — always on screen. The whole number means two different things
          depending on whether you know this. */}
      {!loading && t.aged > EPS && horizonStart && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-card border border-border bg-muted/30 px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Of <strong className="text-foreground font-mono">{fmtINRMoney(t.aged)}</strong> aged:
          </span>
          <span className="text-xs text-foreground">
            <strong className="font-mono">{fmtINRMoney(t.agedInPeriod)}</strong>{" "}
            <span className="text-muted-foreground">
              billed since {formatDateDMY(horizonStart)}
            </span>
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-xs text-foreground">
            <strong className="font-mono">{fmtINRMoney(t.agedBroughtForward)}</strong>{" "}
            <span className="text-muted-foreground">
              opening debt brought forward ({bfPct.toFixed(0)}%)
            </span>
          </span>
          <button
            type="button"
            onClick={() => setExcludeBF((v) => !v)}
            className={`ml-auto h-6 px-2 text-[11px] rounded-button border transition-colors ${
              excludeBF
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {excludeBF ? "Showing this year only" : "Exclude brought-forward"}
          </button>
        </div>
      )}

      {/* Bills that cannot be aged at all. They are invisible on every other aging report in the
          product; saying so is the only way they ever get chased. */}
      {!loading && undatedBills.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <span className="text-xs text-foreground/80">
            <strong>Excluded: {undatedBills.length} open bill{undatedBills.length === 1 ? "" : "s"} ·{" "}
            <span className="font-mono">{fmtINRMoney(undatedTotal)}</span></strong> — no due date in
            Tally, so they cannot be aged and appear on no aging report. Worth chasing separately.
          </span>
          <button
            type="button"
            onClick={() =>
              setDrill({
                open: true,
                title: "Bills with no due date",
                subtitle: "These carry no due date in Tally, so they cannot be aged.",
                rows: undatedBills.map(toDrillRow),
              })
            }
            className="ml-auto h-6 px-2 text-[11px] rounded-button border border-amber-500/40 text-amber-700 hover:bg-amber-500/15"
          >
            View list
          </button>
        </div>
      )}

      {/* KPIs — click to focus the table. */}
      <div className={kpiGridClass}>
        {kpiCards.map((k) => {
          const Icon = k.icon;
          const isSummary = k.focusKey === null;
          const active = isSummary ? focus.size === 0 : focus.has(k.focusKey!);
          const clickable = isSummary ? rows.length > 0 : active || k.count > EPS;
          const action =
            !clickable ? null
            : isSummary ? "Click to clear every filter and show all customers."
            : active ? `Click to remove the “${k.label}” filter.`
            : "Click to show only these customers in the table.";
          return (
            <Tooltip key={k.label} delayDuration={200}>
              <TooltipTrigger asChild>
                <Card
                  onClick={clickable ? () => (isSummary ? setFocus(new Set()) : toggleFocus(k.focusKey!)) : undefined}
                  role="button"
                  tabIndex={clickable ? 0 : -1}
                  aria-pressed={active}
                  aria-disabled={!clickable}
                  onKeyDown={(e) => {
                    if (!clickable) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (isSummary) setFocus(new Set());
                      else toggleFocus(k.focusKey!);
                    }
                  }}
                  className={`rounded-card bg-surface transition-all ${
                    active
                      ? "border-primary/50 ring-2 ring-primary"
                      : clickable
                        ? "border-border cursor-pointer hover:border-primary/40 hover:shadow-md"
                        : "border-border opacity-60"
                  }`}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                      <span className="text-[11px] font-medium uppercase tracking-wide truncate">{k.label}</span>
                    </div>
                    <p className="text-lg font-bold text-foreground mt-1 font-mono">{k.value}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{k.sub}</p>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                {k.explain}
                {action && <p className="mt-2 pt-2 border-t border-border/50 text-muted-foreground">{action}</p>}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {focus.size > 0 && (
        <p className="text-[11px] text-primary -mt-3">
          Showing {focusedRows.length} of {rows.length} customers —{" "}
          {[...focus].map((f) => OA_FOCUS_LABELS[f]).join(" + ")}
          {focus.size > 1 && <span className="text-muted-foreground"> (all conditions met)</span>}
          . The cards above still count all {rows.length}.
        </p>
      )}

      {/* View + filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 space-y-3">
          <GroupByBuilder dimensions={OA_DIMENSIONS} presets={OA_PRESETS} value={groupBy} onChange={setGroupBy} />

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">Filters</span>
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search customer, group…"
                  className="h-8 w-52 pl-7 pr-6 text-xs rounded-input border border-border bg-surface text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <MultiSelect options={customerOptions} value={customerNames} onChange={setCustomerNames} allLabel="All Customers" noun="customers" triggerClassName="h-8 w-44 text-xs rounded-input" />
              <MultiSelect options={groupOptions} value={groupNamesSel} onChange={setGroupNamesSel} allLabel="All Groups" noun="groups" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <SalesPersonMultiSelect options={salesPersonOptions} value={salespersons} onChange={setSalespersons} triggerClassName="h-8 w-40 text-xs rounded-input" />
              <MultiSelect options={companyOptions} value={companies} onChange={setCompanies} allLabel="All Companies" noun="companies" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <MultiSelect options={locationOptions} value={locations} onChange={setLocations} allLabel="All Locations" noun="locations" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <CustomerCategoryMultiSelect value={categories} onChange={setCategories} triggerClassName="h-8 w-40 text-xs rounded-input" />
              <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} triggerClassName="h-8 w-36 text-xs rounded-input" />

              <div className="inline-flex items-center rounded-input border border-border overflow-hidden">
                {MIN_AGED_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setMinAged(o.key)}
                    className={`h-8 px-2.5 text-xs transition-colors ${minAged === o.key ? "bg-primary text-primary-foreground font-medium" : "bg-surface text-muted-foreground hover:bg-muted"}`}
                    title="Minimum aged amount"
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs rounded-input border-border">
                    <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" /> More
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-3 space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-foreground">Customer segment</p>
                    <Select value={segment} onValueChange={(v) => setSegment(v as Segment)}>
                      <SelectTrigger className="h-8 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All customers</SelectItem>
                        <SelectItem value="active">Active this FY</SelectItem>
                        <SelectItem value="no_activity">No activity (dormant)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Defaults to <strong>All</strong> — a dormant customer with an ancient unpaid bill
                      is exactly who this report is for. Set it to <strong>Active</strong> to line up
                      with the Aging Report.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={blockedOnly} onCheckedChange={(v) => setBlockedOnly(v === true)} />
                    <span className="text-xs text-foreground">Blocked customers only</span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <Checkbox className="mt-0.5" checked={excludeBF} onCheckedChange={(v) => setExcludeBF(v === true)} />
                    <span className="text-xs text-foreground leading-snug">
                      Exclude brought-forward debt
                      <span className="block text-[10px] text-muted-foreground">
                        Drops opening bills dated before {formatDateDMY(horizonStart)} — leaves only debt
                        that went bad since we started recording.
                      </span>
                    </span>
                  </label>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearFilters} />}
        </CardContent>
      </Card>

      {/* How it's calculated */}
      <Card className="rounded-card border-border bg-surface">
        <button
          type="button"
          onClick={() => setBasisOpen((o) => !o)}
          aria-expanded={basisOpen}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors rounded-card"
        >
          <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">How this report is calculated</span>
          <span className="text-[11px] text-muted-foreground hidden sm:inline truncate">
            · every rupee traces to a named invoice
          </span>
          <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${basisOpen ? "rotate-180" : ""}`} />
        </button>

        {basisOpen && (
          <CardContent className="px-4 pb-4 pt-0">
            <ul className="space-y-2 text-[12px] leading-relaxed text-muted-foreground list-disc pl-9 marker:text-primary">
              <li>
                <strong className="text-foreground">The aged slice, not the whole balance.</strong> A
                customer is listed when they have at least one open bill more than{" "}
                <strong className="text-foreground">{cutoff} days</strong> past its due date, and the{" "}
                <strong className="text-foreground">Aged</strong> column is the sum of{" "}
                <em>those bills only</em>. Someone owing ₹50 L of which ₹8 L is past {cutoff} days
                shows ₹8 L — and is ranked on it.
              </li>
              <li>
                <strong className="text-foreground">It comes from the bills, not the buckets.</strong>{" "}
                Every figure is summed from individual open invoices, so you can click any Aged cell
                and read the invoice numbers behind it. The stored aging buckets are{" "}
                <em>not</em> used: they fold in opening-balance residue that no invoice backs, which is
                why this report can differ slightly from the Dashboard's aging chart.
              </li>
              <li>
                <strong className="text-foreground">It reconciles with the Aging Report.</strong>{" "}
                {reconciliation}{" "}
                {ties && (
                  <>
                    Set both reports' <strong className="text-foreground">Customer Segment</strong> the
                    same — this one defaults to <em>All</em>, the Aging Report to <em>Active</em> — and
                    the grand totals match to the rupee. Individual rows won't line up one-for-one: the
                    Aging Report lists each company's ledger separately, while this report merges
                    same-named customers into one row.
                  </>
                )}
              </li>
              <li>
                <strong className="text-foreground">Brought forward is counted, and shown.</strong>{" "}
                Bills dated before <strong className="text-foreground">{formatDateDMY(horizonStart)}</strong>{" "}
                are <strong className="text-foreground">opening debt</strong> — balances carried into the
                system when we started recording, not billed on our watch. They are real and genuinely
                overdue, so they count — but the split is always on screen, because{" "}
                {fmtINRMoney(t.aged)} means something different once you know {bfPct.toFixed(0)}% of it
                was inherited. (The boundary is the start of the data, not the start of the financial
                year: this financial year is younger than {cutoff} days for most of its life, so an
                FY-based split would read 100% brought-forward every time and tell you nothing.)
              </li>
              <li>
                <strong className="text-foreground">% Aged is measured against open bills.</strong>{" "}
                Aged ÷ billed outstanding — <em>not</em> ÷ the net ledger balance, which can be near
                zero or negative once advances are taken in, and would produce percentages of 4,000% or
                −70%.
              </li>
              <li>
                <strong className="text-foreground">Days overdue are as at the last data refresh</strong>{" "}
                ({formatDateDMY(asOfDate)}), not as at this moment — the same basis as every other
                screen here, so the reports agree with each other.
              </li>
              <li>
                <strong className="text-foreground">Getting around.</strong> Click a{" "}
                <strong className="text-foreground">Customer</strong> or{" "}
                <strong className="text-foreground">Customer Group</strong> row to open its detail page
                in a new tab (use the caret to expand instead). Click any{" "}
                <strong className="text-foreground">Aged</strong> figure to see the bills behind it. Use
                the <Pin className="h-3 w-3 inline" /> to freeze the name column while scrolling.
              </li>
            </ul>
          </CardContent>
        )}
      </Card>

      {/* Table */}
      <ScrollableTable maxHeight="max-h-[62vh]" className="rounded-lg border border-border">
        <Table className="border-collapse [&_th]:border-b [&_th]:border-border [&_td]:border-b [&_td]:border-border/70 [&_th:not(:last-child)]:border-r [&_td:not(:last-child)]:border-r [&_th]:border-r-border [&_td]:border-r-border/60">
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead
                ref={chevRef}
                style={freezeStick("chevron", { header: true }).style}
                className={`w-8 ${freezeStick("chevron", { header: true }).className}`}
              />
              <TableHead
                ref={labelRef}
                style={freezeStick("label", { header: true }).style}
                className={`text-xs font-semibold text-foreground/70 whitespace-nowrap cursor-pointer select-none ${freezeStick("label", { header: true }).className}`}
                onClick={() => toggleSort("label")}
              >
                <span className="inline-flex items-center gap-1">
                  {viewLabel}
                  {sortIcon("label")}
                  {freezePin()}
                </span>
              </TableHead>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="text-right text-[11px] font-semibold text-foreground/60 whitespace-nowrap cursor-pointer select-none"
                >
                  <span className="inline-flex items-center gap-1 justify-end w-full">
                    {col.label}{sortIcon(col.key)}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className="text-center py-12 text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : sortedRoots.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className="text-center py-12 text-muted-foreground">
                  {focus.size > 0 ? (
                    <>
                      No customer matches {[...focus].map((f) => OA_FOCUS_LABELS[f]).join(" + ")}.
                      <button
                        type="button"
                        onClick={() => setFocus(new Set())}
                        className="ml-1.5 text-primary hover:underline"
                      >
                        Clear the focus
                      </button>
                    </>
                  ) : (
                    `No customer has a bill more than ${cutoff} days overdue.`
                  )}
                </TableCell>
              </TableRow>
            ) : (
              <>
                <TableRow className="bg-muted/60 border-b-2 border-border/60 font-semibold">
                  <TableCell
                    style={freezeStick("chevron", { bg: "bg-muted" }).style}
                    className={freezeStick("chevron", { bg: "bg-muted" }).className}
                  />
                  <TableCell
                    style={freezeStick("label", { bg: "bg-muted" }).style}
                    className={`text-sm whitespace-nowrap uppercase tracking-wide text-foreground/80 ${freezeStick("label", { bg: "bg-muted" }).className}`}
                  >
                    Grand Total
                  </TableCell>
                  {metricCells(null, true)}
                </TableRow>
                {renderNodes(pagedRoots)}
              </>
            )}
          </TableBody>
        </Table>
      </ScrollableTable>

      {/* Pagination */}
      {sortedRoots.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => { setPageSize(v === "all" ? "all" : (Number(v) as PageSize)); setPage(1); }}
            >
              <SelectTrigger className="h-8 w-20 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <SelectItem key={String(s)} value={String(s)}>{s === "all" ? "All" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>
              {sortedRoots.length} {sortedRoots.length === 1 ? "row" : "rows"} · {focusedRows.length} customer{focusedRows.length === 1 ? "" : "s"} · {agedBillTotal} aged bill{agedBillTotal === 1 ? "" : "s"}
              {focus.size > 0 && <span className="opacity-70"> of {rows.length}</span>}
            </span>
          </div>
          {pageSize !== "all" && totalPages > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-disabled={safePage === 1}
                    className={safePage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {getPageWindow(safePage, totalPages).map((p, i) =>
                  p === "..." ? (
                    <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink isActive={p === safePage} onClick={() => setPage(p)} className="cursor-pointer">
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  ),
                )}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-disabled={safePage === totalPages}
                    className={safePage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}

      <InvoiceDrilldownDialog
        open={drill.open}
        onOpenChange={(o) => setDrill((d) => ({ ...d, open: o }))}
        title={drill.title}
        subtitle={drill.subtitle}
        rows={drill.rows}
        asOfDate={asOfDate}
      />
    </div>
  );
}

/**
 * Pinned twice — see the file header.
 *
 * The nested FYProvider re-bases the financial-year context to its own default (Both FYs) and never
 * changes it, so this report always reads the full book no matter what the topbar selector says.
 * UserLayout hides that selector on this route, so the two can never disagree on screen.
 */
export default function OverdueAgingReport() {
  return (
    <ReceivablesSourceProvider value="default">
      <FYProvider>
        <OverdueAgingInner />
      </FYProvider>
    </ReceivablesSourceProvider>
  );
}
