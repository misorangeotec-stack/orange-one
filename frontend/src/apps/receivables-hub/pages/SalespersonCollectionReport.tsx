import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, Fragment, type ReactNode, type CSSProperties } from "react";
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";
import { isAgainstInvoice } from "@hub/lib/allocation";
import {
  HandCoins, RefreshCw, AlertTriangle, ChevronRight, ChevronDown,
  ArrowUpDown, ArrowUp, ArrowDown, Wallet, CalendarClock, Coins,
  TrendingDown, Percent, Download, BarChart3, X, Search, Pin, Target, Plus, Minus,
} from "lucide-react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { CustomerCategoryMultiSelect, matchesCategory } from "@hub/components/CustomerCategoryMultiSelect";
import { SaleTypeMultiSelect } from "@hub/components/SaleTypeMultiSelect";
import { MultiSelect } from "@hub/components/MultiSelect";
import { GroupByBuilder, type GroupByPreset } from "@hub/components/GroupByBuilder";
import { InvoiceDrilldownDialog, type InvoiceDrillRow } from "@hub/components/InvoiceDrilldownDialog";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ColumnPicker, type ColumnOption } from "@hub/components/ColumnPicker";
import { useReportColumnPrefs, REPORT_PREF_IDS } from "@hub/lib/reportPrefs";
// Aliased: `Tooltip` in this file is already recharts', on the monthly chart.
import {
  Tooltip as HelpTooltip, TooltipTrigger as HelpTooltipTrigger, TooltipContent as HelpTooltipContent,
} from "@hub/components/ui/tooltip";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData, groupEntryOf, groupNameOf } from "@hub/lib/useAppData";
import { useReceivablesSource } from "@hub/lib/sourceContext";
import { useFY } from "@hub/lib/fyContext";
import { sumOutstanding } from "@hub/lib/receivables";
import { buildGroupTree, sortTree, type GroupNode } from "@hub/lib/groupTree";
import { creditsOfLedger } from "@hub/lib/agingReport";
import { loadOnAccountEntries, displayableEntries, type OnAccountEntry } from "@hub/lib/onAccountEntries";
import { ddmmyyyy, isoToMonthLabel, monthEndLong, monthLabelToEndDate } from "@hub/lib/months";
import { useFollowups } from "@hub/lib/useFollowups";
import { useCollectionPlan } from "@hub/lib/useCollectionPlan";
import { CollectionPlanModal } from "@hub/components/CollectionPlanModal";
import { FollowupModal } from "@hub/components/FollowupModal";
import { FollowupRowAction } from "@hub/components/FollowupRowAction";
import { NextFollowupCell } from "@hub/components/NextFollowupCell";
import { entityKey, type FollowupEntityType, type Followup } from "@hub/lib/followupTypes";
import { formatDateDMY } from "@hub/lib/utils";
import type { Customer, SaleType } from "@hub/lib/types";

/* ── Group-by dimensions (the Aging-style roll-up builder) ───────────────────── */
type CDim = "salesperson" | "customer" | "group" | "category" | "company" | "location";
const C_DIMENSIONS: { key: CDim; label: string }[] = [
  { key: "salesperson", label: "Salesperson" },
  { key: "customer",    label: "Customer" },
  { key: "group",       label: "Customer Group" },
  { key: "category",    label: "Customer Category" },
  { key: "company",     label: "Company" },
  { key: "location",    label: "Location" },
];
const C_PRESETS: GroupByPreset<CDim>[] = [
  { label: "Salesperson → Customer", dims: ["salesperson", "customer"] },
  { label: "Salesperson → Group",    dims: ["salesperson", "group"] },
  { label: "Salesperson",            dims: ["salesperson"] },
  { label: "Customer",               dims: ["customer"] },
  { label: "Customer Group",         dims: ["group"] },
  { label: "Customer Category",      dims: ["category"] },
  { label: "Company",                dims: ["company"] },
  { label: "Location",               dims: ["location"] },
];
/** Composite node metrics — current + previous month, so Collection % (prev) rolls up too. */
interface CM { m: Metrics; mPrev: Metrics; }
const KEY_SEP = "|||";
/** Width cap (px) for the roll-up label column.
 *  This column is FROZEN, so every pixel it takes is viewport permanently lost to the money
 *  columns. Left uncapped it grows to the longest ledger name plus its "Company · Location"
 *  sub-label and swallows half the screen. The cap lives on an INNER div, never on the <td>:
 *  max-width on a table cell is ignored under `table-layout: auto`. */
const LABEL_W = 230;
/** Per-ledger bucket key — the same identity `dimValue` uses for the customer/group dims. */
const ledgerKeyOf = (c: Customer): string =>
  `${c.name}${KEY_SEP}${c.company}${KEY_SEP}${c.location}`;

/* ── Helpers ───────────────────────────────────────────────── */

const fmt = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000)   return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

function formatDateLong(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return ddmmyyyy(d);
}

// NOTE "gap" is the one key here that is NOT a field on Metrics (it is planned − received), so
// the sort comparator must branch on it BEFORE its `a.metrics.m[sortKey]` fallback.
type SortKey = "salesperson" | "sales" | "salesPrev" | "outstandingNow" | "outstandingDebit" | "outstandingCredit" | "due" | "planned" | "gap" | "receivedOnAccount" | "receivedAgainst" | "received" | "pendingGross" | "onAccount" | "pending" | "collectionPct" | "collectionPctPrev";
type SortDir = "asc" | "desc";

/* ── Columns ──────────────────────────────────────────────────────────────────
   Every column the picker offers. This is DELIBERATELY a superset of SortKey and must stay
   separate from it: the sort comparator ends in `a.metrics.m[sortKey]`, so a key that is not a
   field on Metrics cannot be a SortKey. Four columns here aren't sortable for exactly that reason
   (the two follow-up columns are text, and `pendingOverdue` is derived), and they simply omit the
   `sort` field on their definition. */
type ColKey =
  | Exclude<SortKey, "salesperson">
  | "nextFollowup" | "lastRemark" | "pendingOverdue" | "dueSoon";

/** The shape the report has always opened on. A saved layout replaces this; nothing else does. */
const DEFAULT_COLS: ColKey[] = [
  "sales", "salesPrev", "due", "planned", "gap",
  "received", "outstandingNow", "pending", "collectionPct", "collectionPctPrev",
];

/**
 * Every key the report defines, for validating a saved layout.
 *
 * Deliberately the FULL set and not "whatever is legal right now": useReportColumnPrefs drops
 * saved keys outside this list, so handing it the legal subset would quietly forget a user's
 * Planned column the first time they opened the report with a Sale Type filter on. Legality is
 * applied when rendering instead. Module-level so its identity is stable across renders.
 */
const ALL_COL_KEYS: ColKey[] = [
  "nextFollowup", "lastRemark", "sales", "salesPrev", "due", "planned", "gap",
  "receivedOnAccount", "receivedAgainst", "received",
  "outstandingDebit", "outstandingCredit", "outstandingNow",
  "pendingGross", "onAccount", "pendingOverdue", "dueSoon", "pending",
  "collectionPct", "collectionPctPrev",
];

/** A banner groups a total with its breakup. Sub-columns of one section must be ADJACENT here. */
type ColSection = "received" | "outstanding" | "pending";

interface SPCol {
  key: ColKey;
  /** Full name — the picker, a flat (un-bannered) header, and the export header all use this. */
  label: string;
  /** Header text when the column sits UNDER its section's banner ("Total", "Gross", …). */
  short?: string;
  /** One line on what the column means. Shown in the picker and on hover over the header. */
  help: string;
  section?: ColSection;
  /** A breakup OF the section's total rather than the total itself. */
  sub?: boolean;
  /** Omitted ⇒ the header is not clickable. */
  sort?: SortKey;
  width?: string;
  wrap?: boolean;
  /** false ⇒ greyed out in the picker (with `why`), and absent from the table and the export. */
  legal: boolean;
  /** Why it is unavailable. Replaces `help` in the picker while illegal. */
  why?: string;
  /** The body cell. `strong` bolds the figure (Grand Total + depth-0 rows). */
  cell: (c: CellCtx) => ReactNode;
  /** The Excel value. Omitted on "text" columns, whose value comes from the follow-up log. */
  xlsx?: (m: Metrics, mPrev: Metrics) => number | string;
  /** Which block of the sheet the column belongs to — the ₹ and % number formats are applied by
   *  contiguous range, so text / money / percent must stay grouped in that order. */
  xlsxKind: "money" | "pct" | "text";
}

/** Everything a column's body cell can need, so `cell` stays a one-liner. */
interface CellCtx {
  m: Metrics;
  mPrev: Metrics;
  /** Ledger ids behind the row — the invoice drill-down needs them. */
  ids: string[];
  label: string;
  strong: boolean;
  /** Customer name when the row IS exactly one customer (plans are editable only there). */
  planName: string | null;
  /** The chaseable entity, or null on a roll-up / the Grand Total. */
  entity: { type: FollowupEntityType; name: string } | null;
  latest: Followup | undefined;
  /** Left rule marking the first visible column of a section. */
  edge: string;
}

/** All sale-type keys (mirrors SaleTypeMultiSelect); used for residual projection. */
const ALL_SALE_TYPES: SaleType[] = ["ink", "paper", "spare_parts", "machine", "head", "other"];
const SALE_TYPE_LABELS: Record<string, string> = {
  ink: "Ink", paper: "Paper", spare_parts: "Spare Parts", machine: "Machine", head: "Head",
  other: "Other",
};

interface Metrics {
  /** Sales raised this month (rupees), INCLUSIVE of GST — the full invoice value owed.
   *  Sale-type-filterable via trend.salesByType. */
  sales: number;
  /** GST contained in `sales` (rupees), so the taxable base is `sales - salesGst`.
   *  Stays 0 when the source doesn't carry the split (the pipeline) — `gstKnown` on the
   *  aggregate is what decides whether to render it, never the value itself. */
  salesGst: number;
  outstanding: number;
  /** Portion of `outstanding` from parties with a net DEBIT balance (they owe → positive). */
  outstandingDebit: number;
  /** Portion of `outstanding` from parties in net CREDIT / advance, as a positive magnitude.
   *  outstanding = outstandingDebit − outstandingCredit (exact per-party partition). */
  outstandingCredit: number;
  due: number;
  /** Total collected in the month = receivedOnAccount + receivedAgainst (kept whole; the
   *  split is a best-effort apportioning of this total — see receivedSplitByCustomerMonth). */
  received: number;
  /** Portion of `received` that landed ON ACCOUNT (advance / unallocated). */
  receivedOnAccount: number;
  /** Portion of `received` applied AGAINST a specific invoice. */
  receivedAgainst: number;
  /** Portion of `received` that is manual Other Payments (money paid OUTSIDE Tally).
   *  A DIFFERENT axis from the OnAccount/Against split above — that one is about how a payment was
   *  allocated, this is about where it came from, and these rupees already sit inside both. Shown
   *  as a footnote, deliberately not as a fourth column, so the two axes are never added together. */
  receivedOther: number;
  /** Due Pending NET of on-account (what the column shows). */
  pending: number;
  /** Due Pending BEFORE on-account is deducted — the sum of the bills themselves.
   *  Kept because the drill-down's invoice list totals to this, and because a customer must
   *  never drop off the report just because their whole due is covered by untagged money. */
  pendingGross: number;
  /** Money already received from this customer but tagged to NO invoice, applied against the
   *  due (so 0 ≤ onAccount ≤ pendingGross, and pending = pendingGross − onAccount).
   *  Live source + current month + no sale-type filter only; 0 everywhere else. */
  onAccount: number;
  /** Not-yet-overdue slice of `pending`, i.e. bills coming due before month-end — NET of any
   *  on-account that spilled past the overdue slice, so `pending − dueSoon` can never go < 0. */
  dueSoon: number;
  /** Planned collection for this month (rupees) — what the team INTENDS to collect, entered by
   *  hand, as against `due` (what is owed) and `received` (what arrived).
   *
   *  An ordinary additive metric, which is the whole point: it folds through `addInto` and so
   *  reaches every roll-up node, the grand total, the month-wise panel and the export with no
   *  special-casing anywhere. That only holds because a plan is resolved onto exactly ONE ledger
   *  per customer name before it gets here — see `planCarrier`. */
  planned: number;
}
/** Normalize a salesperson name: trim + UPPERCASE; blank / "Others" → "OTHERS"
 *  (merges the pipeline's blank-default "Others" with explicit "OTHERS"). */
const spName = (s: string | undefined): string => {
  const t = (s ?? "").trim();
  return t ? t.toUpperCase() : "OTHERS";
};

const emptyMetrics = (): Metrics => ({
  sales: 0, salesGst: 0, outstanding: 0, outstandingDebit: 0, outstandingCredit: 0, due: 0, received: 0, receivedOnAccount: 0, receivedAgainst: 0, receivedOther: 0, pending: 0, pendingGross: 0, onAccount: 0, dueSoon: 0, planned: 0,
});
const addInto = (t: Metrics, m: Metrics): void => {
  t.sales             += m.sales;
  t.salesGst          += m.salesGst;
  t.outstanding       += m.outstanding;
  t.outstandingDebit  += m.outstandingDebit;
  t.outstandingCredit += m.outstandingCredit;
  t.due               += m.due;
  t.received          += m.received;
  t.receivedOnAccount += m.receivedOnAccount;
  t.receivedAgainst   += m.receivedAgainst;
  t.receivedOther     += m.receivedOther;
  t.pending           += m.pending;
  t.pendingGross      += m.pendingGross;
  t.onAccount         += m.onAccount;
  t.dueSoon           += m.dueSoon;
  t.planned           += m.planned;
};
const collectionPct = (m: Metrics): number | null => (m.due > 0 ? (m.received / m.due) * 100 : null);
/** Still to collect against the plan. Negative = collected beyond plan. */
const planGap = (m: Metrics): number => m.planned - m.received;

/** Start-of-month receivable pool = month-end (net) balance + that month's receipts (money
 *  already collected this month added back). Used by the invoice drill-down and the month-wise
 *  analysis panel (the main table no longer shows a Total Outstanding column). */
const startMonthOutstanding = (m: Metrics): number => m.outstanding + m.received;

const pctStyle = (pct: number | null): string => {
  if (pct === null) return "";
  if (pct >= 90) return "text-emerald-600 font-semibold";
  if (pct >= 60) return "text-warning font-semibold";
  return "text-destructive font-semibold";
};

/**
 * Which follow-up / planning entity (if any) a roll-up node represents.
 *
 * Rows here are roll-up NODES at any depth, not customers — so unlike the Risk Register this
 * has to be derived. Only a customer or a customer group is something you can chase or plan
 * against; a Salesperson / Company / Location / Category subtotal is not.
 *
 * The `group` dimension FALLS BACK to a per-ledger bucket for a customer that isn't in the
 * group muster (see `dimValue`), so the bucket VALUE — not the dimension — is what decides
 * customer vs group. Reading the dim alone would file every unmapped customer as a group and
 * silently fork its log.
 */
function entityOfNode(n: GroupNode<CM>): { type: FollowupEntityType; name: string } | null {
  const last = n.path[n.path.length - 1];
  if (!last) return null;
  if (last.dim === "customer") return { type: "customer", name: n.label };
  if (last.dim === "group") {
    return last.value.startsWith("G:")
      ? { type: "group", name: n.label }
      : { type: "customer", name: n.label };
  }
  return null;
}

/* ── Component ─────────────────────────────────────────────── */

export default function SalespersonCollectionReport() {
  const { label: fyLabel } = useFY();
  const { loading, error, allCustomers, customerDetail, dashboard, customerGroupMap } = useAppData();
  const isLive = useReceivablesSource() === "connectwave";
  // The payment-chase log, shared with the Risk Register / Follow-ups page (same query key, so
  // this is not a second fetch). MUST stay above the loading/error early returns below — React
  // counts hooks per render, and a hook placed after them makes the first post-load render carry
  // one hook more than the loading render. See the note on `creditLedgers`.
  const { latestByEntity } = useFollowups();

  const asOfDate = dashboard?.asOfDate ?? new Date().toISOString().slice(0, 10);
  const months = useMemo(() => (dashboard?.trend ?? []).map((t) => t.month), [dashboard]);
  const asOfMonth = months.length ? months[months.length - 1] : "";
  // The monthly payment plan. Fetched for the WHOLE FY in one query, so the month dropdown and
  // the month-wise panel below both read from the same cache instead of refetching per month.
  // Same hook-ordering rule as useFollowups above.
  const plans = useCollectionPlan(months);

  // Filter / control state
  const [monthState, setMonthState] = useState<string>("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [salesPersons, setSalesPersons] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  // Customer Segment — mirrors the Risk Register / Dashboard filter. "Active" = had any
  // activity (sales / receipts / credit notes / other payments) in the FY; defaults to Active.
  const [customerSegment, setCustomerSegment] = useState<"all" | "active" | "no_activity">("active");
  const [saleTypes, setSaleTypes] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch] = useState<string>("");
  // Aging-style group-by: an ordered list of dimensions rolled up with subtotals at
  // every level. Default mirrors the old Salesperson → Customer view.
  const [groupBy, setGroupBy] = useState<CDim[]>(["salesperson", "customer"]);
  // Which columns are on. ONE control now owns every column, including the Received / Outstanding
  // / Due Pending breakups and the two follow-up columns — all of which used to hide behind
  // unlabelled +/− buttons in the table header. DEFAULT_COLS is deliberately the shape the report
  // has always opened on, so nobody's table changes underneath them.
  const [visibleCols, setVisibleCols] = useState<ColKey[]>(DEFAULT_COLS);
  // Groups folded shut on the table, by their +/− heading button. A passing reading aid layered
  // OVER the picks above — never a substitute for them — so it starts empty and is not saved: a
  // reopened report shows every column you chose, which is the only honest reading of a saved
  // layout. See `cols`.
  const [folded, setFolded] = useState<Set<ColSection>>(new Set());
  // This user's own saved layout, read from profiles.receivables_report_prefs — so it follows them
  // to any browser rather than living in one machine's localStorage. Fails soft: while it loads,
  // and forever if the column isn't there, the report simply uses DEFAULT_COLS.
  const colPrefs = useReportColumnPrefs(REPORT_PREF_IDS.salespersonCollection, ALL_COL_KEYS);
  // ONE-SHOT. Without the ref, every hand-toggle would be overwritten by the saved set on the
  // next render and the picker would be unusable.
  const appliedPref = useRef(false);
  useEffect(() => {
    if (colPrefs.loading || appliedPref.current) return;
    appliedPref.current = true;
    if (colPrefs.saved) setVisibleCols(colPrefs.saved as ColKey[]);
  }, [colPrefs.loading, colPrefs.saved]);
  const [followupTarget, setFollowupTarget] = useState<{ type: FollowupEntityType; name: string } | null>(null);
  // Customer whose plan is being edited (customer level only — a plan must roll up unambiguously).
  const [planTarget, setPlanTarget] = useState<string | null>(null);
  // Frozen "pane" — Excel-style freeze of the leading group-label column so the group
  // name stays visible while scrolling right. 0 = none, 1 = frozen (default).
  const [freezeLevel, setFreezeLevel] = useState<0 | 1>(1);
  // Measured widths of the leading (chevron + label) columns for the sticky left offset.
  const chevRef = useRef<HTMLTableCellElement>(null);
  const spHeadRef = useRef<HTMLTableCellElement>(null);
  const [colW, setColW] = useState({ chev: 32, label: 200 });
  // Expanded roll-up nodes, keyed by node.key (any depth).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Invoice drill-down popup (current month only).
  const [drill, setDrill] = useState<{ title: string; subtitle: string; rows: InvoiceDrillRow[]; ledgerFigures: Record<string, number> } | null>(null);
  // Bumped per drill open, so a slow on-account entry lookup from a previous popup can never
  // land on the one the user is actually looking at.
  const drillSeqRef = useRef(0);
  // "Less advances & credits" popup — a LEDGER-level list, not a bill-level one, so it does not
  // reuse InvoiceDrilldownDialog. Groups start COLLAPSED: the point of the popup is which Tally
  // groups the credits sit in, and 80+ ledger rows bury that.
  const [creditDrill, setCreditDrill] = useState(false);
  const [creditOpenGroups, setCreditOpenGroups] = useState<Set<string>>(new Set());
  // `rawSortKey` is what the user last clicked; the EFFECTIVE sort key is derived below, once the
  // column list is known, so a column the picker has since hidden can't go on ordering the table.
  const [rawSortKey, setSortKey] = useState<SortKey>("pending");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Month-wise panel: null = consolidated (all filtered rows), else a clicked top-level node.
  const [selectedNode, setSelectedNode] = useState<{ label: string; ids: string[] } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Default month → as-of month; reset when the FY (and thus month set) changes.
  useEffect(() => {
    if (months.length && !months.includes(monthState)) setMonthState(asOfMonth);
  }, [months, asOfMonth, monthState]);

  const selectedMonth = months.includes(monthState) ? monthState : asOfMonth;
  const isCurrentMonth = selectedMonth === asOfMonth;


  // Calendar-previous month (months is FY-ordered); null when selected month is the FY's first.
  const prevMonth = useMemo(() => {
    const i = months.indexOf(selectedMonth);
    return i > 0 ? months[i - 1] : null;
  }, [months, selectedMonth]);

  // Dropdown options
  const companyOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => c.company).filter(Boolean))].sort(),
    [allCustomers],
  );
  const locationOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => c.location).filter(Boolean))].sort(),
    [allCustomers],
  );
  const salesPersonOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => spName(c.salesPerson)))].sort(),
    [allCustomers],
  );

  // ── Sale-type filter ─────────────────────────────────────────────────────────
  // Received (Tally receipts) is now tagged per month by the sale type of the bill
  // each receipt settled (trend.receiptsByType), so it filters EXACTLY — no estimate.
  // Outstanding also carries a per-type breakdown. The remainder that still has no
  // per-type source (manual other-payments, past-month overdue) is estimated by the
  // customer's sales mix via projectAmt(). All 5 types selected = no filter.
  const saleTypeActive = saleTypes.length > 0 && saleTypes.length < ALL_SALE_TYPES.length;
  const saleTypeSet = useMemo(() => new Set(saleTypes), [saleTypes]);

  /** Whether Due / Due Pending are shown NET of on-account (money received but tagged to no
   *  invoice). See the derivation in metricsForMonth for why each gate is load-bearing:
   *  the legacy pipeline already nets it upstream, and a sale-type filter puts the two sides
   *  of the subtraction on different bases. The current-month gate lives in metricsForMonth,
   *  since only that branch has a bill list. */
  const netOnAccount = isLive && !saleTypeActive;

  /* ── Which columns are even AVAILABLE right now ──────────────────────────────
     Two pairs of columns are meaningless in some contexts, and were dropped outright before the
     picker existed. They are still dropped from the table and the file — but the picker now lists
     them greyed out with the reason, because a column that simply vanishes reads as a bug.
     Computed up here, ahead of the column list itself, because the sort guard needs them. */
  /** A plan is a WHOLE-CUSTOMER commitment with no sale-type dimension, while `received` IS
   *  filtered — so "Gap to plan" under a Sale Type filter would compare a full-customer plan
   *  against (say) ink-only receipts and read as a shortfall that doesn't exist. Rather than show
   *  one of the pair, drop both: a plan figure with no comparable actual beside it invites exactly
   *  that bad subtraction. */
  const showPlanCols = !saleTypeActive;
  /** The Gross / On Account bridge sub-columns only carry meaning where the netting is actually
   *  applied — on the legacy feed, a past month or under a sale-type filter Gross == Total and
   *  On Account is always 0, so showing them would be two columns of noise. */
  const showOnAccountCols = netOnAccount && isCurrentMonth;
  const legalKey = (k: ColKey): boolean =>
    (k === "planned" || k === "gap") ? showPlanCols
    : (k === "pendingGross" || k === "onAccount") ? showOnAccountCols
    : true;

  /** Fraction of a customer's activity belonging to the selected sale types
   *  (by full-year sales mix). Customers with no sales mix put their whole
   *  residual into "other". Returns 1 when no sale-type filter is active. */
  const shareFor = useCallback((c: Customer): number => {
    if (!saleTypeActive) return 1;
    const salesTotal = ALL_SALE_TYPES.reduce((s, t) => s + (c.salesByType?.[t] ?? 0), 0);
    if (salesTotal > 1e-9) {
      return saleTypes.reduce((s, t) => s + (c.salesByType?.[t as SaleType] ?? 0), 0) / salesTotal;
    }
    return saleTypeSet.has("other") ? 1 : 0;
  }, [saleTypeActive, saleTypes, saleTypeSet]);

  /** Project an amount onto the selected sale types: exact part for types that carry
   *  a breakdown + the untyped residual apportioned by `share`. With no per-type
   *  breakdown (byType omitted) this is simply total × share. */
  const projectAmt = useCallback(
    (total: number, byType: Partial<Record<SaleType, number>> | undefined, share: number): number => {
      if (!saleTypeActive) return total;
      const typedSum = saleTypes.reduce((s, t) => s + (byType?.[t as SaleType] ?? 0), 0);
      const breakdownSum = ALL_SALE_TYPES.reduce((s, t) => s + (byType?.[t] ?? 0), 0);
      return typedSum + (total - breakdownSum) * share;
    },
    [saleTypeActive, saleTypes],
  );

  // Filtered raw customers (grouping is salesperson-level, so we work from raw rows)
  const filteredCustomers = useMemo(() => {
    let d = allCustomers;
    if (companies.length > 0) {
      const set = new Set(companies);
      d = d.filter((c) => set.has(c.company));
    }
    if (locations.length > 0) {
      const set = new Set(locations);
      d = d.filter((c) => set.has(c.location));
    }
    if (salesPersons.length > 0) {
      const set = new Set(salesPersons);
      d = d.filter((c) => set.has(spName(c.salesPerson)));
    }
    if (categories.length) d = d.filter((c) => matchesCategory(c, categories));
    // Customer Segment — judged on the customer's COMBINED (consolidate-by-name) activity,
    // exactly like the Dashboard (useAppData groups ledgers by name BEFORE the segment filter:
    // "segment must be judged on their combined totals, not individual rows"). Judging per raw
    // ledger here would drop an inactive ledger (e.g. an opening-balance-only ledger in another
    // company) of a customer who is active elsewhere, making this report's Outstanding fall
    // short of the Dashboard's. We aggregate over the company/location/person/category-filtered
    // set `d` (the same input the Dashboard consolidates) so the two reconcile under any filter.
    if (customerSegment !== "all") {
      const act = new Map<string, { sales: number; receipts: number; creditNotes: number; otherPayments: number }>();
      for (const c of d) {
        let a = act.get(c.name);
        if (!a) { a = { sales: 0, receipts: 0, creditNotes: 0, otherPayments: 0 }; act.set(c.name, a); }
        a.sales += c.sales; a.receipts += c.receipts; a.creditNotes += c.creditNotes; a.otherPayments += c.otherPayments ?? 0;
      }
      const activeNames = new Set<string>();
      for (const [name, a] of act) {
        if (a.sales > 0 || a.receipts > 0 || a.creditNotes > 0 || a.otherPayments > 0) activeNames.add(name);
      }
      d = d.filter((c) => (customerSegment === "active" ? activeNames.has(c.name) : !activeNames.has(c.name)));
    }
    if (saleTypeActive) {
      d = d.filter((c) => {
        const hasInType = saleTypes.some(
          (t) => (c.salesByType?.[t as SaleType] ?? 0) > 0 || (c.outstandingByType?.[t as SaleType] ?? 0) > 0,
        );
        if (hasInType) return true;
        // No sales mix → residual lands in "other"; keep only when "other" is selected.
        const salesTotal = ALL_SALE_TYPES.reduce((s, t) => s + (c.salesByType?.[t] ?? 0), 0);
        return salesTotal <= 1e-9 && saleTypeSet.has("other");
      });
    }
    const q = customerSearch.trim().toLowerCase();
    if (q) d = d.filter((c) => c.name.toLowerCase().includes(q));
    return d;
  }, [allCustomers, companies, locations, salesPersons, categories, customerSegment, saleTypeActive, saleTypes, saleTypeSet, customerSearch]);

  // Customer-ledger lookup for the invoice drill-down (company/location/name per id).
  const customerById = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const c of filteredCustomers) m.set(c.id, c);
    return m;
  }, [filteredCustomers]);

  // Per-customer → per-month total of manual "other payments" (non-Tally), derived from
  // the transactions (which carry dates). Folded into "Received" so collection % reflects
  // them. They already reduced openDue (via outstanding), so Pending = Due − Received stays
  // consistent (Due = openDue + received).
  const otherPaymentsByCustomerMonth = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const c of allCustomers) {
      const txns = customerDetail[c.id]?.otherPaymentTransactions ?? [];
      if (!txns.length) continue;
      const byMonth = new Map<string, number>();
      for (const t of txns) {
        if (!t.date) continue;
        const lbl = isoToMonthLabel(t.date);
        if (lbl) byMonth.set(lbl, (byMonth.get(lbl) ?? 0) + t.amount);
      }
      if (byMonth.size) m.set(c.id, byMonth);
    }
    return m;
  }, [allCustomers, customerDetail]);

  // Per-customer → per-month RUNNING TOTAL of other payments: everything paid ON OR BEFORE that
  // month's end. Distinct from the map above (which is "paid IN that month", a collections figure);
  // this one is a balance figure, because what a customer owed at 30-Jun is reduced by every payment
  // they had made by then — not just June's.
  //
  // Why it exists: Tally's month-end history has never seen these payments, so every past month reads
  // HIGH by the running total. The current month escapes it (metricsForMonth reads live figures), and
  // that gap is exactly what made a corrected July sit next to an uncorrected June. As of 2026-07-17
  // all 56 payments are dated ≤ 01-Apr-2026, so every month of FY 26-27 nets the same ₹5,76,27,920 the
  // current month does — but this is DATE-DRIVEN, not a fixed figure, so August and everything after
  // it work themselves out with no maintenance.
  //
  // Live only: the pipeline's history is gross too, but netting it is out of scope here.
  const otherPaymentsCumByCustomerMonth = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    if (!isLive || !months.length) return out;
    const ends = months.map((m) => ({ m, end: monthLabelToEndDate(m).getTime() }));
    for (const c of allCustomers) {
      const txns = customerDetail[c.id]?.otherPaymentTransactions ?? [];
      if (!txns.length) continue;
      const byMonth = new Map<string, number>();
      for (const { m, end } of ends) {
        let cum = 0;
        for (const t of txns) {
          // A blank/unparseable date can't be placed in a month. Count it into EVERY month rather
          // than none: it has already come off the live outstanding, so dropping it here would leave
          // past months on a different basis and silently re-open the very June-vs-July gap this map
          // closes. There are none today, but the date column is nullable.
          const d = t.date ? new Date(t.date).getTime() : NaN;
          if (Number.isNaN(d) || d <= end) cum += Math.abs(t.amount);
        }
        if (cum > 0) byMonth.set(m, cum);
      }
      if (byMonth.size) out.set(c.id, byMonth);
    }
    return out;
  }, [isLive, months, allCustomers, customerDetail]);

  // Per-customer → per-month split of "Received" into ON ACCOUNT (advance / unallocated)
  // vs AGAINST a specific invoice, built from the receipt + manual other-payment
  // transactions (both carry an allocation type + ref invoice). Money-out rows
  // ("check_return" and "payment_out") are excluded — they sit on the Due side, not Received.
  // Used only to derive the on-account SHARE of each month's receipts; the displayed total
  // stays anchored to trend.receipts (+ other payments) so the two columns sum exactly to it.
  // Receipt evidence and other-payment evidence are kept in SEPARATE maps, and each is only
  // ever used to split its OWN component of `received`. Pooling them was a real bug: the Live
  // source carries no bulk receiptTransactions, so a customer with one manual other-payment had
  // the ratio derived from that payment ALONE and then applied to the whole `received` figure —
  // ₹1cr of against-invoice Tally receipts plus a ₹1L on-account other payment rendered the
  // entire ₹1.01cr as On Account. Evidence must never speak for money it didn't observe.
  const receivedSplitByCustomerMonth = useMemo(() => {
    const receipts = new Map<string, Map<string, { onAccount: number; against: number }>>();
    const other = new Map<string, Map<string, { onAccount: number; against: number }>>();
    const add = (
      m: Map<string, Map<string, { onAccount: number; against: number }>>,
      cid: string, lbl: string, amt: number, against: boolean,
    ) => {
      if (!lbl || amt <= 0) return;
      let byMonth = m.get(cid);
      if (!byMonth) { byMonth = new Map(); m.set(cid, byMonth); }
      const cur = byMonth.get(lbl) ?? { onAccount: 0, against: 0 };
      if (against) cur.against += amt; else cur.onAccount += amt;
      byMonth.set(lbl, cur);
    };
    for (const c of allCustomers) {
      const det = customerDetail[c.id];
      if (!det) continue;
      for (const r of det.receiptTransactions ?? []) {
        // "payment_out" (a refund / unnamed bounce) rides in the same list and is money going OUT —
        // it belongs on the Due side exactly like "check_return", never in the Received split.
        const rt = (r.type ?? "").toLowerCase();
        if (rt === "check_return" || rt === "payment_out") continue;
        if (!r.date) continue;
        add(receipts, c.id, isoToMonthLabel(r.date), Math.abs(r.amount), isAgainstInvoice(r.type, r.refInvoice));
      }
      for (const o of det.otherPaymentTransactions ?? []) {
        if (!o.date) continue;
        add(other, c.id, isoToMonthLabel(o.date), Math.abs(o.amount), isAgainstInvoice(o.type, o.refInvoice));
      }
    }
    return { receipts, other };
  }, [allCustomers, customerDetail]);

  /* ── Payment plan ────────────────────────────────────────────────────────────
     ONE PLAN, ONE LEDGER.

     A plan is recorded against the consolidated customer NAME, but this report buckets per
     LEDGER (name|||company|||location — see dimValue) and `metricsForMonth` runs once per
     ledger. Folding the plan in per-ledger would count a name with three ledgers three times
     and treble every subtotal above it. So each plan is resolved onto exactly ONE ledger — the
     "carrier" — before it ever enters the metrics. `planned` then stays an ordinary additive
     metric and every node, the grand total and the export remain true subtotals.

     Carrier = the ledger of that name carrying the largest GROSS due (the one you would
     actually chase), ties broken by the ledger key so the choice is deterministic and
     reproducible from the same data.

     Chosen from `filteredCustomers`, NOT `activeRows`: activeRows is derived from the metrics
     this map feeds (metricsForMonth → customerMetrics → activeRows), so reading it here would
     be circular. For the same reason the tie-break reads `overdueGross ?? overdue` off the raw
     Customer rather than anything computed.

     REJECTED ALTERNATIVE: splitting the plan pro-rata across a name's ledgers by gross due.
     Also additive and exact, and it degrades more gracefully under a Company filter — but the
     user entered ONE number for ONE customer, and a pro-rata split fabricates a per-company
     allocation they never stated, which then reads as fact under a Company group-by. It is a
     one-function swap inside plannedByLedgerMonth if that trade is ever re-decided. */
  const planCarrier = useMemo(() => {
    const byName = new Map<string, Customer>();
    const beats = (a: Customer | undefined, b: Customer): boolean => {
      if (!a) return true;
      const da = a.overdueGross ?? a.overdue ?? 0;
      const db = b.overdueGross ?? b.overdue ?? 0;
      return db !== da ? db > da : ledgerKeyOf(b) < ledgerKeyOf(a);
    };
    for (const c of filteredCustomers) {
      if (beats(byName.get(c.name), c)) byName.set(c.name, c);
    }
    return byName;
  }, [filteredCustomers]);

  /** month → ledgerId → planned rupees. Only carrier ledgers appear.
   *
   *  Depends on `plans.plannedFor`, NOT on `plans`: the hook returns a fresh object literal every
   *  render, so depending on it would recompute this map — and through it metricsForMonth,
   *  customerMetrics, activeRows and the whole tree — on every keystroke in the search box.
   *  `plannedFor` is a useCallback over the indexed rows, so it only changes when the data does. */
  const plannedFor = plans.plannedFor;
  const plannedByLedgerMonth = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    for (const month of months) {
      const per = new Map<string, number>();
      for (const [name, carrier] of planCarrier) {
        const amt = plannedFor(month, "customer", name);
        if (amt) per.set(carrier.id, amt);
      }
      if (per.size) out.set(month, per);
    }
    return out;
  }, [months, plannedFor, planCarrier]);

  // Per-customer metrics for ONE month. Shared by the main table (selected month) and the
  // month-wise panel (every month) so the two always reconcile for the same month.
  //  - Received = PURE receipt vouchers (LAKHS → rupees) PLUS manual "other payments" for the
  //    month (non-Tally, derived from transactions). Cheque returns / credit notes / debit
  //    notes are NOT netted here — the pipeline folds them into outstanding → invoice pending
  //    → trend.overdue, i.e. the Due/Overdue side. (Works in local-JSON & Supabase.)
  //  - openDue = bills due by month-end still OPEN (net of all receipts to date) = the true
  //    "still to collect". Current/as-of month uses live invoice pending + remaining opening
  //    balance; past months use the stored month-end snapshot (trend.overdue).
  //  - Outstanding/openDue for a PAST month are net of every other payment made by that month-end
  //    (Live only). The stored month-end snapshot is Tally's, which has never seen those payments,
  //    so without this a past month reads HIGH while the current month reads correct — see
  //    otherPaymentsCumByCustomerMonth.
  //  - Due is shown GROSS of the month's collections (openDue + receipts) so that
  //    Pending = Due − Received = openDue (no double-count of this month's receipts).
  const metricsForMonth = useCallback((c: Customer, month: string): Metrics => {
    const detail = customerDetail[c.id];
    const mt = detail?.trend.find((t) => t.month === month);
    const share = shareFor(c);
    const opForMonth = otherPaymentsByCustomerMonth.get(c.id)?.get(month) ?? 0;
    // Tally receipts are now tagged by the sale type of the bill each one settled,
    // so under a sale-type filter we read the REAL per-type monthly receipts
    // (trend.receiptsByType, lakhs) instead of estimating by sales mix. Manual
    // "other payments" carry no bill, so they keep the sales-mix estimate.
    const tallyReceipts = !saleTypeActive
      ? (mt?.receipts ?? 0) * 100_000
      : mt?.receiptsByType
        ? saleTypes.reduce((s, t) => s + (mt.receiptsByType?.[t as SaleType] ?? 0), 0) * 100_000
        : projectAmt((mt?.receipts ?? 0) * 100_000, undefined, share); // fallback: pre-tagging snapshot
    const opReceipts = projectAmt(opForMonth, undefined, share);
    const received = tallyReceipts + opReceipts;
    // Sales this month, sale-type-filterable the SAME way as receipts: read the real
    // per-type monthly sales (trend.salesByType, lakhs) under a sale-type filter;
    // pre-tagging snapshots fall back to the sales-mix estimate.
    const sales = !saleTypeActive
      ? (mt?.sales ?? 0) * 100_000
      : mt?.salesByType
        ? saleTypes.reduce((s, t) => s + (mt.salesByType?.[t as SaleType] ?? 0), 0) * 100_000
        : projectAmt((mt?.sales ?? 0) * 100_000, undefined, share); // fallback: pre-tagging snapshot
    // GST inside those sales (they are booked inclusive of it), so the report can show the base.
    // Same three-way shape as `sales` above: exact per-type under a filter, else the month total,
    // else apportion by sales mix. 0 when the source carries no GST at all (the pipeline) — the
    // KPI decides via `gstKnown`, so a missing split never renders as "base == total".
    const salesGst = !saleTypeActive
      ? (mt?.salesGst ?? 0) * 100_000
      : mt?.salesGstByType
        ? saleTypes.reduce((s, t) => s + (mt.salesGstByType?.[t as SaleType] ?? 0), 0) * 100_000
        : projectAmt((mt?.salesGst ?? 0) * 100_000, undefined, share);
    let outstanding: number;
    let openDue: number;
    let pendingGross: number;
    let onAccount = 0;
    let dueSoon = 0; // not-yet-overdue bills coming due by month-end (current month only)
    if (month === asOfMonth) {
      // Outstanding/overdue carry a per-type breakdown at the customer level → project exactly.
      outstanding = projectAmt(c.outstanding, c.outstandingByType, share); // as on asOfDate (NET)
      // openDue = the pipeline's CANONICAL overdue (c.overdue — reconciles to the dashboard,
      // already capped ≤ outstanding & advance-aware) PLUS bills genuinely coming due before
      // month-end (not overdue yet). We deliberately do NOT use a raw dueDate ≤ monthEnd sum:
      // that double-counts advance-suppressed Machine/Head bills (overdueDays=0 with a past
      // nominal due date) and would diverge from the dashboard's Overdue figure.
      const monthEnd = monthLabelToEndDate(month);
      const asOf = new Date(asOfDate);
      for (const inv of detail?.invoices ?? []) {
        // dueSoon is exact: skip bills whose voucher type isn't in the selected sale types.
        if (saleTypeActive && !saleTypeSet.has(inv.voucherType)) continue;
        if (inv.pending > 0 && (inv.overdueDays ?? 0) <= 0) {
          const dd = new Date(inv.dueDate);
          if (dd > asOf && dd <= monthEnd) dueSoon += inv.pending;
        }
      }
      // ⚠ GROSS, not `c.overdue` — that is now NET (the database caps On Account per ledger since
      // 30-07-2026). This page is the one place that must start from gross, because its cap is
      // LARGER than the DB's: it allows on-account money to settle bills coming due later this
      // month as well as bills already past due (see `pendingGross` below). Feeding it the netted
      // figure would deduct the same money twice and understate Due Pending.
      const grossOverdue = projectAmt(c.overdueGross ?? c.overdue, c.overdueByType, share);
      pendingGross = grossOverdue + dueSoon;
      // ON ACCOUNT — money this customer has already paid us that is settling no open invoice:
      // untagged receipts PLUS credit sitting on a named bill (machine advances, credit notes).
      // Both reduced their LEDGER balance but left the old bills reading unpaid, so the bill-based
      // figure above chases money already banked. Take it off (capped at the due, so a customer's
      // surplus credit can never push their OWN due below zero).
      //   Live only: the legacy pipeline already nets this upstream — deducting again would
      //   understate what is owed. Current month only: past months carry monthly totals with no
      //   bill list to net against. Never under a sale-type filter: c.outstanding has no per-type
      //   split, so the two sides of the subtraction would be on different bases.
      onAccount = netOnAccount ? Math.min(creditsOfLedger(c, detail).total, pendingGross) : 0;
      // Take it off the already-overdue slice FIRST, spilling into the not-yet-due slice only once
      // that is exhausted — otherwise the "As on today" sub-column (pending − dueSoon) prints
      // a negative whenever the credit exceeds what is actually past due.
      dueSoon = Math.max(0, dueSoon - Math.max(0, onAccount - grossOverdue));
      openDue = pendingGross - onAccount;
    } else {
      // Past months: outstanding carries a per-type breakdown in the trend (lakhs → rupees);
      // overdue does not, so it falls back to the sales-mix share.
      const obByType = mt?.outstandingByType
        ? (Object.fromEntries(
            ALL_SALE_TYPES.map((t) => [t, (mt.outstandingByType?.[t] ?? 0) * 100_000]),
          ) as Partial<Record<SaleType, number>>)
        : undefined;
      outstanding = projectAmt((mt?.outstanding ?? 0) * 100_000, obByType, share);
      openDue = projectAmt((mt?.overdue ?? 0) * 100_000, undefined, share);
      // Tally's month-end history never saw the manual Other Payments, so take off everything paid
      // by month-end. The as-of branch above needs none of this: it reads c.outstanding/c.overdue,
      // which liveOtherPayments already netted.
      const cumOp = otherPaymentsCumByCustomerMonth.get(c.id)?.get(month) ?? 0;
      if (cumOp > 0) {
        // Other payments carry no bill, so they carry no sale type → project them by the sales mix,
        // the same estimate opReceipts uses above. Subtract AFTER projecting `outstanding` rather
        // than from the gross figure: obByType (when a snapshot supplies one) describes Tally's
        // book, which does not contain these payments.
        outstanding -= projectAmt(cumOp, undefined, share);
        // Overdue drops by LESS than the full amount — money landing on a bill that wasn't due yet
        // reduces outstanding but was never part of overdue. A past month has no bill-wise history
        // to replay, so scale that month's payments by the overdue slice measured when they were
        // applied (liveOtherPayments). When every payment predates the month (cumOp === total —
        // true for every month of FY 26-27 today) this lands on the live figure EXACTLY, so June and
        // July compare on one basis. It softens to a proportional estimate only for a month some
        // payments hadn't been made in yet, i.e. viewing an earlier FY.
        const opTotal = c.otherPayments ?? 0;
        const overdueRatio = opTotal > 1e-9 ? (c.otherPaymentsOverdueAdj ?? 0) / opTotal : 0;
        openDue = Math.max(0, openDue - projectAmt(cumOp * overdueRatio, undefined, share));
      }
      // No bill list for a past month, so nothing to net on-account against: gross == net.
      pendingGross = openDue;
    }
    // Split `received` into on-account vs against-invoice by the month's raw allocation mix
    // (scale-invariant ratio, so the sale-type projection on `received` carries through).
    // Each component is apportioned by its OWN evidence — Tally receipts by the receipt
    // transactions, manual other-payments by theirs — so neither can misrepresent the other.
    // A component with no evidence at all contributes nothing to On Account, i.e. it falls to
    // against-invoice: the documented default for unclassified receipts, and the common case.
    // (Live has no bulk receipt transactions yet, so its Tally receipts take that default —
    // an honest fallback, not a fabricated ratio. A source-true split needs the bill link.)
    const onAccountOf = (
      ev: { onAccount: number; against: number } | undefined,
      amount: number,
    ): number => {
      const raw = (ev?.onAccount ?? 0) + (ev?.against ?? 0);
      return raw > 1e-9 ? amount * ((ev?.onAccount ?? 0) / raw) : 0;
    };
    const receivedOnAccount =
      onAccountOf(receivedSplitByCustomerMonth.receipts.get(c.id)?.get(month), tallyReceipts) +
      onAccountOf(receivedSplitByCustomerMonth.other.get(c.id)?.get(month), opReceipts);
    const receivedAgainst = received - receivedOnAccount;
    // Partition the net balance onto exactly one side (debit if owing, credit if in advance).
    // `outstanding` is sign-preserving in every branch, so these roll up the tree via addInto.
    const outstandingDebit = outstanding > 0 ? outstanding : 0;
    const outstandingCredit = outstanding < 0 ? -outstanding : 0;
    // NOT run through projectAmt: a plan is a whole-customer commitment with no sale-type
    // breakdown, and apportioning it by sales mix would invent a split nobody entered. The
    // columns are hidden under a sale-type filter instead (showPlanCols).
    const planned = plannedByLedgerMonth.get(month)?.get(c.id) ?? 0;
    return { sales, salesGst, outstanding, outstandingDebit, outstandingCredit, due: openDue + received, received, receivedOnAccount, receivedAgainst, receivedOther: opReceipts, pending: openDue, pendingGross, onAccount, dueSoon, planned };
  }, [customerDetail, asOfMonth, asOfDate, shareFor, projectAmt, netOnAccount, saleTypeActive, saleTypeSet, saleTypes, otherPaymentsByCustomerMonth, otherPaymentsCumByCustomerMonth, receivedSplitByCustomerMonth, plannedByLedgerMonth]);

  // Per-customer metrics for the selected month (feeds the main table + grand total).
  const customerMetrics = useMemo(() => {
    const map = new Map<string, Metrics>();
    for (const c of filteredCustomers) map.set(c.id, metricsForMonth(c, selectedMonth));
    return map;
  }, [filteredCustomers, selectedMonth, metricsForMonth]);

  // Per-customer metrics for the PREVIOUS month (feeds the side-by-side prev-month Collection %).
  const customerMetricsPrev = useMemo(() => {
    const map = new Map<string, Metrics>();
    if (prevMonth) for (const c of filteredCustomers) map.set(c.id, metricsForMonth(c, prevMonth));
    return map;
  }, [filteredCustomers, prevMonth, metricsForMonth]);

  // ── Group-by roll-up (Aging-style, N levels) ────────────────────────────────
  // Bucket value + display label (+ sub-label) for a customer ledger on a dimension.
  // "customer"/"group" keep per-ledger granularity (name + company + location) so the
  // same display name never clubs across companies/locations; mapped groups roll up.
  const dimValue = useCallback((c: Customer, dim: string): { value: string; label: string; sub?: string } => {
    const perLedger = `${c.name}${KEY_SEP}${c.company}${KEY_SEP}${c.location}`;
    const ledgerSub = [c.company, c.location].filter(Boolean).join(" · ") || undefined;
    switch (dim) {
      case "salesperson": { const v = spName(c.salesPerson); return { value: v, label: v }; }
      case "customer":    return { value: perLedger, label: c.name || "—", sub: ledgerSub };
      case "group": {
        const g = groupEntryOf(c, customerGroupMap);
        return g ? { value: `G:${g}`, label: g } : { value: perLedger, label: c.name || "—", sub: ledgerSub };
      }
      case "category": { const v = c.category?.trim() || "Uncategorized"; return { value: v, label: v }; }
      case "company":  { const v = c.company || "—"; return { value: v, label: v }; }
      case "location": { const v = c.location || "—"; return { value: v, label: v }; }
      default: return { value: "—", label: "—" };
    }
  }, [customerGroupMap]);

  // Hide only fully-empty ledgers (no balance and no activity). Customers in advance
  // (negative outstanding) stay so rows tally exactly to the Grand Total.
  const activeRows = useMemo(
    () => filteredCustomers.filter((c) => {
      const m = customerMetrics.get(c.id);
      // Test the GROSS due, never the net: a customer whose entire due is covered by untagged
      // money nets to zero, and must still be listed (that is exactly the case worth chasing up
      // with accounts). Netting must change figures, never the population.
      //
      // A PLANNED customer is always listed, even at zero balance. Otherwise a plan made against
      // future billing — or against a customer who has since settled — silently vanishes from the
      // table AND from the grand-total Planned, which would then read lower than what was typed in.
      return m != null && (
        Math.round(m.outstanding) !== 0 ||
        Math.round(m.pendingGross + m.received) !== 0 ||
        m.planned !== 0
      );
    }),
    [filteredCustomers, customerMetrics],
  );

  const tree = useMemo(
    () => buildGroupTree<Customer, CM>(activeRows, groupBy, {
      dimValue,
      idOf: (c) => c.id,
      metricsOf: (c) => ({
        m: customerMetrics.get(c.id) ?? emptyMetrics(),
        mPrev: customerMetricsPrev.get(c.id) ?? emptyMetrics(),
      }),
      empty: () => ({ m: emptyMetrics(), mPrev: emptyMetrics() }),
      add: (acc, x) => { addInto(acc.m, x.m); addInto(acc.mPrev, x.mPrev); },
    }),
    [activeRows, groupBy, dimValue, customerMetrics, customerMetricsPrev],
  );


  const totals = useMemo<Metrics>(() => {
    const t = emptyMetrics();
    for (const c of activeRows) addInto(t, customerMetrics.get(c.id) ?? emptyMetrics());
    // Locked NET convention for the headline outstanding in the current month. Skip when a
    // sale type is active — sumOutstanding uses un-projected balances, diverging from rows.
    if (isCurrentMonth && !saleTypeActive) {
      t.outstanding = sumOutstanding(activeRows);
      // Keep the Debit/Credit split partitioned off the same raw balances as the headline.
      t.outstandingDebit = activeRows.reduce((s, c) => s + (c.outstanding > 0 ? c.outstanding : 0), 0);
      t.outstandingCredit = activeRows.reduce((s, c) => s + (c.outstanding < 0 ? -c.outstanding : 0), 0);
    }
    return t;
  }, [activeRows, customerMetrics, isCurrentMonth, saleTypeActive]);

  // Previous-month totals — only Due/Received feed the grand-total Collection % (prev) cell.
  const totalsPrev = useMemo<Metrics>(() => {
    const t = emptyMetrics();
    for (const c of activeRows) addInto(t, customerMetricsPrev.get(c.id) ?? emptyMetrics());
    return t;
  }, [activeRows, customerMetricsPrev]);

  const allCustomerIds = useMemo(() => activeRows.map((c) => c.id), [activeRows]);

  // Reset transient UI when the roll-up shape changes.
  useEffect(() => { setExpanded(new Set()); setSelectedNode(null); }, [groupBy]);

  /* ── Month-wise series for the panel (selected roll-up node, or consolidated) ── */
  interface MonthRow extends Metrics { month: string; sales: number; }
  const monthlyData = useMemo<MonthRow[]>(() => {
    const custs = selectedNode
      ? (() => { const ids = new Set(selectedNode.ids); return filteredCustomers.filter((c) => ids.has(c.id)); })()
      : filteredCustomers;
    return months.map((m) => {
      const agg: Metrics = emptyMetrics();
      let sales = 0;
      for (const c of custs) {
        addInto(agg, metricsForMonth(c, m));
        sales += (customerDetail[c.id]?.trend.find((x) => x.month === m)?.sales ?? 0) * 100_000;
      }
      return { month: m, ...agg, sales };
    });
  }, [selectedNode, filteredCustomers, months, customerDetail, metricsForMonth]);

  // Measure the leading column widths so frozen columns get the correct sticky left offset.
  const measureCols = useCallback(() => {
    const chev = chevRef.current?.offsetWidth ?? 32;
    const label = spHeadRef.current?.offsetWidth ?? 200;
    setColW((prev) => (prev.chev === chev && prev.label === label ? prev : { chev, label }));
  }, []);
  useLayoutEffect(measureCols); // re-measure after every render; setState is guarded so it can't loop
  useEffect(() => {
    window.addEventListener("resize", measureCols);
    return () => window.removeEventListener("resize", measureCols);
  }, [measureCols]);

  /* ── Handlers ── */
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "salesperson" ? "asc" : "desc"); }
  };
  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // Open the invoice drill-down for a clicked figure. Current-month only (per-bill
  // detail is a live snapshot; past months carry monthly totals only).
  //  - outstanding → every open bill (pending > 0)
  //  - due / pending → open bills due on/before the selected month-end
  const openDrill = useCallback(
    (customerIds: string[], category: "outstanding" | "due" | "pending", entityLabel: string) => {
      const monthEnd = monthLabelToEndDate(selectedMonth);
      const dueOnly = category !== "outstanding";
      const rows: InvoiceDrillRow[] = [];
      // Report's authoritative (net) figure per ledger key, so the popup can reconcile.
      const ledgerFigures: Record<string, number> = {};
      // Per-ledger context + whether the ledger emitted any open bill. A ledger can carry a
      // non-zero report figure (e.g. overdue from an opening balance) without any qualifying
      // open invoice; we track these so they still appear in the popup instead of being
      // dropped — otherwise the popup total falls short of the report's headline figure.
      const ledgerInfo = new Map<string, { c: Customer; groupName: string }>();
      const keysWithRows = new Set<string>();
      // On-account per ledger key, plus the guids backing it so the entries behind it can be
      // looked up. Only for the due/pending categories: Outstanding is already the net ledger
      // balance, so on-account is baked into it and deducting again would double-count.
      const onAcctByKey = new Map<string, number>();
      const guidsByKey = new Map<string, string[]>();
      /** Credit sitting on a NAMED bill (advances, credit notes) — the half of on-account that
       *  needs no lookup, because the bill list is already in the browser. */
      const creditBillsByKey = new Map<string, { ref: string; date: string; amount: number }[]>();
      for (const id of customerIds) {
        const c = customerById.get(id);
        if (!c) continue;
        const groupName = groupNameOf(c, customerGroupMap);
        const key = `${c.name}|||${c.company}|||${c.location}`;
        if (!ledgerInfo.has(key)) ledgerInfo.set(key, { c, groupName });
        const m = customerMetrics.get(id);
        if (m) {
          const fig = category === "outstanding" ? startMonthOutstanding(m) : category === "due" ? m.due : m.pending;
          ledgerFigures[key] = (ledgerFigures[key] ?? 0) + fig;
          if (category !== "outstanding" && m.onAccount > 0) {
            onAcctByKey.set(key, (onAcctByKey.get(key) ?? 0) + m.onAccount);
            const g = guidsByKey.get(key);
            if (g) g.push(id); else guidsByKey.set(key, [id]);
          }
        }
        for (const inv of customerDetail[id]?.invoices ?? []) {
          // Bills carrying a NEGATIVE balance are credit the customer has already paid — a machine
          // advance, a credit note — filed against a bill ref only because whoever keyed the
          // receipt typed one. Collect them so the drill-down can name them in the on-account
          // block; they are never invoice rows.
          if (inv.pending < 0) {
            const list = creditBillsByKey.get(key);
            const cb = { ref: inv.billRefName || inv.number, date: inv.date, amount: -inv.pending };
            if (list) list.push(cb); else creditBillsByKey.set(key, [cb]);
            continue;
          }
          if (inv.billType === "Agst Ref" || inv.amount <= 0) continue;
          if (inv.pending <= 0) continue;
          if (dueOnly && new Date(inv.dueDate) > monthEnd) continue;
          keysWithRows.add(key);
          rows.push({
            customerName: c.name, groupName, company: c.company, location: c.location,
            number: inv.number, billRefName: inv.billRefName, date: inv.date,
            amount: inv.amount, received: inv.amount - inv.pending, pending: inv.pending,
            dueDate: inv.dueDate, overdueDays: inv.overdueDays, status: inv.status,
            voucherType: inv.voucherType,
          });
        }
      }
      // Ledgers with a non-zero report figure but no qualifying open bill: emit a single
      // reconciliation line carrying the whole figure (opening-balance / advance-derived
      // pending). This keeps each such ledger — and the grand total — equal to the base
      // report. The dialog's per-ledger reconciliation leaves these untouched (already net).
      for (const [key, fig] of Object.entries(ledgerFigures)) {
        // A key carrying on-account already has rows (and its own bridge below), so it must not
        // also get this line — the two would net against each other and undershoot the figure.
        if (keysWithRows.has(key) || onAcctByKey.has(key) || Math.abs(fig) < 1) continue;
        const info = ledgerInfo.get(key);
        if (!info) continue;
        const { c, groupName } = info;
        rows.push({
          customerName: c.name, groupName, company: c.company, location: c.location,
          number: "", billRefName: "Opening balance / advances (no open invoice)",
          date: "", amount: 0, received: 0, pending: fig,
          dueDate: "", overdueDays: 0, status: "pending", voucherType: "other",
          isAdjustment: true,
        });
      }
      rows.sort((a, b) => b.pending - a.pending);
      const catLabel = category === "outstanding"
        ? "Total Outstanding — open invoices"
        : category === "due"
        ? `Due upto ${monthEndLong(selectedMonth)} — open invoices`
        : "Total Pending — open invoices";

      /** Invoice rows (gross) + the on-account bridge. Called twice: once immediately with only
       *  the totals we already know, then again once the entries behind them arrive. The FIGURES
       *  are identical both times — only the detail gets richer, so nothing moves under the
       *  reader. */
      const withOnAccount = (entriesByLedger?: Map<string, OnAccountEntry[]>): InvoiceDrillRow[] => {
        const out = [...rows];
        for (const [key, total] of onAcctByKey) {
          const info = ledgerInfo.get(key);
          if (!info) continue;
          const { c, groupName } = info;
          const base = {
            customerName: c.name, groupName, company: c.company, location: c.location,
            amount: 0, received: 0, dueDate: "", overdueDays: 0,
            status: "pending" as const, voucherType: "other" as const, isOnAccount: true,
          };
          // `total` is already CAPPED at the ledger's due, so the pieces are allocated against it
          // in order and anything past it is dropped — a customer holding more credit than they
          // owe has that surplus in Outstanding, not in Due Pending.
          let remaining = total;
          const take = (label: string, number: string, ref: string, date: string, amount: number) => {
            const applied = Math.min(remaining, amount);
            if (applied < 1) return;
            remaining -= applied;
            out.push({ ...base, onAccountLabel: label, number, billRefName: ref, date, pending: -applied });
          };
          // 1. Credit filed against a named bill. Already in the browser, so it needs no lookup
          //    and shows immediately. The ref itself ("M/C ADV", "CN/332/25-26") is what tells the
          //    reader whether it is an advance or a credit note — we do not guess from the name.
          for (const cb of creditBillsByKey.get(key) ?? []) {
            take("Advance / credit note", "", cb.ref, cb.date, cb.amount);
          }
          // 2. Credit filed against no bill at all — named from the voucher lookup where Tally
          //    has one. Pool every guid behind this ledger key first.
          const entries = entriesByLedger
            ? (guidsByKey.get(key) ?? []).flatMap((g) => entriesByLedger.get(g) ?? [])
            : undefined;
          const { shown } = displayableEntries(entries, remaining);
          const namedUntagged = shown.length > 0;
          for (const e of shown) {
            take(e.voucherType, e.voucherNo ?? "", e.narration ?? "", e.date, e.amount);
          }
          // 3. Whatever no entry explains — for ~96 of the 169 ledgers book-wide that is the whole
          //    untagged figure, because the money is an opening balance keyed with no bill breakup.
          if (remaining >= 1) {
            out.push({
              ...base,
              onAccountLabel: namedUntagged
                ? "On Account — no entry detail"
                : "On Account — opening balance / unallocated",
              number: "", billRefName: "", date: "",
              pending: -remaining,
            });
          }
        }
        return out;
      };

      const seq = ++drillSeqRef.current;
      setDrill({ title: catLabel, subtitle: entityLabel, rows: withOnAccount(), ledgerFigures });
      // Name the actual receipts, lazily. The popup is already correct and complete without
      // this; a slow or failed lookup simply leaves the summary line in place.
      const guids = [...guidsByKey.values()].flat();
      if (guids.length) {
        void loadOnAccountEntries(guids).then((byLedger) => {
          if (drillSeqRef.current !== seq) return;   // a newer drill has since been opened
          setDrill((prev) => (prev ? { ...prev, rows: withOnAccount(byLedger) } : prev));
        });
      }
    },
    [customerById, customerDetail, selectedMonth, customerGroupMap, customerMetrics],
  );

  /** A figure cell that drills into its invoices — clickable only in the current month.
   *  Plain render fn (not a component) so cells don't remount each render. */
  const drillCell = (
    ids: string[], category: "outstanding" | "due" | "pending", label: string,
    className: string, children: ReactNode,
    freeze?: { className: string; style?: CSSProperties },
  ) => (
    <TableCell
      style={freeze?.style}
      className={`${className} ${freeze?.className ?? ""} ${isCurrentMonth ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
      title={isCurrentMonth ? "Click to view invoices" : "Per-invoice detail is available for the current month only"}
      onClick={isCurrentMonth ? (e) => { e.stopPropagation(); openDrill(ids, category, label); } : undefined}
    >
      {children}
    </TableCell>
  );

  const clearFilters = () => {
    setCompanies([]); setLocations([]); setSalesPersons([]); setCategories([]); setCustomerSegment("all"); setSaleTypes([]); setCustomerSearch("");
  };
  const filterChips: FilterChip[] = [
    companies.length > 0 && {
      label: companies.length <= 2 ? `Company: ${companies.join(", ")}` : `${companies.length} companies`,
      onRemove: () => setCompanies([]),
    },
    locations.length > 0 && {
      label: locations.length <= 2 ? `Location: ${locations.join(", ")}` : `${locations.length} locations`,
      onRemove: () => setLocations([]),
    },
    salesPersons.length > 0 && {
      label: salesPersons.length <= 2 ? `Person: ${salesPersons.join(", ")}` : `${salesPersons.length} persons`,
      onRemove: () => setSalesPersons([]),
    },
    categories.length > 0 && {
      label: categories.length <= 2 ? `Category: ${categories.join(", ")}` : `${categories.length} categories`,
      onRemove: () => setCategories([]),
    },
    customerSegment !== "all" && {
      label: `Segment: ${customerSegment === "active" ? "Active" : "No Activity"}`,
      onRemove: () => setCustomerSegment("all"),
    },
    saleTypes.length > 0 && {
      label: saleTypes.length <= 2
        ? `Type: ${saleTypes.map((t) => SALE_TYPE_LABELS[t] ?? t).join(", ")}`
        : `${saleTypes.length} types`,
      onRemove: () => setSaleTypes([]),
    },
    customerSearch.trim() && { label: `Search: ${customerSearch.trim()}`, onRemove: () => setCustomerSearch("") },
  ].filter(Boolean) as FilterChip[];

  /** The active roll-up chain, e.g. "Salesperson → Customer". Used by the label column header,
   *  the export's meta block and the export's per-level column names — one source of truth. */
  const dimLabelOf = (d: CDim): string => C_DIMENSIONS.find((x) => x.key === d)?.label ?? d;
  const groupByChain = groupBy.map(dimLabelOf).join(" → ");

  const dueLabel = `Due by ${selectedMonth ? monthEndLong(selectedMonth) : "—"}`;
  const plannedLabel = `Planned (${selectedMonth || "—"})`;
  // Sales raised in the selected month and the month before it. Both respect the Sale Type
  // filter exactly (via trend.salesByType), the same way Outstanding/Received do.
  const salesLabel = `Sales (${selectedMonth || "—"})`;
  const salesPrevLabel = prevMonth ? `Sales (${prevMonth})` : "Sales (prev)";
  // Sales are booked INCLUSIVE of GST, so the Sales cards can show "Base · GST" beneath the total.
  // Gate on whether the source SUPPLIES the split (the key exists), never on the amount: a genuine
  // zero-GST month (exports) must still show "GST ₹0" rather than silently dropping the breakup.
  // Only the live Tally mirror carries per-voucher tax; the pipeline omits the key, so the sub-line
  // simply doesn't render there — no gap, no fabricated "base == total".
  const gstKnown = useMemo(
    () => Object.values(customerDetail).some((d) => d?.trend?.some((t) => t.salesGst !== undefined)),
    [customerDetail],
  );
  /** "Base ₹13.34 Cr · GST ₹2.40 Cr" for a Sales card, or undefined when the split is unknown. */
  const gstSub = useCallback(
    (m: Metrics): string | undefined =>
      gstKnown ? `Base ${fmt(m.sales - m.salesGst)} · GST ${fmt(m.salesGst)}` : undefined,
    [gstKnown],
  );
  // Outstanding (Today) = the live net balance as on asOfDate for the current month; for a past
  // month "today" doesn't apply, so it shows that month's closing (month-end) balance.
  const outstandingNowLabel = isCurrentMonth
    ? `Outstanding (Today)`
    : `Outstanding (${selectedMonth ? monthEndLong(selectedMonth) : "month-end"})`;
  const receivedLabel = `Received in ${selectedMonth || "—"}`;
  // Total Pending breakup labels: As-on-today = overdue (matches the dashboard's overview);
  // the remaining difference = bills coming due between today and month-end.
  const pendingNowLabel = `As on ${formatDateLong(asOfDate)}`;
  const pendingTillLabel = `Till ${selectedMonth ? monthEndLong(selectedMonth) : "month-end"}`;

  const sz = (strong: boolean) => (strong ? "text-sm " : "");
  const bd = (strong: boolean) => (strong ? "font-semibold " : "");
  const money = "text-right font-mono";

  /* ── The one column list ────────────────────────────────────────────────────────
     The header, the body cells, the Excel export and the empty-state colSpan are ALL derived
     from this array. They used to be four hand-maintained lists kept in positional lockstep, and
     the risk was never theoretical: one extra cell and every money figure sits under the wrong
     heading, silently, for everyone. Add a column here and it appears in all four.

     Order here is the order on screen, in the picker and in the file. Sub-columns of a section
     must stay adjacent to their total — the banner and the picker heading both assume it. */
  const ALL_COLS: SPCol[] = [
    {
      key: "nextFollowup", label: "Next Follow-up",
      help: "The date the next chase is due, from the follow-up log.",
      legal: true, xlsxKind: "text",
      cell: (c) => (
        // stopPropagation: the row's own onClick expands the node and scopes the Monthly panel.
        <TableCell onClick={(e) => e.stopPropagation()}>
          {c.entity
            ? <NextFollowupCell latest={c.latest} onLog={() => setFollowupTarget(c.entity!)} />
            : <span className="text-[10px] text-muted-foreground">—</span>}
        </TableCell>
      ),
    },
    {
      key: "lastRemark", label: "Last Remark",
      help: "What was said the last time this customer was chased.",
      legal: true, xlsxKind: "text",
      cell: (c) => (
        <TableCell className="text-[11px] text-muted-foreground max-w-[220px] truncate" title={c.latest?.remarks || ""}>
          {c.latest?.remarks || "—"}
        </TableCell>
      ),
    },
    {
      key: "sales", label: salesLabel, sort: "sales", wrap: true, width: "w-[110px]",
      help: "What we billed them during the month, GST included.",
      legal: true, xlsxKind: "money", xlsx: (m) => m.sales,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money} ${bd(c.strong)}${c.edge}`}>{fmt(c.m.sales)}</TableCell>,
    },
    {
      key: "salesPrev", label: salesPrevLabel, sort: "salesPrev", wrap: true, width: "w-[110px]",
      help: "The same figure for the month before — where a slowdown shows first.",
      legal: true, xlsxKind: "money", xlsx: (_m, mPrev) => mPrev.sales,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money}${c.edge}`}>{fmt(c.mPrev.sales)}</TableCell>,
    },
    {
      key: "due", label: dueLabel, sort: "due", wrap: true, width: "w-[110px]",
      help: "Everything collectable this month: what was already pending, plus what falls due by month-end. The denominator of Collection %.",
      legal: true, xlsxKind: "money", xlsx: (m) => m.due,
      cell: (c) => drillCell(c.ids, "due", c.label, `${sz(c.strong)}${money}${c.edge}`, fmt(c.m.due)),
    },
    {
      key: "planned", label: plannedLabel, sort: "planned", wrap: true, width: "w-[110px]",
      help: "What the team committed to collect this month, typed in against a customer. Rolls up.",
      legal: showPlanCols,
      why: "Hidden while a Sale Type filter is on. A plan is a whole-customer figure with no sale-type split, so it cannot be read against a sale-type-filtered actual.",
      xlsxKind: "money", xlsx: (m) => m.planned,
      cell: (c) => plannedCell(c),
    },
    {
      key: "gap", label: "Gap to plan", sort: "gap", wrap: true, width: "w-[100px]",
      help: "Planned minus Received. Positive means the commitment has not been met yet.",
      legal: showPlanCols,
      why: "Hidden while a Sale Type filter is on — it is Planned minus Received, and Planned has no sale-type split.",
      xlsxKind: "money", xlsx: (m) => planGap(m),
      cell: (c) => {
        const gap = planGap(c.m);
        return (
          <TableCell className={`${sz(c.strong)}${money} ${c.m.planned > 0 && gap > 0 ? "text-destructive" : c.m.planned > 0 ? "text-emerald-600" : "text-muted-foreground"}${c.edge}`}>
            {c.m.planned > 0 ? fmt(gap) : "—"}
          </TableCell>
        );
      },
    },

    /* ── Received ── */
    {
      key: "receivedOnAccount", label: "Received — On Account", short: "On Account",
      section: "received", sub: true, sort: "receivedOnAccount",
      help: "The part of the month's receipts settling no specific bill: advances and untagged money.",
      legal: true, xlsxKind: "money", xlsx: (m) => m.receivedOnAccount,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money} text-muted-foreground${c.edge}`}>{fmt(c.m.receivedOnAccount)}</TableCell>,
    },
    {
      key: "receivedAgainst", label: "Received — Against Invoices", short: "Against Invoices",
      section: "received", sub: true, sort: "receivedAgainst",
      help: "The part of the month's receipts applied to a named bill.",
      legal: true, xlsxKind: "money", xlsx: (m) => m.receivedAgainst,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money} text-muted-foreground${c.edge}`}>{fmt(c.m.receivedAgainst)}</TableCell>,
    },
    {
      key: "received", label: receivedLabel, short: "Total",
      section: "received", sort: "received", wrap: true, width: "w-[110px]",
      help: "Cash that actually came in during the month, including payments made outside Tally.",
      legal: true, xlsxKind: "money", xlsx: (m) => m.received,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money}${c.edge}`}>{fmt(c.m.received)}</TableCell>,
    },

    /* ── Outstanding ── */
    {
      key: "outstandingDebit", label: "Outstanding — Net Debit", short: "Net Debit",
      section: "outstanding", sub: true, sort: "outstandingDebit",
      help: "The part of Outstanding held by parties who actually owe us.",
      legal: true, xlsxKind: "money", xlsx: (m) => m.outstandingDebit,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money} text-muted-foreground${c.edge}`}>{fmt(c.m.outstandingDebit)}</TableCell>,
    },
    {
      key: "outstandingCredit", label: "Outstanding — Net Credit", short: "Net Credit",
      section: "outstanding", sub: true, sort: "outstandingCredit",
      help: "The part held by parties sitting in advance, shown as a positive figure. Outstanding = Net Debit − Net Credit.",
      legal: true, xlsxKind: "money", xlsx: (m) => m.outstandingCredit,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money} text-muted-foreground${c.edge}`}>{fmt(c.m.outstandingCredit)}</TableCell>,
    },
    {
      key: "outstandingNow", label: outstandingNowLabel, short: "Total",
      section: "outstanding", sort: "outstandingNow", wrap: true, width: "w-[110px]",
      help: "The live net ledger balance as on today. A negative figure just means that customer is sitting in advance.",
      legal: true, xlsxKind: "money", xlsx: (m) => m.outstanding,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money} ${bd(c.strong)}${c.edge}`}>{fmt(c.m.outstanding)}</TableCell>,
    },

    /* ── Due Pending ── */
    {
      key: "pendingGross", label: "Due Pending — Gross", short: "Gross",
      section: "pending", sub: true, sort: "pendingGross",
      help: "Due Pending before On Account is set off: the straight sum of the unpaid bills.",
      legal: showOnAccountCols,
      why: "Only shown on the live current month. On the older feed, a past month or under a sale-type filter the netting is not applied — Gross equals the Total, so the column would say nothing.",
      xlsxKind: "money", xlsx: (m) => m.pendingGross,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money} text-muted-foreground${c.edge}`}>{fmt(c.m.pendingGross)}</TableCell>,
    },
    {
      key: "onAccount", label: "Due Pending — less On Account", short: "On Account",
      section: "pending", sub: true, sort: "onAccount",
      help: "Money already banked but tagged to no bill. Deducted from Gross to give Due Pending.",
      legal: showOnAccountCols,
      why: "Only shown on the live current month — elsewhere nothing is netted off, so this is always zero.",
      xlsxKind: "money", xlsx: (m) => m.onAccount,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money} text-muted-foreground${c.edge}`}>{c.m.onAccount > 0 ? `−${fmt(c.m.onAccount)}` : fmt(0)}</TableCell>,
    },
    {
      key: "pendingOverdue", label: `Due Pending — ${pendingNowLabel}`, short: pendingNowLabel,
      section: "pending", sub: true,
      help: "The overdue slice — bills already past their due date. Matches the dashboard.",
      legal: true, xlsxKind: "money", xlsx: (m) => m.pending - m.dueSoon,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money} text-muted-foreground${c.edge}`}>{fmt(c.m.pending - c.m.dueSoon)}</TableCell>,
    },
    {
      key: "dueSoon", label: `Due Pending — ${pendingTillLabel}`, short: pendingTillLabel,
      section: "pending", sub: true,
      help: "Bills that are not overdue yet, but fall due before month-end.",
      legal: true, xlsxKind: "money", xlsx: (m) => m.dueSoon,
      cell: (c) => <TableCell className={`${sz(c.strong)}${money} text-muted-foreground${c.edge}`}>{fmt(c.m.dueSoon)}</TableCell>,
    },
    {
      key: "pending", label: "Due Pending", short: "Total",
      section: "pending", sort: "pending", wrap: true, width: "w-[95px]",
      help: "Still unpaid after this month's collections: Due minus Received, net of On Account.",
      legal: true, xlsxKind: "money", xlsx: (m) => m.pending,
      cell: (c) => drillCell(
        c.ids, "pending", c.label,
        `${sz(c.strong)}${money} ${bd(c.strong)}${c.m.pending > 0 ? "text-destructive" : ""}${c.edge}`,
        <>
          {fmt(c.m.pending)}
          {/* Money already banked but tagged to no invoice — shown under the figure it was taken
              off, so the row explains itself without needing the breakup columns on. */}
          {c.m.onAccount > 0 && (
            <span className="block text-[10px] font-normal leading-tight text-muted-foreground whitespace-nowrap">
              less On Account {fmt(c.m.onAccount)}
            </span>
          )}
        </>,
      ),
    },

    {
      key: "collectionPct", label: prevMonth ? `Collection % (${selectedMonth})` : "Collection %",
      sort: "collectionPct", width: "w-[95px]", wrap: true,
      help: "Received ÷ Due — how much of what was collectable actually came in.",
      legal: true, xlsxKind: "pct",
      xlsx: (m) => { const p = collectionPct(m); return p === null ? "" : Math.round(p * 10) / 10; },
      cell: (c) => {
        const pct = collectionPct(c.m);
        return <TableCell className={`${sz(c.strong)}${money} ${pctStyle(pct)}${c.edge}`}>{pct === null ? "—" : `${pct.toFixed(1)}%`}</TableCell>;
      },
    },
    {
      key: "collectionPctPrev", label: prevMonth ? `Collection % (${prevMonth})` : "Collection % (prev)",
      sort: "collectionPctPrev", width: "w-[95px]", wrap: true,
      help: "The same ratio for the month before, so a slide is visible.",
      legal: true, xlsxKind: "pct",
      xlsx: (_m, mPrev) => { const p = collectionPct(mPrev); return p === null ? "" : Math.round(p * 10) / 10; },
      cell: (c) => {
        const pct = collectionPct(c.mPrev);
        return <TableCell className={`${sz(c.strong)}${money} ${pctStyle(pct)}${c.edge}`}>{prevMonth == null || pct === null ? "—" : `${pct.toFixed(1)}%`}</TableCell>;
      },
    },
  ];

  /** The user's picks for one section, minus anything unavailable right now. */
  const picked = (s: ColSection) =>
    ALL_COLS.filter((c) => c.section === s && c.legal && visibleCols.includes(c.key));
  /**
   * Whether a group can be folded at all.
   *
   * Needs the Total (there has to be something to fold INTO) and at least one breakup beside it
   * (there has to be something to fold AWAY). A group showing only its Total therefore carries no
   * button: offering one there would promise columns the user never asked for.
   */
  const canFold = (s: ColSection) => {
    const p = picked(s);
    return p.length >= 2 && p.some((c) => !c.sub);
  };
  const isFolded = (s: ColSection) => folded.has(s) && canFold(s);

  /**
   * The columns actually rendered: the user's picks, minus anything unavailable, minus the
   * breakups of any group they have folded shut.
   *
   * The fold is deliberately NOT the same thing as the pick. The picker says which columns you
   * want; the fold just tucks a breakup out of sight while you read, and puts it back exactly as
   * you left it. Folding therefore never invents a column you didn't choose, and unfolding never
   * shows one either — which is the whole difference from the first cut of this control.
   */
  const cols = ALL_COLS.filter(
    (c) => c.legal && visibleCols.includes(c.key)
      && !(c.sub && c.section && isFolded(c.section)),
  );
  const shown = (k: ColKey) => cols.some((c) => c.key === k);
  /** How many of a section's columns survived. 0 = gone, 1 = flat column, ≥2 = bannered. */
  const sectionCount = (s: ColSection) => cols.filter((c) => c.section === s).length;
  const isBannered = (s: ColSection) => sectionCount(s) >= 2;
  const anyBanner = isBannered("received") || isBannered("outstanding") || isBannered("pending");
  /** A left rule marks where a section starts — on whichever of its columns survived first. */
  const edgeFor = (col: SPCol) =>
    col.section && cols.find((c) => c.section === col.section)?.key === col.key
      ? " border-l border-border"
      : "";

  // Re-sort every level by the active column (Total Pending desc by default).
  //
  // A column that is not ON SCREEN must never be the one the table is ordered by: a saved layout
  // that drops Due Pending, or a group folded shut over the column you were sorting by, would
  // otherwise leave the report ordered by a figure nobody can see, with no header arrow anywhere
  // to explain the order. Falling back to the shipped default is the honest answer.
  //
  // The test is against `cols` — what is rendered — and NOT against `visibleCols`, which now also
  // contains the picks currently tucked behind a fold. That distinction is why this block sits
  // below the column list rather than up with the rest of the sort state.
  // Every sortable ColKey is spelled the same as its SortKey, so the lookup is direct.
  const sortable = (k: SortKey) => k === "salesperson" || shown(k as ColKey);
  const sortKey: SortKey =
    sortable(rawSortKey) ? rawSortKey
    // Due Pending is the shipped default — but it can itself be hidden, so fall through to the
    // group name rather than order the table by a column that is nowhere on screen.
    : sortable("pending") ? "pending"
    : "salesperson";
  const sortedRoots = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: GroupNode<CM>, b: GroupNode<CM>): number => {
      if (sortKey === "salesperson")       return dir * a.label.localeCompare(b.label);
      if (sortKey === "sales")              return dir * (a.metrics.m.sales - b.metrics.m.sales);
      if (sortKey === "salesPrev")          return dir * (a.metrics.mPrev.sales - b.metrics.mPrev.sales);
      if (sortKey === "outstandingNow")     return dir * (a.metrics.m.outstanding - b.metrics.m.outstanding);
      if (sortKey === "collectionPct")      return dir * ((collectionPct(a.metrics.m) ?? -1) - (collectionPct(b.metrics.m) ?? -1));
      if (sortKey === "collectionPctPrev")  return dir * ((collectionPct(a.metrics.mPrev) ?? -1) - (collectionPct(b.metrics.mPrev) ?? -1));
      // Derived, not stored — must be handled before the Metrics-key fallback below.
      if (sortKey === "gap")                return dir * (planGap(a.metrics.m) - planGap(b.metrics.m));
      return dir * (a.metrics.m[sortKey] - b.metrics.m[sortKey]);
    };
    return sortTree(tree.roots, cmp);
  }, [tree, sortKey, sortDir]);

  /** The banner name is the SECTION's, not the total column's — the total can itself be hidden. */
  const SECTION_TITLE: Record<ColSection, string> = {
    received: receivedLabel,
    outstanding: outstandingNowLabel,
    pending: "Due Pending",
  };

  /** The +/− on a group's heading. Absent unless the group has a breakup to fold. */
  const sectionToggle = (s: ColSection): ReactNode => {
    if (!canFold(s)) return null;
    const open = !isFolded(s);
    const what = `the ${SECTION_TITLE[s]} breakup`;
    return (
      <button
        type="button"
        // The heading is click-to-sort; without this, folding a group would re-sort the table.
        onClick={(e) => {
          e.stopPropagation();
          setFolded((prev) => {
            const next = new Set(prev);
            if (next.has(s)) next.delete(s); else next.add(s);
            return next;
          });
        }}
        className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded border border-border/70 text-foreground/60 hover:bg-muted hover:text-foreground shrink-0"
        title={open ? `Hide ${what}` : `Show ${what}`}
        aria-label={open ? `Hide ${what}` : `Show ${what}`}
        aria-expanded={open}
      >
        {open ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
      </button>
    );
  };

  /**
   * The header, one entry per cell of the TOP row: either a plain column (which spans both header
   * rows) or a banner spanning its section's surviving columns (which are re-emitted underneath).
   * Derived from `cols`, so a colSpan can never fall out of step with the cells below it.
   */
  type HeadGroup =
    | { kind: "col"; col: SPCol }
    | { kind: "banner"; section: ColSection; cols: SPCol[] };
  const headGroups: HeadGroup[] = [];
  for (const col of cols) {
    if (col.section && isBannered(col.section)) {
      const open = headGroups[headGroups.length - 1];
      if (open?.kind === "banner" && open.section === col.section) open.cols.push(col);
      else headGroups.push({ kind: "banner", section: col.section, cols: [col] });
    } else {
      headGroups.push({ kind: "col", col });
    }
  }

  /* ── The picker ─────────────────────────────────────────────────────────────
     An unavailable column is LISTED, greyed, with the reason where `help` normally goes — see
     ColumnOption.disabled. It is dropped from the table and the file all the same, but the user's
     tick survives in `visibleCols`, so clearing (say) the Sale Type filter brings Planned and Gap
     to plan straight back rather than making them re-pick it. */
  const pickerOptions: ColumnOption[] = ALL_COLS.map((c) => ({
    key: c.key,
    label: c.label,
    help: c.legal ? c.help : (c.why ?? c.help),
    section: c.section ? SECTION_TITLE[c.section] : undefined,
    sub: c.sub,
    disabled: !c.legal,
  }));
  const legalVisible = visibleCols.filter(legalKey);
  /** Take the picker's answer for the legal columns and keep the rest of the user's intent. */
  const mergeVisible = (next: string[]) => {
    // Ticking a column in the picker must SHOW it. If its group happened to be folded shut, the
    // column would land behind the fold and the tick would look like it did nothing — so a fresh
    // tick opens its group. (Unticking leaves the fold alone; nothing is being hidden by surprise.)
    const added = (next as ColKey[]).filter((k) => !visibleCols.includes(k));
    const opens = new Set(
      added.map((k) => ALL_COLS.find((c) => c.key === k)?.section).filter(Boolean) as ColSection[],
    );
    if (opens.size) setFolded((prev) => new Set([...prev].filter((s) => !opens.has(s))));
    setVisibleCols([...(next as ColKey[]), ...visibleCols.filter((k) => !legalKey(k))]);
  };

  /* ── The Monthly analysis panel's own breakups ───────────────────────────────
     The panel follows the main table's Received / Due Pending choices, but works out its OWN
     two-row header from them. It used to take `anyExpanded` from the main table while only ever
     rendering received/pending sub-heads, so turning on just the Outstanding breakup gave it a
     second header row with nothing in it. The panel has no Outstanding breakup at all. */
  const panelReceived = shown("receivedOnAccount") && shown("receivedAgainst");
  const panelPending = shown("pendingOverdue") && shown("dueSoon");
  const panelBanner = panelReceived || panelPending;

  /* ── Export ── */
  const handleExport = () => {
    const aoa: (string | number)[][] = [];
    aoa.push(["Salesperson Collection Report"]);
    aoa.push([`Financial Year: ${fyLabel}`]);
    aoa.push([`Month: ${selectedMonth}`]);
    aoa.push([`As on: ${formatDateLong(asOfDate)}`]);
    aoa.push([
      `Company: ${companies.length ? companies.join(", ") : "All"}`,
      `Location: ${locations.length ? locations.join(", ") : "All"}`,
    ]);
    aoa.push([
      `Sale Type: ${saleTypes.length ? saleTypes.map((t) => SALE_TYPE_LABELS[t] ?? t).join(", ") : "All"}`,
      `Segment: ${customerSegment === "all" ? "All Customers" : customerSegment === "active" ? "Active" : "No Activity"}`,
      `Search: ${customerSearch.trim() || "—"}`,
    ]);
    aoa.push([`Group by: ${groupByChain}`]);
    aoa.push([]);

    /* ── Column layout ─────────────────────────────────────────────────────────
       The roll-up used to be flattened into ONE indented "Group" column, which Excel cannot
       filter or pivot on. Instead: one column per group-by level, ancestor labels REPEATED on
       every descendant row, plus a Level column.
         - Level = depth + 1 (Grand Total = 0). Filter Level = <deepest> for a clean pivot
           source, or Level = 1 for a salesperson summary.
         - Company / Location are split out whenever a per-ledger dimension is in play and isn't
           already its own level. Not decoration: with ancestors repeated, two ledgers of the
           SAME customer name are otherwise identical in every leading column.
       Everything below is computed from these arrays — no hardcoded column letters or counts,
       which is what used to make adding a column shift the ₹ formats off their cells. */
    const dimCols = groupBy.map(dimLabelOf);
    const perLedgerDim = groupBy.includes("customer") || groupBy.includes("group");
    const wantCompany = perLedgerDim && !groupBy.includes("company");
    const wantLocation = perLedgerDim && !groupBy.includes("location");

    /* The file now shows exactly what the screen shows.
       It used to write every column regardless of the on-screen collapse state, on the reasoning
       that a spreadsheet should carry everything. That was defensible while the only way to hide
       a column was four unlabelled +/− buttons nobody found. Now that choosing columns is an
       explicit, saved act, a file that ignores the choice is the surprising one — and the same
       report elsewhere in the hub already exports what it displays. */
    const followupCols = cols.filter((c) => c.xlsxKind === "text");
    const moneyCols = cols.filter((c) => c.xlsxKind === "money");
    const pctCols = cols.filter((c) => c.xlsxKind === "pct");

    const leadHeaders: string[] = [
      "Level",
      ...dimCols,
      ...(wantCompany ? ["Company"] : []),
      ...(wantLocation ? ["Location"] : []),
      ...followupCols.map((c) => c.label),
    ];
    const moneyHeaders = moneyCols.map((c) => c.label);
    // Percent + free-text plan fields sit AFTER the money block so the ₹ format can be applied
    // to one contiguous range.
    const tailHeaders: string[] = [
      ...pctCols.map((c) => c.label),
      ...(showPlanCols && shown("planned") ? ["Expected Date", "Plan Note"] : []),
    ];
    aoa.push([...leadHeaders, ...moneyHeaders, ...tailHeaders]);
    const headerRow = aoa.length;            // 1-indexed row of the column header, derived not guessed
    const nLead = leadHeaders.length;
    const nMoney = moneyHeaders.length;
    const nPct = pctCols.length;
    const nCols = nLead + nMoney + tailHeaders.length;
    const wantPlanText = showPlanCols && shown("planned");

    // Pre-order flatten, carrying the ANCESTOR LABEL CHAIN rather than an indent string.
    // mPrev is carried so the previous-month Sales column can be exported per row.
    const flat: {
      depth: number; labels: string[]; sub?: string;
      entity: { type: FollowupEntityType; name: string } | null;
      m: Metrics; mPrev: Metrics;
    }[] = [];
    const walk = (nodes: GroupNode<CM>[], trail: string[]) => {
      for (const n of nodes) {
        const labels = [...trail, n.label];
        // Reuse the SAME resolver the table uses, rather than re-deriving "is this a customer
        // row?" from the depth: the group dimension falls back to a per-ledger bucket for an
        // unmapped customer, so depth alone gets it wrong.
        flat.push({ depth: n.depth, labels, sub: n.sub, entity: entityOfNode(n), m: n.metrics.m, mPrev: n.metrics.mPrev });
        if (n.children.length) walk(n.children, labels);
      }
    };
    walk(sortedRoots, []);

    /** The money + percent cells for one row. Shared with the Grand Total so the two can't drift. */
    const figuresOf = (m: Metrics, mPrev: Metrics): (string | number)[] =>
      [...moneyCols, ...pctCols].map((c) => c.xlsx!(m, mPrev));
    /** The follow-up cells, which come from the follow-up log rather than from Metrics. */
    const followupsOf = (fu: Followup | undefined): string[] =>
      followupCols.map((c) =>
        c.key === "nextFollowup"
          ? (fu?.nextFollowupDate ? formatDateDMY(fu.nextFollowupDate) : "")
          : (fu?.remarks ?? ""),
      );

    for (const d of flat) {
      // Ancestors repeated, trailing levels blank — that is what makes autofilter work.
      const dims = dimCols.map((_, i) => d.labels[i] ?? "");
      // `sub` is "Company · Location" on a per-ledger node, and absent on a roll-up.
      const [subCompany = "", subLocation = ""] = (d.sub ?? "").split(" · ");
      // Follow-ups / plan detail only mean anything where the row IS exactly one entity.
      const fu = d.entity ? latestByEntity.get(entityKey(d.entity.type, d.entity.name)) : undefined;
      const plan = d.entity && wantPlanText
        ? plans.planFor(selectedMonth, d.entity.type, d.entity.name)
        : undefined;
      aoa.push([
        d.depth + 1,
        ...dims,
        ...(wantCompany ? [subCompany] : []),
        ...(wantLocation ? [subLocation] : []),
        ...followupsOf(fu),
        ...figuresOf(d.m, d.mPrev),
        ...(wantPlanText ? [plan?.expectedDate ? formatDateDMY(plan.expectedDate) : "", plan?.note ?? ""] : []),
      ]);
    }
    // Built by index, not by spreading a computed-length filler: with no group-by dimensions at
    // all `nLead` can be 1, and `Array(nLead - 2)` would throw RangeError and kill the export.
    const grandLead: (string | number)[] = new Array(nLead).fill("");
    grandLead[0] = 0;                                   // Level 0 = the total row
    if (nLead > 1) grandLead[1] = "Grand Total";
    aoa.push([
      ...grandLead,
      ...figuresOf(totals, totalsPrev),
      ...(wantPlanText ? ["", ""] : []),
    ]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 6 },                                            // Level
      ...dimCols.map(() => ({ wch: 28 })),
      ...(wantCompany ? [{ wch: 18 }] : []),
      ...(wantLocation ? [{ wch: 16 }] : []),
      ...followupCols.map((c) => ({ wch: c.key === "lastRemark" ? 40 : 15 })),
      ...moneyHeaders.map(() => ({ wch: 18 })),
      ...pctCols.map(() => ({ wch: 13 })),
      ...(wantPlanText ? [{ wch: 15 }, { wch: 40 }] : []),
    ];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } }];
    // Open filter-ready — the entire point of splitting the levels into columns.
    ws["!autofilter"] = {
      ref: `${XLSX.utils.encode_cell({ r: headerRow - 1, c: 0 })}:${XLSX.utils.encode_cell({ r: headerRow + flat.length, c: nCols - 1 })}`,
    };

    const INR = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';
    const firstDataR = headerRow;                     // 0-indexed first data row
    const lastDataR = headerRow + flat.length;        // 0-indexed Grand Total row
    for (let r = firstDataR; r <= lastDataR; r++) {
      for (let c = nLead; c < nLead + nMoney; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === "number") cell.z = INR;
      }
      // A loop, not a single cell: the screen carries Collection % for this month AND the last,
      // and the picker decides how many of them (0, 1 or 2) reach the file.
      for (let c = nLead + nMoney; c < nLead + nMoney + nPct; c++) {
        const pctCell = ws[XLSX.utils.encode_cell({ r, c })];
        if (pctCell && typeof pctCell.v === "number") pctCell.z = '0.0"%"';
      }
    }
    // Styling: title + column header black/white/bold; grand total stronger green.
    styleRow(ws, 0, nCols, HEADER_STYLE);                        // title banner
    styleRow(ws, headerRow - 1, nCols, HEADER_STYLE);            // column header row (0-indexed)
    // Subtotal rows keep the hierarchy legible now that the indentation is gone — light green,
    // clearly distinct from the strong-green Grand Total.
    const deepest = dimCols.length - 1;
    flat.forEach((d, i) => {
      if (d.depth < deepest) styleRow(ws, headerRow + i, nCols, TOTAL_STYLE);
    });
    styleRow(ws, lastDataR, nCols, GRAND_TOTAL_STYLE);           // Grand Total row
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Collection");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveAs(blob, `Salesperson-Collection_${selectedMonth}_${asOfDate}.xlsx`);
  };

  // Ledgers sitting in net credit, grouped by their TALLY group (master data — a new group in
  // Tally appears here on its own; nothing is hardcoded). Same row set and same as-on basis the
  // Outstanding card uses, so the popup total equals the card's credit line exactly.
  // MUST stay above the loading/error early returns: it is a hook, and React counts hooks per
  // render. Below them it ran only once data had arrived, so the first post-load render had one
  // hook more than the loading render — "Rendered more hooks than during the previous render",
  // which crashes the page. Only ever visible on a COLD cache, since a persisted query makes
  // `loading` false on the very first render and the early return never fires.
  const creditLedgers = useMemo(() => {
    const rows = activeRows
      .filter((c) => c.outstanding < 0)
      .map((c) => ({
        name: c.name,
        group: c.tallyGroup || "—",
        company: [c.company, c.location].filter(Boolean).join(" · "),
        amount: -c.outstanding,
      }))
      .sort((a, b) => b.amount - a.amount);
    const byGroup = new Map<string, { group: string; total: number; rows: typeof rows }>();
    for (const r of rows) {
      const g = byGroup.get(r.group) ?? { group: r.group, total: 0, rows: [] as typeof rows };
      g.total += r.amount; g.rows.push(r); byGroup.set(r.group, g);
    }
    return {
      groups: Array.from(byGroup.values()).sort((a, b) => b.total - a.total),
      total: rows.reduce((s, r) => s + r.amount, 0),
      count: rows.length,
    };
  }, [activeRows]);

  /* ── Render ── */
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading collection data…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3 max-w-md">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
          <p className="text-sm font-medium text-destructive">Data not loaded</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const kpiCards: {
    label: string; value: string; icon: typeof Coins; warn: boolean; sub?: string;
    /** Optional reconciliation lines under the headline figure; a line with onClick is clickable. */
    breakdown?: { label: string; value: string; onClick?: () => void }[];
  }[] = [
    { label: salesLabel,          value: fmt(totals.sales),       icon: Coins,          warn: false, sub: gstSub(totals) },
    { label: salesPrevLabel,      value: fmt(totalsPrev.sales),   icon: Coins,          warn: false, sub: gstSub(totalsPrev) },
    { label: dueLabel,            value: fmt(totals.due),         icon: CalendarClock,  warn: false },
    // Received folds in manual Other Payments (money paid OUTSIDE Tally), which used to be
    // invisible here — so the one figure a reader can't reconcile against Tally had nothing saying
    // why. Name the portion rather than make them guess. Only when there is some.
    { label: receivedLabel,       value: fmt(totals.received),    icon: Coins,          warn: false,
      sub: totals.receivedOther > 0 ? `incl. ${fmt(totals.receivedOther)} other payments` : undefined },
    // Outstanding is a NET figure: parties who owe, MINUS parties sitting in credit (machine
    // advances, related-party balances, customer advances). On the Live source those credits are
    // material — c. ₹11 Cr — and netting them silently is what makes this figure look wrong
    // against the pipeline, which excludes those ledgers entirely. So show the reconciliation
    // rather than a bare number, and let the credit line be opened. Nothing is recalculated here:
    // outstanding === outstandingDebit − outstandingCredit by construction (see Metrics).
    { label: outstandingNowLabel,    value: fmt(totals.outstanding), icon: Wallet,         warn: true,
      breakdown: totals.outstandingCredit > 0 ? [
        { label: "Owed", value: fmt(totals.outstandingDebit) },
        { label: "Less advances & credits", value: `−${fmt(totals.outstandingCredit)}`,
          onClick: () => setCreditDrill(true) },
      ] : undefined,
      sub: totals.outstandingCredit > 0 ? undefined
        : `Dr ${fmt(totals.outstandingDebit)} · Cr ${fmt(totals.outstandingCredit)}` },
    // Due Pending is shown NET of on-account — money already banked but tagged to no invoice.
    // Same treatment as the Outstanding card above: show the bridge instead of a bare number,
    // and let the deduction be opened into its invoices + the entries behind it.
    { label: "Due Pending",       value: fmt(totals.pending),     icon: TrendingDown,   warn: true,
      breakdown: totals.onAccount > 0 ? [
        { label: "Bills overdue / due", value: fmt(totals.pendingGross) },
        { label: "Less On Account", value: `−${fmt(totals.onAccount)}`,
          onClick: () => openDrill(allCustomerIds, "pending", "All customers") },
      ] : undefined },
    {
      label: "Collection %",
      value: collectionPct(totals) === null ? "—" : `${(collectionPct(totals) as number).toFixed(1)}%`,
      icon: Percent, warn: false,
    },
    // Only when there is a plan to report against — an empty "Planned ₹0 · 0% achieved" card
    // would read as a miss rather than as "nobody has planned this month yet".
    ...(showPlanCols && totals.planned > 0 ? [{
      label: plannedLabel,
      value: fmt(totals.planned),
      icon: Target,
      warn: false,
      sub: `${((totals.received / totals.planned) * 100).toFixed(1)}% of plan collected · ${fmt(planGap(totals))} to go`,
    }] : []),
  ];


  /**
   * A column header cell. The NAME carries the hover definition, and the cell carries the sort —
   * a four-word header on a management report is a headline, not a definition, and a column
   * nobody can define gets quoted wrong in a meeting. The tooltip sits on the label rather than
   * the whole cell so it doesn't fight click-to-sort.
   *
   * `banded` = this head sits in the second header row, under its section's banner, so it prints
   * the short name and drops the width/wrap rules meant for a top-level column.
   */
  const colHead = (col: SPCol, opts?: { rowSpan?: number; banded?: boolean; trailing?: ReactNode }) => {
    const sortable = col.sort !== undefined;
    const text = opts?.banded ? (col.short ?? col.label) : col.label;
    return (
      <TableHead
        rowSpan={opts?.rowSpan}
        className={[
          opts?.banded
            ? "text-xs font-medium text-foreground/60 whitespace-nowrap text-right"
            : `text-xs font-semibold text-foreground/70 leading-tight align-middle text-right ${col.wrap ? "" : "whitespace-nowrap"} ${col.width ?? ""}`,
          sortable ? "cursor-pointer select-none" : "",
          // Bannered or flat, the rule belongs on the first surviving column of the section.
          edgeFor(col),
        ].join(" ")}
        onClick={sortable ? () => toggleSort(col.sort!) : undefined}
      >
        <span className="inline-flex items-center gap-1 justify-end w-full">
          <HelpTooltip delayDuration={200}>
            <HelpTooltipTrigger asChild>
              <span className="cursor-help underline decoration-dotted decoration-foreground/25 underline-offset-4">
                {text}
              </span>
            </HelpTooltipTrigger>
            <HelpTooltipContent side="bottom" align="end" className="max-w-[280px] p-2.5 text-[11px] leading-relaxed font-normal text-left">
              <p className="font-semibold text-[12px] mb-1">{col.label}</p>
              <p>{col.help}</p>
            </HelpTooltipContent>
          </HelpTooltip>
          {sortable && sortIcon(col.sort!)}
          {opts?.trailing}
        </span>
      </TableHead>
    );
  };

  /* ── Frozen column (freeze pane) ───────────────────────────────────────────
     Excel-style: freeze the leading chevron + group-label column so the group name
     stays put while scrolling right. Each frozen cell is `position: sticky` with a
     cumulative `left` offset and an OPAQUE background; the label carries an edge shadow. */
  type FreezeId = "chevron" | "label";
  type FreezeStick = { className: string; style?: CSSProperties };
  const leftOf = (id: FreezeId): number => (id === "chevron" ? 0 : colW.chev);
  /** Sticky props for a leading column cell, or empty when freeze is off.
   *  `bg` is the OPAQUE background to use (defaults: header → muted, body → surface). */
  const freezeStick = (id: FreezeId, opts?: { header?: boolean; bg?: string }): FreezeStick => {
    if (freezeLevel < 1) return { className: "" };
    const bg = opts?.bg ?? (opts?.header ? "bg-muted" : "bg-surface");
    const shadow = id === "label" ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.18)]" : "";
    return { className: `sticky ${opts?.header ? "z-20" : "z-10"} ${bg} ${shadow}`, style: { left: leftOf(id) } };
  };
  /** Pin button in the label header — toggles the freeze on/off. */
  const freezePin = () => {
    const active = freezeLevel >= 1;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setFreezeLevel(active ? 0 : 1); }}
        className={`ml-1 inline-flex items-center justify-center h-4 w-4 rounded shrink-0 ${active ? "text-primary" : "text-foreground/35 hover:text-foreground/70"}`}
        title={active ? "Unfreeze the group column" : "Freeze the group column while scrolling"}
      >
        <Pin className={`h-3 w-3 ${active ? "fill-primary" : ""}`} />
      </button>
    );
  };

  /** The Planned cell. EDITABLE only where the row IS one customer — every other row is a
   *  roll-up of other people's plans, so a figure there is a subtotal, not a thing you can set.
   *  `planName` is null on those (and on the Grand Total). */
  const plannedCell = (c: CellCtx): ReactNode => {
    const { m, planName } = c;
    const editable = planName !== null && plans.canEdit();
    // A name that spans several ledgers is planned once, on the CARRIER row; its siblings show
    // "planned elsewhere" instead of an empty "Set", so the blank explains itself rather than
    // inviting a second, duplicate figure for the same customer.
    //
    // Test the PLAN, not the ledger count. Checking only "does this name have >1 ledger" marked
    // every multi-ledger customer as planned-elsewhere even when nobody had planned them at all
    // — which is most of them, and made the column read as full when it was empty.
    const carrierElsewhere =
      planName !== null
      && m.planned === 0
      && plans.plannedFor(selectedMonth, "customer", planName) > 0;
    return (
      <TableCell
        onClick={editable ? (e) => { e.stopPropagation(); setPlanTarget(planName); } : undefined}
        className={`${sz(c.strong)}${money} ${bd(c.strong)}border-l border-border ${editable ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
        title={
          carrierElsewhere
            ? `${planName} is planned once, on its main ledger row. Click to see or change that plan.`
            : editable
              ? `Set the planned collection for ${planName} in ${selectedMonth}`
              : "Rolled up from the customers below"
        }
      >
        {m.planned > 0
          ? fmt(m.planned)
          // A sibling ledger of a planned customer must NOT read "Set": the customer is
          // already planned, just carried on another row, and offering "Set" here reads as
          // "unplanned" and invites a second, duplicate figure.
          : carrierElsewhere
            ? <span className="text-[10px] font-normal opacity-50">planned elsewhere</span>
            : editable
              ? <span className="opacity-40">Set</span>
              : "—"}
        {/* Σ marks a figure you cannot edit here, so a read-only roll-up never looks like a
            cell someone forgot to fill in. */}
        {!editable && m.planned > 0 && <span className="ml-1 text-[10px] opacity-50">Σ</span>}
      </TableCell>
    );
  };

  /**
   * Every cell for one row — the Grand Total and any roll-up node alike, straight off `cols`.
   *
   * That the two share this function is the whole point: they must emit the same number of cells
   * in the same order as the header, and when those were three hand-written lists a single stray
   * cell put every money figure one column left of its own heading, silently.
   */
  const rowCells = (
    ctx: Omit<CellCtx, "edge">,
  ): ReactNode =>
    cols.map((col) => (
      <Fragment key={col.key}>{col.cell({ ...ctx, edge: edgeFor(col) })}</Fragment>
    ));

  /** Recursive roll-up rows; pagination/scope is whole-tree. depth-0 click also scopes the panel. */
  const renderNodes = (nodes: GroupNode<CM>[]): ReactNode =>
    nodes.map((n) => {
      const hasChildren = n.children.length > 0;
      const isOpen = expanded.has(n.key);
      const tint = n.depth === 0 ? "" : n.depth === 1 ? "bg-muted/20" : "bg-muted/10";
      const isSelected = n.depth === 0 && selectedNode?.label === n.label;
      // null on any node that isn't a customer / customer group — those can't be chased.
      const entity = entityOfNode(n);
      const latest = entity ? latestByEntity.get(entityKey(entity.type, entity.name)) : undefined;
      return (
        <Fragment key={n.key}>
          <TableRow
            className={`group transition-colors ${tint} ${isSelected ? "bg-primary/10" : hasChildren ? "cursor-pointer hover:bg-muted/40" : n.depth === 0 ? "cursor-pointer hover:bg-muted/30" : ""}`}
            onClick={() => {
              if (hasChildren) toggleExpand(n.key);
              if (n.depth === 0) setSelectedNode({ label: n.label, ids: n.ids });
            }}
          >
            {(() => { const f = freezeStick("chevron", { bg: "bg-surface group-hover:bg-[hsl(var(--muted))]" }); return (
              <TableCell style={f.style} className={`text-muted-foreground ${f.className}`}>
                {hasChildren && (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
              </TableCell>
            ); })()}
            {(() => { const f = freezeStick("label", { bg: "bg-surface group-hover:bg-[hsl(var(--muted))]" }); return (
              <TableCell
                style={{ ...f.style, paddingLeft: 8 + n.depth * 18 }}
                className={`align-top ${n.depth === 0 ? "font-medium text-sm" : "text-[13px] text-muted-foreground"} ${f.className}`}
              >
                {/* Capped on an INNER div — max-width on a <td> is ignored under
                    table-layout:auto. The cap shrinks with depth so the column stays ~LABEL_W
                    however deep the roll-up goes, and the sub-label sits on its OWN line so a
                    long "Company · Location" can never widen the column. */}
                <div style={{ maxWidth: LABEL_W - n.depth * 18 }} className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="truncate" title={n.label}>{n.label}</span>
                    {hasChildren && <span className="shrink-0 text-[11px] opacity-70">({n.children.length})</span>}
                    {entity && <FollowupRowAction latest={latest} onLog={() => setFollowupTarget(entity)} />}
                  </div>
                  {n.sub && (
                    <div className="truncate text-[10px] font-normal leading-tight opacity-70" title={n.sub}>
                      {n.sub}
                    </div>
                  )}
                </div>
              </TableCell>
            ); })()}
            {/* Plans are recorded at CUSTOMER level only, so only a customer node is editable —
                a group / salesperson / category row shows the roll-up of its customers' plans. */}
            {rowCells({
              m: n.metrics.m, mPrev: n.metrics.mPrev, ids: n.ids, label: n.label,
              strong: n.depth === 0,
              planName: entity?.type === "customer" ? entity.name : null,
              entity, latest,
            })}
          </TableRow>
          {isOpen && hasChildren && renderNodes(n.children)}
        </Fragment>
      );
    });

  // Empty-state colSpan: the chevron + the frozen label column, plus whatever the picker left on.
  const totalColCount = 2 + cols.length;
  // Noun for the top-level row count (the first group-by dimension, e.g. "salesperson").
  const groupByLabel = (C_DIMENSIONS.find((x) => x.key === groupBy[0])?.label ?? "group").toLowerCase();

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-button bg-primary/15 flex items-center justify-center">
            <HandCoins className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">Salesperson Collection Report</h1>
              {/* Same badge the topbar shows in Live mode. Repeated here because this report used to
                  ALSO exist as a separate "Collection Report (Tally Live)" menu item, and the two were
                  indistinguishable on screen — so the source is now called out on the report itself. */}
              {isLive && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 border border-emerald-300 rounded px-1.5 py-0.5">
                  Live · Tally
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {fyLabel} · {selectedMonth || "—"} · as on {formatDateLong(asOfDate)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* "Save my view" writes the layout to the user's profile, so the report opens on it
              next time — on any browser. See lib/reportPrefs.ts. */}
          <ColumnPicker
            columns={pickerOptions}
            visible={legalVisible}
            onChange={mergeVisible}
            onSave={() => colPrefs.save(visibleCols)}
            onResetSaved={async () => { await colPrefs.clear(); setVisibleCols(DEFAULT_COLS); }}
            hasSaved={colPrefs.saved !== null}
            saving={colPrefs.saving}
            saveError={colPrefs.error}
            triggerClassName="h-9 text-sm"
          />
          <Button variant="outline" size="sm" className="rounded-button border-border h-9" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export Excel
          </Button>
        </div>
      </div>

      {/* Group-by builder */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4">
          <GroupByBuilder dimensions={C_DIMENSIONS} presets={C_PRESETS} value={groupBy} onChange={setGroupBy} />
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Month</span>
              <Select value={selectedMonth} onValueChange={setMonthState}>
                <SelectTrigger className="w-[130px] rounded-input border-border text-sm h-9">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent className="rounded-input max-h-72">
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>{m}{m === asOfMonth ? " (current)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Company</span>
              <MultiSelect
                options={companyOptions}
                value={companies}
                onChange={setCompanies}
                allLabel="All Companies"
                noun="companies"
                triggerClassName="w-40 h-9 text-sm rounded-input border-border"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Location</span>
              <MultiSelect
                options={locationOptions}
                value={locations}
                onChange={setLocations}
                allLabel="All Locations"
                noun="locations"
                triggerClassName="w-40 h-9 text-sm rounded-input border-border"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Sales Person</span>
              <SalesPersonMultiSelect options={salesPersonOptions} value={salesPersons} onChange={setSalesPersons} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Customer Category</span>
              <CustomerCategoryMultiSelect value={categories} onChange={setCategories} triggerClassName="w-40 h-9 text-sm rounded-input border-border" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Customer Segment</span>
              <Select value={customerSegment} onValueChange={(v) => setCustomerSegment(v as "all" | "active" | "no_activity")}>
                <SelectTrigger className="w-40 rounded-input border-border h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-input">
                  <SelectItem value="all">All Customers</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="no_activity">No Activity</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Sale Type</span>
              <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} triggerClassName="w-40 h-9 text-sm rounded-input border-border" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[180px] max-w-xs">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Search Customer</span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search customer..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="pl-9 h-9 rounded-input border-border text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Financial Year</span>
              <span className="text-xs text-muted-foreground h-9 flex items-center px-1">
                {fyLabel} <span className="ml-1 opacity-60">(top bar)</span>
              </span>
            </div>
          </div>
          <FilterChips chips={filterChips} onClearAll={clearFilters} />
        </CardContent>
      </Card>

      {/* Reader remarks — how to read the Sales figures on this report */}
      <div className="rounded-card border border-amber-300/60 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2 text-[11px] leading-snug text-amber-900 dark:text-amber-200 space-y-0.5">
        <p><span className="font-semibold">Sales are inclusive of GST</span> — figures are the full invoice value the customer owes, not the taxable-only amount.</p>
        <p><span className="font-semibold">No outstanding = not listed</span> — only parties carrying an outstanding or due balance appear here. Fully-settled parties (and their sales) are excluded, so the Sales total is <span className="font-semibold">not</span> the company's total sales.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="rounded-card">
              <CardContent className="px-3 py-2">
                <div className="flex items-center gap-1 mb-0.5">
                  <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-[11px] text-muted-foreground leading-tight">{kpi.label}</span>
                </div>
                <p className={`text-sm font-bold ${kpi.warn ? "text-destructive" : "text-foreground"}`}>
                  {kpi.value}
                </p>
                {kpi.sub && <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{kpi.sub}</p>}
                {kpi.breakdown && (
                  <div className="mt-1 space-y-0.5 border-t border-border/60 pt-1">
                    {kpi.breakdown.map((b) => (
                      <div key={b.label} className="flex items-baseline justify-between gap-2 text-[10px] leading-tight">
                        <span className="text-muted-foreground">{b.label}</span>
                        {b.onClick ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); b.onClick!(); }}
                            className="font-mono underline decoration-dotted underline-offset-2 hover:text-foreground text-muted-foreground"
                          >
                            {b.value}
                          </button>
                        ) : (
                          <span className="font-mono text-muted-foreground">{b.value}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <details className="group -mt-3 text-[11px] text-muted-foreground">
        <summary className="flex items-center gap-1 cursor-pointer select-none list-none w-fit font-medium hover:text-foreground">
          <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
          How to read this report
        </summary>
        <ul className="mt-1.5 ml-4 space-y-1 list-disc leading-snug">
          <li><span className="font-medium">Total Outstanding ({selectedMonth || "this month"})</span> = the start-of-month balance = Outstanding (Today) + Received in {selectedMonth || "the month"} (this month's collections added back).</li>
          <li><span className="font-medium">Outstanding (Today)</span> = {isCurrentMonth ? `the live net balance as on ${formatDateLong(asOfDate)} — matches the dashboard.` : `the balance as on ${selectedMonth ? monthEndLong(selectedMonth) : "month-end"}.`}</li>
          <li>A <span className="font-medium">negative Total</span> just means that customer is sitting in advance (a credit balance) — not an error.</li>
          <li><span className="font-medium">Outstanding</span> = Net Debit (parties who owe) − Net Credit (parties sitting in advance).</li>
          <li><span className="font-medium">Due Pending</span> = overdue as on {formatDateLong(asOfDate)} (matches the dashboard) + bills coming due by {selectedMonth ? monthEndLong(selectedMonth) : "month-end"}. Due = Pending + Received.</li>
          <li><span className="font-medium">Received</span> = On Account (advance / unallocated) + Against Invoices; includes manual "other payments".</li>
          {showOnAccountCols ? (
            <li>
              <span className="font-medium">On Account</span> = money the customer has already paid us that is settling no
              open invoice — untagged receipts, machine advances and credit notes alike. It reduces the ledger balance but
              leaves every old bill reading unpaid, so both <span className="font-medium">{dueLabel}</span> and{" "}
              <span className="font-medium">Due Pending</span> are shown after deducting it — otherwise the report chases
              money already banked. Capped at each customer's own due, so Due Pending can never exceed their Outstanding.
              Click the "less On Account" line to see the invoices and the entries behind it.
            </li>
          ) : (
            <li>
              <span className="font-medium">On Account</span> is not deducted in this view
              {saleTypeActive
                ? " because a Sale Type filter is active — Outstanding carries no per-sale-type split, so the deduction would compare two different bases."
                : !isCurrentMonth
                ? " because past months carry monthly totals only, with no bill-wise detail to net against."
                : " on this data source — it is already netted upstream."}
            </li>
          )}
          <li>Use <span className="font-medium">Columns</span> at the top to choose what this table shows and to save that choice for yourself. Where you have picked a breakup under Received, Outstanding or Due Pending, the group's heading also carries a <span className="font-medium">+</span> / <span className="font-medium">−</span> that folds just that breakup out of the way while you read — it never adds or removes a column you didn't choose, and a reopened report shows everything you picked. Hover any column heading for a one-line definition. The Excel export follows whatever is on screen.</li>
        </ul>
      </details>

      {/* Main table */}
      <Card className="rounded-card border-border bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {sortedRoots.length} {groupByLabel}{sortedRoots.length !== 1 ? "s" : ""}
          </span>
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">Click a row to expand; the top level also scopes the Monthly analysis. <Plus className="h-3 w-3 inline" />/<Minus className="h-3 w-3 inline" /> on a group heading folds its breakup; the <Pin className="h-3 w-3 inline" /> on the group column freezes it while scrolling</span>
        </div>
        <ScrollableTable>
          <Table>
            <TableHeader>
              {/* Received, Outstanding and Due Pending each band their breakup under a banner —
                  but only while TWO or more of that section's columns are on. Leave one and it
                  renders as an ordinary column, which is exactly how the report looks by default. */}
              <TableRow className="bg-muted/50">
                <TableHead
                  ref={chevRef}
                  rowSpan={anyBanner ? 2 : 1}
                  style={freezeStick("chevron", { header: true }).style}
                  className={`w-8 ${freezeStick("chevron", { header: true }).className}`}
                />
                <TableHead
                  ref={spHeadRef}
                  rowSpan={anyBanner ? 2 : 1}
                  style={freezeStick("label", { header: true }).style}
                  className={`text-xs font-semibold text-foreground/70 align-bottom pb-2 cursor-pointer select-none ${freezeStick("label", { header: true }).className}`}
                  onClick={() => toggleSort("salesperson")}
                >
                  {/* Same cap as the body cells: a three-level chain ("Salesperson → Customer
                      Group → Customer Category") is long enough to widen the frozen column on
                      its own. The icons stay shrink-0 so only the text is ever clipped. */}
                  <span className="flex items-center gap-1" style={{ maxWidth: LABEL_W }}>
                    <span className="truncate" title={groupByChain}>{groupByChain}</span>
                    <span className="shrink-0 inline-flex items-center">{sortIcon("salesperson")}</span>
                    <span className="shrink-0 inline-flex items-center">{freezePin()}</span>
                  </span>
                </TableHead>
                {/* The +/− lives on the GROUP, once — on the banner while it is open, and on the
                    lone surviving column while it is shut. Never on the banded sub-heads below:
                    three buttons to fold one thing is noise. */}
                {headGroups.map((g) =>
                  g.kind === "banner" ? (
                    <TableHead
                      key={`banner:${g.section}`}
                      colSpan={g.cols.length}
                      className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border"
                    >
                      <span className="inline-flex items-center justify-center">
                        {SECTION_TITLE[g.section]}
                        {sectionToggle(g.section)}
                      </span>
                    </TableHead>
                  ) : (
                    <Fragment key={g.col.key}>
                      {colHead(g.col, {
                        rowSpan: anyBanner ? 2 : 1,
                        trailing: g.col.section ? sectionToggle(g.col.section) : undefined,
                      })}
                    </Fragment>
                  ),
                )}
              </TableRow>
              {anyBanner && (
                <TableRow className="bg-muted/50">
                  {headGroups.map((g) =>
                    g.kind === "banner"
                      ? g.cols.map((col) => <Fragment key={col.key}>{colHead(col, { banded: true })}</Fragment>)
                      : null,
                  )}
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {sortedRoots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={totalColCount} className="text-center py-12 text-muted-foreground">
                    No rows match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {/* Grand total row */}
                  <TableRow className="bg-muted/60 border-b-2 border-border/60 font-semibold">
                    <TableCell style={freezeStick("chevron", { bg: "bg-muted" }).style} className={freezeStick("chevron", { bg: "bg-muted" }).className} />
                    <TableCell style={freezeStick("label", { bg: "bg-muted" }).style} className={`text-sm whitespace-nowrap uppercase tracking-wide text-foreground/80 ${freezeStick("label", { bg: "bg-muted" }).className}`}>Grand Total</TableCell>
                    {rowCells({
                      m: totals, mPrev: totalsPrev, ids: allCustomerIds, label: "Grand Total",
                      strong: true, planName: null, entity: null, latest: undefined,
                    })}
                  </TableRow>
                  {renderNodes(sortedRoots)}
                </>
              )}
            </TableBody>
          </Table>
        </ScrollableTable>
      </Card>

      {/* Month-wise analysis panel — consolidated by default, or per selected top-level node */}
      {(() => {
        const scopeLabel = selectedNode?.label ?? "All rows";
        // Received is a FLOW → summable across months (= total collected over the period).
        // Outstanding / Due / Pending are point-in-time STOCKS → not summable; show the latest
        // (current) month. (Summing them would double-count the same open balance every month.)
        const sumReceived = monthlyData.reduce((s, d) => s + d.received, 0);
        const sumOnAccount = monthlyData.reduce((s, d) => s + d.receivedOnAccount, 0);
        const sumAgainst = monthlyData.reduce((s, d) => s + d.receivedAgainst, 0);
        const latest = monthlyData[monthlyData.length - 1];
        const latestPct = latest ? collectionPct(latest) : null;
        // `planned` rides Metrics, so monthlyData already carries it per month — the series is
        // free. Only plotted where some month actually has a plan, so an unplanned FY doesn't
        // gain a flat zero line pretending to be data.
        const anyPlanned = showPlanCols && monthlyData.some((d) => d.planned > 0);
        const chartData = monthlyData.map((d) => ({
          month: d.month,
          Due: d.due,
          Received: d.received,
          Pending: d.pending,
          ...(anyPlanned ? { Planned: d.planned } : {}),
          "Collection %": collectionPct(d) ?? 0,
        }));
        return (
          <Card ref={panelRef} className="rounded-card border-border bg-surface overflow-hidden scroll-mt-4">
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <BarChart3 className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
                  Monthly analysis — {scopeLabel}
                </span>
              </div>
              {selectedNode && (
                <Button
                  variant="ghost" size="sm"
                  className="h-7 px-2 text-xs rounded-button text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => setSelectedNode(null)}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Show all
                </Button>
              )}
            </div>

            {/* Chart */}
            <div className="p-4 border-b border-border">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => `${(v / 10000000).toFixed(1)}`}
                    label={{ value: "₹ Cr", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === "Collection %" ? `${value.toFixed(1)}%` : fmt(value)
                    }
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="left"  type="monotone" dataKey="Due"      stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={{ r: 2 }} />
                  <Line yAxisId="left"  type="monotone" dataKey="Received" stroke="hsl(142, 71%, 45%)" strokeWidth={2} dot={{ r: 2 }} />
                  <Line yAxisId="left"  type="monotone" dataKey="Pending"  stroke="hsl(0, 84%, 60%)"  strokeWidth={2} dot={{ r: 2 }} />
                  {anyPlanned && (
                    <Line yAxisId="left" type="monotone" dataKey="Planned" stroke="hsl(271, 76%, 53%)" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2 }} />
                  )}
                  <Line yAxisId="right" type="monotone" dataKey="Collection %" stroke="hsl(28, 80%, 52%)" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Month table */}
            <ScrollableTable>
              <Table>
                <TableHeader>
                  {/* This panel follows the main table's Received / Due Pending breakups — turn
                      them on with Columns above and they band here too. */}
                  <TableRow className="bg-muted/50">
                    <TableHead rowSpan={panelBanner ? 2 : 1} className="text-xs font-semibold text-foreground/70 whitespace-nowrap">Month</TableHead>
                    <TableHead rowSpan={panelBanner ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap">Opening</TableHead>
                    <TableHead rowSpan={panelBanner ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap">Closing</TableHead>
                    <TableHead rowSpan={panelBanner ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap">Due</TableHead>
                    {panelReceived ? (
                      <TableHead colSpan={3} className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border">
                        Received
                      </TableHead>
                    ) : (
                      <TableHead rowSpan={panelBanner ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap border-l border-border">
                        Received
                      </TableHead>
                    )}
                    {panelPending ? (
                      <TableHead colSpan={3} className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border">
                        Pending
                      </TableHead>
                    ) : (
                      <TableHead rowSpan={panelBanner ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap border-l border-border">
                        Pending
                      </TableHead>
                    )}
                    <TableHead rowSpan={panelBanner ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap">Collection %</TableHead>
                  </TableRow>
                  {panelBanner && (
                    <TableRow className="bg-muted/50">
                      {panelReceived && <>
                        <TableHead className="text-xs font-medium text-foreground/60 text-right whitespace-nowrap border-l border-border">On Account</TableHead>
                        <TableHead className="text-xs font-medium text-foreground/60 text-right whitespace-nowrap">Against Invoices</TableHead>
                        <TableHead className="text-xs font-medium text-foreground/60 text-right whitespace-nowrap">Total</TableHead>
                      </>}
                      {panelPending && <>
                        <TableHead className="text-xs font-medium text-foreground/60 text-right whitespace-nowrap border-l border-border">{pendingNowLabel}</TableHead>
                        <TableHead className="text-xs font-medium text-foreground/60 text-right whitespace-nowrap">{pendingTillLabel}</TableHead>
                        <TableHead className="text-xs font-medium text-foreground/60 text-right whitespace-nowrap">Total</TableHead>
                      </>}
                    </TableRow>
                  )}
                </TableHeader>
                <TableBody>
                  {monthlyData.map((d) => {
                    const pct = collectionPct(d);
                    return (
                      <TableRow key={d.month} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="text-sm font-medium whitespace-nowrap">{d.month}</TableCell>
                        <TableCell className="text-sm text-right font-mono">{fmt(startMonthOutstanding(d))}</TableCell>
                        <TableCell className="text-sm text-right font-mono">{fmt(d.outstanding)}</TableCell>
                        <TableCell className="text-sm text-right font-mono">{fmt(d.due)}</TableCell>
                        {panelReceived && <>
                          <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(d.receivedOnAccount)}</TableCell>
                          <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(d.receivedAgainst)}</TableCell>
                        </>}
                        <TableCell className="text-sm text-right font-mono">{fmt(d.received)}</TableCell>
                        {panelPending && <>
                          <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(d.pending - d.dueSoon)}</TableCell>
                          <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(d.dueSoon)}</TableCell>
                        </>}
                        <TableCell className={`text-sm text-right font-mono ${d.pending > 0 ? "text-destructive" : ""}`}>{fmt(d.pending)}</TableCell>
                        <TableCell className={`text-sm text-right font-mono ${pctStyle(pct)}`}>
                          {pct === null ? "—" : `${pct.toFixed(1)}%`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {monthlyData.length > 0 && (
                    <TableRow className="bg-muted/60 border-t-2 border-border/60 font-semibold">
                      <TableCell className="text-sm uppercase tracking-wide text-foreground/80">Total</TableCell>
                      <TableCell className="text-sm text-right font-mono">{latest ? fmt(startMonthOutstanding(latest)) : "—"}</TableCell>
                      <TableCell className="text-sm text-right font-mono">{latest ? fmt(latest.outstanding) : "—"}</TableCell>
                      <TableCell className="text-sm text-right font-mono">{latest ? fmt(latest.due) : "—"}</TableCell>
                      {panelReceived && <>
                        <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(sumOnAccount)}</TableCell>
                        <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(sumAgainst)}</TableCell>
                      </>}
                      <TableCell className="text-sm text-right font-mono">{fmt(sumReceived)}</TableCell>
                      {panelPending && <>
                        <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt((latest?.pending ?? 0) - (latest?.dueSoon ?? 0))}</TableCell>
                        <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(latest?.dueSoon ?? 0)}</TableCell>
                      </>}
                      <TableCell className={`text-sm text-right font-mono ${(latest?.pending ?? 0) > 0 ? "text-destructive" : ""}`}>{fmt(latest?.pending ?? 0)}</TableCell>
                      <TableCell className={`text-sm text-right font-mono ${pctStyle(latestPct)}`}>
                        {latestPct === null ? "—" : `${latestPct.toFixed(1)}%`}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollableTable>
            <div className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border">
              Opening = start-of-month balance (always ≥ Due, the part of it due by month-end); Closing = month-end balance (the latest month shows the live as-on-today balance); Pending = Due − Received.
              Total row: Received = total collected across the months shown; Opening, Closing, Due, Pending &amp; Collection % = latest month ({latest?.month ?? "—"}) — balances aren't summed across months as they'd double-count.
            </div>
          </Card>
        );
      })()}

      {/* Invoice drill-down popup */}
      <InvoiceDrilldownDialog
        open={drill !== null}
        onOpenChange={(o) => { if (!o) setDrill(null); }}
        title={drill?.title ?? ""}
        subtitle={drill?.subtitle ?? ""}
        rows={drill?.rows ?? []}
        ledgerFigures={drill?.ledgerFigures}
        asOfDate={asOfDate}
      />

      {/* Log a follow-up straight from the roll-up. The entity follows the row: a customer leaf
          logs against the customer, a Customer-Group node against the group.
          NOTE the log is keyed on the consolidated customer NAME while this table buckets per
          LEDGER (name|||company|||location) — so a name present in two companies shows the SAME
          follow-up on both rows. That is correct: there is one conversation with that customer.
          Do not "fix" it into per-ledger follow-ups; that would fork the log. */}
      {followupTarget && (
        <FollowupModal
          open={!!followupTarget}
          onOpenChange={(o) => { if (!o) setFollowupTarget(null); }}
          entityType={followupTarget.type}
          entityName={followupTarget.name}
        />
      )}

      {/* Set / revise the planned collection for one customer in the selected month.
          Due and Received are passed IN: they come from this page's metricsForMonth, which no
          hook can reach. Summed across every ledger of the name, because the plan covers the
          customer as a whole, not the one ledger whose row was clicked. */}
      {planTarget && (() => {
        const ledgers = activeRows.filter((c) => c.name === planTarget);
        const agg = emptyMetrics();
        for (const c of ledgers) addInto(agg, customerMetrics.get(c.id) ?? emptyMetrics());
        return (
          <CollectionPlanModal
            open={!!planTarget}
            onOpenChange={(o) => { if (!o) setPlanTarget(null); }}
            month={selectedMonth}
            entityName={planTarget}
            isCurrentMonth={isCurrentMonth}
            dueThisMonth={agg.due}
            receivedThisMonth={agg.received}
            outstanding={agg.outstanding}
            salesperson={ledgers[0] ? spName(ledgers[0].salesPerson) : null}
            multiLedger={ledgers.length > 1}
            plans={plans}
          />
        );
      })()}

      {/* "Less advances & credits" — the ledgers netted off the Outstanding figure */}
      <Dialog
        open={creditDrill}
        onOpenChange={(o) => { setCreditDrill(o); if (o) setCreditOpenGroups(new Set()); }}
      >
        {/* Cap the dialog to the viewport and let ONLY the table scroll, so the header stays put
            and the footnote never falls off the bottom. DialogContent's base style has no height
            limit, so without this a long list overflows the screen in both directions. */}
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-base">Advances &amp; credit balances</DialogTitle>
            <DialogDescription className="text-xs">
              {creditLedgers.count} ledger(s) in net credit, totalling {fmt(creditLedgers.total)}, subtracted from
              Outstanding. Grouped by their Tally group. These are parties whose money you hold — machine
              advances, related-party balances, customer advances — not amounts owed to you.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-3 text-[11px]">
            <button
              type="button"
              className="underline decoration-dotted underline-offset-2 text-muted-foreground hover:text-foreground"
              onClick={() => setCreditOpenGroups(new Set(creditLedgers.groups.map((g) => g.group)))}
            >
              Expand all
            </button>
            <button
              type="button"
              className="underline decoration-dotted underline-offset-2 text-muted-foreground hover:text-foreground"
              onClick={() => setCreditOpenGroups(new Set())}
            >
              Collapse all
            </button>
          </div>
          {/* ScrollableTable's `maxHeight` is a CLASS NAME, not a CSS length (it is interpolated
              straight into className) — so it must be a Tailwind max-h-* utility. Cap it here
              rather than via flex: the component wraps its scroll div in an outer container, so a
              `flex-1 min-h-0` passed through className lands on the inner div and never resolves
              to a height — which leaves the list unconstrained and unscrollable. */}
          <ScrollableTable maxHeight="max-h-[60vh]" className="rounded-card border border-border">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="text-xs">Ledger</TableHead>
                  <TableHead className="text-xs">Company</TableHead>
                  <TableHead className="text-xs text-right">Credit balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditLedgers.groups.map((g) => {
                  const open = creditOpenGroups.has(g.group);
                  return (
                    <Fragment key={g.group}>
                      <TableRow
                        className="bg-muted/50 cursor-pointer hover:bg-muted"
                        onClick={() => setCreditOpenGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.group)) next.delete(g.group); else next.add(g.group);
                          return next;
                        })}
                      >
                        <TableCell colSpan={2} className="text-xs font-semibold">
                          <span className="inline-flex items-center gap-1">
                            <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
                            {g.group}
                            <span className="font-normal text-muted-foreground">
                              ({g.rows.length} ledger{g.rows.length === 1 ? "" : "s"})
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono font-semibold">{fmt(g.total)}</TableCell>
                      </TableRow>
                      {open && g.rows.map((r) => (
                        <TableRow key={`${g.group}|${r.name}|${r.company}`}>
                          <TableCell className="text-xs pl-7">{r.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.company}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{fmt(r.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  );
                })}
                {creditLedgers.count === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-xs text-muted-foreground text-center py-6">
                      No ledgers in credit for the current filters.
                    </TableCell>
                  </TableRow>
                )}
                {/* Total stays visible while scrolling — it is the figure this popup exists to
                    explain, and it must tie exactly to the card's "Less advances & credits" line. */}
                {creditLedgers.count > 0 && (
                  <TableRow className="sticky bottom-0 bg-background border-t-2 border-border hover:bg-background">
                    <TableCell colSpan={2} className="text-xs font-semibold">
                      Total — {creditLedgers.count} ledger(s) across {creditLedgers.groups.length} group(s)
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{fmt(creditLedgers.total)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollableTable>
          <p className="text-[11px] text-muted-foreground shrink-0">
            Why this matters: the default pipeline source excludes these ledgers entirely, so its Outstanding
            is higher by roughly this amount. Neither figure is wrong — they count different things.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
