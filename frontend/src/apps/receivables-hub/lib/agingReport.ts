import type { Customer, CustomerDetail, CustomerGroupMap, Invoice, SaleType } from "./types";
import { EMPTY_GROUP_MAP, groupEntryOf } from "./customerGroups";

/**
 * Aging Report aggregation — pure, UI-free.
 *
 * Models the manual "CUSTOMER REPORT.xlsx" pivot directly off the live bill list.
 * Each open bill (an Invoice with non-zero pending) is read through TWO lenses:
 *
 *   • Outstanding — bucketed by INVOICE AGE (days since the bill date, measured
 *     against the data's as-of date): "< 180" / "> 180" (≥180), summing to
 *     Total Outstanding. Covers every open bill (due or not-yet-due).
 *
 *   • Overdue — bucketed by OVERDUE DAYS (days past the due date, already
 *     computed in the pipeline as invoice.overdueDays): 0-30 / 31-60 / 61-90 /
 *     91-120 / 121-180 / 180+, summing to Total Overdue. Covers only the
 *     past-due subset, so Total Overdue ≤ Total Outstanding.
 *
 * Amounts are BILL-WISE / GROSS (sum of invoice.pending), matching the Excel —
 * this can differ slightly from the dashboard's NET totalOutstanding (advances /
 * on-account credits / opening-balance effects). That is a known pipeline-basis
 * difference, not a bug.
 *
 * Bills are then grouped by an ordered list of dimensions (e.g. ["saleType"] or
 * ["saleType", "customer"]) into a roll-up tree with subtotals at every level.
 * The same bill list also backs the invoice drill-down (see enumerateBills +
 * billMatchesPath / billMatchesColumn).
 */

/* ── Dimensions ────────────────────────────────────────────────────────────── */

export type AgingDimension = "saleType" | "customer" | "group" | "salesperson" | "category" | "company" | "location";

export const DIMENSION_LABELS: Record<AgingDimension, string> = {
  saleType: "Sale Type",
  customer: "Customer",
  group: "Customer Group",
  salesperson: "Salesperson",
  category: "Customer Category",
  company: "Company",
  location: "Location",
};

/** Order in which dimensions are offered in the group-by builder. */
export const DIMENSION_ORDER: AgingDimension[] = [
  "saleType",
  "customer",
  "group",
  "salesperson",
  "category",
  "company",
  "location",
];

const SALE_TYPE_LABEL: Record<SaleType, string> = {
  ink: "Ink",
  spare_parts: "Spare Parts",
  machine: "Machine",
  head: "Head",
  other: "Other",
};

/** Single-value customer-category label for the group-by (blank → Uncategorized). */
function categoryLabel(category: string): string {
  return category && category.trim() ? category : "Uncategorized";
}

/* ── Metrics & columns ─────────────────────────────────────────────────────── */

export interface AgingMetrics {
  /** Outstanding POSITIVE bills, invoice age < 180 days. */
  outLt180: number;
  /** Outstanding POSITIVE bills, invoice age ≥ 180 days. */
  outGe180: number;
  /** On-account / advance credits (sum of NEGATIVE-pending bills) — a credit, so ≤ 0. */
  onAccount: number;
  /** Ledger reconciliation — the part of the NET ledger balance NOT carried by any real
   *  bill (advances with no bill line, cheque returns not re-opened, opening residue,
   *  bill-wise sync gaps). Makes the row tie to the net ledger; ≈ 0 for clean customers. */
  unbilledAdj: number;
  /** Total outstanding (NET ledger = outLt180 + outGe180 + onAccount + unbilledAdj). Ties to
   *  the dashboard / Salesperson Collection Report's "Outstanding (Today)". */
  totalOutstanding: number;
  od_0_30: number;
  od_31_60: number;
  od_61_90: number;
  od_91_120: number;
  od_121_180: number;
  od_180_plus: number;
  /** Subtotal of the 0-120 day overdue buckets (0-30 + 31-60 + 61-90 + 91-120). */
  od_0_120: number;
  /** Subtotal of the 120+ day overdue range (121-180 + 180+). */
  od_120_plus: number;
  /** Total overdue (sum of the six overdue brackets). */
  totalOverdue: number;
  /** Number of open bills rolled into this node. */
  billCount: number;
}

export type MetricKey =
  | "outLt180"
  | "outGe180"
  | "onAccount"
  | "unbilledAdj"
  | "totalOutstanding"
  | "od_0_30"
  | "od_31_60"
  | "od_61_90"
  | "od_91_120"
  | "od_0_120"
  | "od_121_180"
  | "od_180_plus"
  | "od_120_plus"
  | "totalOverdue";

export interface AgingColumn {
  key: MetricKey;
  label: string;
  group: "outstanding" | "overdue";
  /** Interim subtotal column (lighter highlight). */
  total?: boolean;
  /** Grand-total column (Total Outstanding / Total Overdue) — stronger, distinct highlight. */
  grand?: boolean;
}

/** The numeric columns, in display order (Outstanding lens then Overdue lens). */
export const AGING_COLUMNS: AgingColumn[] = [
  { key: "outLt180", label: "Out < 180", group: "outstanding" },
  { key: "outGe180", label: "Out > 180", group: "outstanding" },
  { key: "onAccount", label: "On Account", group: "outstanding" },
  { key: "unbilledAdj", label: "Unbilled Adj.", group: "outstanding" },
  { key: "totalOutstanding", label: "Total Outstanding", group: "outstanding", total: true, grand: true },
  { key: "od_0_30", label: "0-30", group: "overdue" },
  { key: "od_31_60", label: "31-60", group: "overdue" },
  { key: "od_61_90", label: "61-90", group: "overdue" },
  { key: "od_91_120", label: "91-120", group: "overdue" },
  { key: "od_0_120", label: "Total 0-120", group: "overdue", total: true },
  { key: "od_121_180", label: "121-180", group: "overdue" },
  { key: "od_180_plus", label: "180+", group: "overdue" },
  { key: "od_120_plus", label: "Total 120+", group: "overdue", total: true },
  { key: "totalOverdue", label: "Total Overdue", group: "overdue", total: true, grand: true },
];

function emptyMetrics(): AgingMetrics {
  return {
    outLt180: 0,
    outGe180: 0,
    onAccount: 0,
    unbilledAdj: 0,
    totalOutstanding: 0,
    od_0_30: 0,
    od_31_60: 0,
    od_61_90: 0,
    od_91_120: 0,
    od_121_180: 0,
    od_180_plus: 0,
    od_0_120: 0,
    od_120_plus: 0,
    totalOverdue: 0,
    billCount: 0,
  };
}

/* ── Bucket helpers ────────────────────────────────────────────────────────── */

export type OverdueKey =
  | "od_0_30"
  | "od_31_60"
  | "od_61_90"
  | "od_91_120"
  | "od_121_180"
  | "od_180_plus";

/** Parse "YYYY-MM-DD" (or an ISO datetime) to a UTC epoch (ms), or null. */
function parseDay(s: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? "").trim());
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

/** Whole days between two dates (to − from); 0 if either is unparseable. */
function daysBetween(fromISO: string, toISO: string): number {
  const a = parseDay(fromISO);
  const b = parseDay(toISO);
  if (a == null || b == null) return 0;
  return Math.floor((b - a) / 86_400_000);
}

/**
 * Overdue-days bracket — mirrors the dashboard's boundaries
 * (see useAppData aging computation). Returns null when the bill is not past
 * due (overdueDays ≤ 0), so it contributes to Outstanding but not Overdue.
 */
function overdueBucket(overdueDays: number): OverdueKey | null {
  if (overdueDays <= 0) return null;
  if (overdueDays <= 30) return "od_0_30";
  if (overdueDays <= 60) return "od_31_60";
  if (overdueDays <= 90) return "od_61_90";
  if (overdueDays <= 120) return "od_91_120";
  if (overdueDays <= 180) return "od_121_180";
  return "od_180_plus";
}

/* ── Bill enumeration (single source of truth) ─────────────────────────────── */

/** One open bill, joined to its customer and pre-bucketed for both lenses. */
export interface EnrichedBill {
  inv: Invoice;
  cust: Customer;
  ageGe180: boolean;
  overdueKey: OverdueKey | null;
  dims: Record<AgingDimension, string>;
  /** True for a synthetic ledger-reconciliation line (see ledgerAdjBill) — the part of
   *  the customer's NET ledger balance not carried by any real bill. Routed to the
   *  "Unbilled Adj." column, never the age / on-account / overdue buckets. */
  isLedgerAdj?: boolean;
}

export interface AgingFilters {
  companies?: string[];
  locations?: string[];
  salespersons?: string[];
  saleTypes?: SaleType[];
  /** Filter to these exact customer (ledger) display names. */
  customerNames?: string[];
}

/** Field separator for composite dimension keys (kept out of any real value). */
const KEY_SEP = " ||| ";

function dimsForCustomer(
  c: Customer,
  saleType: SaleType,
  groupMap: CustomerGroupMap,
): Record<AgingDimension, string> {
  // Per-ledger granularity for both customer lenses: every distinct ledger
  // (name + company + location) is its own row, so the same display name never
  // clubs across companies OR locations.
  const perLedger = `${c.name || "—"}${KEY_SEP}${c.company || "—"}${KEY_SEP}${c.location || "—"}`;
  return {
    saleType: SALE_TYPE_LABEL[saleType] ?? saleType,
    customer: perLedger,
    // Mapped customer-groups roll up deliberately (may span companies); unmapped
    // names fall back to the per-ledger key so same-name ledgers stay split.
    group: groupEntryOf(c, groupMap) || perLedger,
    salesperson: c.salesPerson || "Unassigned",
    category: categoryLabel(c.category),
    company: c.company || "—",
    location: c.location || "—",
  };
}

/** Display name + optional sub-label (e.g. "O-tec · Surat") for a grouped node. */
function nodeDisplay(dim: AgingDimension, keyValue: string, sample: EnrichedBill): { label: string; sub?: string } {
  // Customer rows, and unmapped customer-group rows (composite per-ledger key),
  // show the name with company · location as a sub-label so the split is visible.
  if (dim === "customer" || (dim === "group" && keyValue.includes(KEY_SEP))) {
    const sub = [sample.cust.company, sample.cust.location].filter(Boolean).join(" · ");
    return { label: sample.cust.name || "—", sub: sub || undefined };
  }
  return { label: keyValue };
}

function inFilter(list: string[] | undefined, value: string): boolean {
  return !list || list.length === 0 || list.includes(value);
}

/**
 * Flatten every (scoped) customer's invoices into the open-bill list, applying
 * the dimension filters. This is the single pass that backs both the tree and
 * the invoice drill-down, so the two can never disagree.
 */
export function enumerateBills(
  customers: Customer[],
  customerDetail: Record<string, CustomerDetail>,
  asOfDate: string,
  filters: AgingFilters = {},
  /** customer name → parent group name (customer_groups.json). Unmapped = own group. */
  groupMap: CustomerGroupMap = EMPTY_GROUP_MAP,
): EnrichedBill[] {
  const byId = new Map<string, Customer>();
  for (const c of customers) byId.set(c.id, c);

  const bills: EnrichedBill[] = [];
  for (const [cid, detail] of Object.entries(customerDetail)) {
    const cust = byId.get(cid);
    if (!cust) continue; // out of scope / filtered out upstream
    if (!inFilter(filters.companies, cust.company)) continue;
    if (!inFilter(filters.locations, cust.location)) continue;
    if (!inFilter(filters.salespersons, cust.salesPerson)) continue;
    if (!inFilter(filters.customerNames, cust.name)) continue;

    for (const inv of detail.invoices) {
      if (Math.abs(inv.pending) < 0.5) continue; // settled bill
      if (filters.saleTypes && filters.saleTypes.length > 0 && !filters.saleTypes.includes(inv.voucherType)) {
        continue;
      }
      const age = daysBetween(inv.date, asOfDate);
      bills.push({
        inv,
        cust,
        ageGe180: age >= 180,
        overdueKey: overdueBucket(inv.overdueDays),
        dims: dimsForCustomer(cust, inv.voucherType, groupMap),
      });
    }
  }
  return bills;
}

/**
 * Synthesize a LEDGER-RECONCILIATION line for a customer, carrying `amount` = the part of
 * their NET ledger balance (customer.outstanding) NOT represented by any real bill:
 *   amount = c.outstanding − Σ(that customer's real bill pending)
 *
 * Adding one per customer makes every row's Total Outstanding equal the net ledger balance —
 * so the Aging Report ties EXACTLY to the dashboard / Salesperson Collection Report's
 * "Outstanding (Today)". It absorbs everything the bill-wise list can't represent: advances
 * with no bill line, cheque returns that didn't re-open a bill, opening-balance residue, and
 * bill-wise sync gaps / duplicates. Routed to the dedicated "Unbilled Adj." column (flagged
 * isLedgerAdj) so it never distorts the age / on-account / overdue buckets. Sale type "other"
 * (a net adjustment belongs to no product).
 */
export function ledgerAdjBill(
  c: Customer,
  amount: number,
  groupMap: CustomerGroupMap = EMPTY_GROUP_MAP,
): EnrichedBill {
  const inv: Invoice = {
    id: `__ledgeradj__${c.id}`,
    number: "Net ledger balance not on any open bill",
    billRefName: "",
    billType: "",
    date: "",
    amount: 0,
    receiptAdj: 0,
    creditNoteAdj: 0,
    debitNoteAdj: 0,
    journalAdj: 0,
    otherPaymentAdj: 0,
    pending: amount, // + (receivable not on a bill) or − (credit not on a bill)
    dueDate: "",
    overdueDays: 0,
    status: "pending",
    voucherType: "other",
    isCarryforward: false,
  };
  return {
    inv,
    cust: c,
    ageGe180: false,
    overdueKey: null,
    isLedgerAdj: true,
    dims: dimsForCustomer(c, "other", groupMap),
  };
}

/* ── Drill-down matchers ───────────────────────────────────────────────────── */

export interface PathSegment {
  dim: AgingDimension;
  value: string;
}

/** True if a bill belongs to a node identified by its dimension path. */
export function billMatchesPath(b: EnrichedBill, path: PathSegment[]): boolean {
  return path.every((p) => (b.dims[p.dim] || "—") === p.value);
}

/** True if a bill contributes to a given metric column (the clicked lens). */
export function billMatchesColumn(b: EnrichedBill, col: MetricKey): boolean {
  switch (col) {
    case "outLt180":
      return !b.isLedgerAdj && b.inv.pending > 0 && !b.ageGe180;
    case "outGe180":
      return !b.isLedgerAdj && b.inv.pending > 0 && b.ageGe180;
    case "onAccount":
      return !b.isLedgerAdj && b.inv.pending < 0;
    case "unbilledAdj":
      return b.isLedgerAdj === true;
    case "totalOutstanding":
      return true;
    case "totalOverdue":
      return b.overdueKey !== null;
    case "od_0_120":
      return (
        b.overdueKey === "od_0_30" ||
        b.overdueKey === "od_31_60" ||
        b.overdueKey === "od_61_90" ||
        b.overdueKey === "od_91_120"
      );
    case "od_120_plus":
      return b.overdueKey === "od_121_180" || b.overdueKey === "od_180_plus";
    default:
      return b.overdueKey === col; // a single od_* bracket
  }
}

/* ── Tree ──────────────────────────────────────────────────────────────────── */

export interface AgingNode {
  /** Unique key within the whole tree (path of labels). */
  key: string;
  label: string;
  /** Optional secondary label (e.g. "O-tec · Surat" for an individual ledger). */
  sub?: string;
  /** 0 for top-level rows, +1 per nesting level. */
  depth: number;
  /** Dimension path from root to this node (drives the drill-down). */
  path: PathSegment[];
  metrics: AgingMetrics;
  children: AgingNode[];
  /** Distinct backing customer ids. */
  customerIds: string[];
  /** True for the synthetic On Account (advances) roll-up row. */
  isOnAccount?: boolean;
}

export interface AgingTree {
  roots: AgingNode[];
  /**
   * Synthetic "On Account (advances)" row — every on-account / unallocated-receipt
   * credit (a bill with negative pending), aggregated into one line so the normal
   * rows stay positive. Mirrors the source workbook's separate ON ACCOUNT product.
   * Null when there are no such credits in the filtered set.
   */
  onAccount: AgingNode | null;
  total: AgingMetrics;
  totalCustomerIds: string[];
  /** As-of date used for invoice-age bucketing (echoed for display/export). */
  asOfDate: string;
}

function addBill(m: AgingMetrics, b: EnrichedBill): void {
  const p = b.inv.pending;
  // Ledger-reconciliation lines go to their own column (not a real bill, no age/overdue).
  // Otherwise positive bills bucket by invoice age, and on-account / advance credits
  // (negative pending) go to the On Account column — so a row nets to its true Total
  // Outstanding (= Out<180 + Out>180 + On Account + Unbilled Adj) without a separate row.
  if (b.isLedgerAdj) {
    m.unbilledAdj += p;
  } else if (p < 0) {
    m.onAccount += p;
  } else if (b.ageGe180) {
    m.outGe180 += p;
  } else {
    m.outLt180 += p;
  }
  m.totalOutstanding += p;
  if (!b.isLedgerAdj && p > 0 && b.overdueKey) {
    m[b.overdueKey] += p;
    m.totalOverdue += p;
    if (b.overdueKey !== "od_121_180" && b.overdueKey !== "od_180_plus") m.od_0_120 += p;
    else m.od_120_plus += p; // 121-180 and 180+
  }
  if (!b.isLedgerAdj) m.billCount += 1;
}

/**
 * Build the grouped aging roll-up from a pre-enumerated bill list (see
 * enumerateBills). Parent metrics are the sum of their bills; every level (and
 * the grand total) is computed in the same pass.
 */
export function buildAgingTree(
  bills: EnrichedBill[],
  groupBy: AgingDimension[],
  asOfDate: string,
): AgingTree {
  // Grand total spans every bill (stays NET, including on-account credits).
  const total = emptyMetrics();
  const totalIds = new Set<string>();
  for (const b of bills) {
    addBill(total, b);
    totalIds.add(b.cust.id);
  }

  // On-account / advance credits (negative pending) now live in their own column
  // (AgingMetrics.onAccount), so every row carries both its positive bills and its
  // advances and nets to its true Total Outstanding — no separate On Account row.
  const dims = groupBy.length > 0 ? groupBy : (["saleType"] as AgingDimension[]);
  const roots = groupBills(bills, dims, 0, "", []);

  return { roots, onAccount: null, total, totalCustomerIds: [...totalIds], asOfDate };
}

function groupBills(
  bills: EnrichedBill[],
  dims: AgingDimension[],
  depth: number,
  prefix: string,
  parentPath: PathSegment[],
): AgingNode[] {
  if (dims.length === 0) return [];
  const dim = dims[0];
  const rest = dims.slice(1);

  const buckets = new Map<string, EnrichedBill[]>();
  for (const b of bills) {
    const label = b.dims[dim] || "—";
    const arr = buckets.get(label);
    if (arr) arr.push(b);
    else buckets.set(label, [b]);
  }

  const nodes: AgingNode[] = [];
  for (const [keyValue, group] of buckets) {
    const metrics = emptyMetrics();
    const ids = new Set<string>();
    for (const b of group) {
      addBill(metrics, b);
      ids.add(b.cust.id);
    }
    const key = `${prefix}/${keyValue}`;
    const path = [...parentPath, { dim, value: keyValue }];
    const { label, sub } = nodeDisplay(dim, keyValue, group[0]);
    nodes.push({
      key,
      label,
      sub,
      depth,
      path,
      metrics,
      customerIds: [...ids],
      children: groupBills(group, rest, depth + 1, key, path),
    });
  }

  // Biggest outstanding first (matches the Excel pivot ordering).
  nodes.sort((a, b) => b.metrics.totalOutstanding - a.metrics.totalOutstanding);
  return nodes;
}

/* ── Export flattening ─────────────────────────────────────────────────────── */

export type RowTier = "detail" | "subtotal" | "onaccount" | "grand";

export interface FlatAgingRow {
  depth: number;
  label: string;
  metrics: AgingMetrics;
  tier: RowTier;
}

/** Pre-order flatten of the tree (parents before children) for spreadsheet export. */
export function flattenForExport(tree: AgingTree): FlatAgingRow[] {
  const rows: FlatAgingRow[] = [];
  const walk = (nodes: AgingNode[]) => {
    for (const n of nodes) {
      rows.push({
        depth: n.depth,
        label: n.sub ? `${n.label} (${n.sub})` : n.label,
        metrics: n.metrics,
        // Top-level rows are the category subtotals; nested rows are detail.
        tier: n.depth === 0 ? "subtotal" : "detail",
      });
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(tree.roots);
  if (tree.onAccount) {
    rows.push({ depth: 0, label: tree.onAccount.label, metrics: tree.onAccount.metrics, tier: "onaccount" });
  }
  rows.push({ depth: 0, label: "Grand Total", metrics: tree.total, tier: "grand" });
  return rows;
}
