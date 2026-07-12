import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, Fragment, type ReactNode, type Dispatch, type SetStateAction, type CSSProperties } from "react";
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { HEADER_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";
import {
  HandCoins, RefreshCw, AlertTriangle, ChevronRight, ChevronDown,
  ArrowUpDown, ArrowUp, ArrowDown, Wallet, CalendarClock, Coins,
  TrendingDown, Percent, Download, BarChart3, X, Search, Plus, Minus, Pin,
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
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { useReceivablesSource } from "@hub/lib/sourceContext";
import { useFY } from "@hub/lib/fyContext";
import { sumOutstanding } from "@hub/lib/receivables";
import { buildGroupTree, sortTree, type GroupNode } from "@hub/lib/groupTree";
import { ddmmyyyy, isoToMonthLabel, monthEndLong, monthLabelToEndDate } from "@hub/lib/months";
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

/** Classify a receipt / other-payment allocation as applied AGAINST a specific invoice
 *  (true) vs ON ACCOUNT — an advance / unallocated payment (false). Mirrors the pipeline's
 *  normalized allocation labels ("AGST REF" / "ON ACCOUNT") used in OtherPaymentsReport,
 *  falling back to the presence of a reference invoice when the type is unlabelled. */
function isAgainstInvoice(type: string | null | undefined, refInvoice: string | null | undefined): boolean {
  const ty = (type ?? "").toUpperCase();
  if (ty.includes("ON ACC") || ty.includes("ADVANCE")) return false;
  if (ty.includes("AGST")) return true;
  return !!(refInvoice && refInvoice.trim());
}

type SortKey = "salesperson" | "sales" | "salesPrev" | "outstandingNow" | "outstandingDebit" | "outstandingCredit" | "due" | "receivedOnAccount" | "receivedAgainst" | "received" | "pending" | "collectionPct" | "collectionPctPrev";
type SortDir = "asc" | "desc";
type ViewMode = "customer" | "group";

/** All sale-type keys (mirrors SaleTypeMultiSelect); used for residual projection. */
const ALL_SALE_TYPES: SaleType[] = ["ink", "spare_parts", "machine", "head", "other"];
const SALE_TYPE_LABELS: Record<string, string> = {
  ink: "Ink", spare_parts: "Spare Parts", machine: "Machine", head: "Head", other: "Other",
};

interface Metrics {
  /** Sales raised this month (rupees). Sale-type-filterable via trend.salesByType. */
  sales: number;
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
  pending: number;
  dueSoon: number;
}
interface CustomerLine { id: string; name: string; company: string; location: string; m: Metrics; mPrev: Metrics; }
/** One constituent party (ledger) inside a group's expansion. */
interface PartyLine { key: string; name: string; sub: string; m: Metrics; mPrev: Metrics; }
/** A second-level drill row — either a single customer or a rolled-up customer group. */
interface DrillRow {
  key: string;
  name: string;
  /** Sub-label (e.g. "ACME · Mumbai" for a customer, or "N ledgers" for a group). */
  sub: string;
  /** True for a multi-party group — such rows expand to reveal their parties. */
  isGroup: boolean;
  /** Constituent parties (group view only; empty in customer view). */
  children: PartyLine[];
  /** Backing customer-ledger ids (for invoice drill-down). */
  customerIds: string[];
  m: Metrics;
  mPrev: Metrics;
}
interface SPRow { salesperson: string; rows: DrillRow[]; customerIds: string[]; m: Metrics; mPrev: Metrics; }

/** Normalize a salesperson name: trim + UPPERCASE; blank / "Others" → "OTHERS"
 *  (merges the pipeline's blank-default "Others" with explicit "OTHERS"). */
const spName = (s: string | undefined): string => {
  const t = (s ?? "").trim();
  return t ? t.toUpperCase() : "OTHERS";
};

const emptyMetrics = (): Metrics => ({
  sales: 0, outstanding: 0, outstandingDebit: 0, outstandingCredit: 0, due: 0, received: 0, receivedOnAccount: 0, receivedAgainst: 0, pending: 0, dueSoon: 0,
});
const addInto = (t: Metrics, m: Metrics): void => {
  t.sales             += m.sales;
  t.outstanding       += m.outstanding;
  t.outstandingDebit  += m.outstandingDebit;
  t.outstandingCredit += m.outstandingCredit;
  t.due               += m.due;
  t.received          += m.received;
  t.receivedOnAccount += m.receivedOnAccount;
  t.receivedAgainst   += m.receivedAgainst;
  t.pending           += m.pending;
  t.dueSoon           += m.dueSoon;
};
const collectionPct = (m: Metrics): number | null => (m.due > 0 ? (m.received / m.due) * 100 : null);

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

/** Sort an array of rows (salesperson groups OR customer lines) by the active column.
 *  Both row shapes carry `m`/`mPrev`; the only difference is the name accessor. */
function sortRows<T extends { m: Metrics; mPrev: Metrics }>(
  arr: T[], name: (x: T) => string, key: SortKey, dir: number,
): void {
  arr.sort((a, b) => {
    if (key === "salesperson") return dir * name(a).localeCompare(name(b));
    // Previous-month Sales sorts by mPrev; every other numeric key falls through to a.m[key].
    if (key === "salesPrev") return dir * (a.mPrev.sales - b.mPrev.sales);
    if (key === "outstandingNow") return dir * (a.m.outstanding - b.m.outstanding);
    if (key === "collectionPct")
      return dir * ((collectionPct(a.m) ?? -1) - (collectionPct(b.m) ?? -1));
    if (key === "collectionPctPrev")
      return dir * ((collectionPct(a.mPrev) ?? -1) - (collectionPct(b.mPrev) ?? -1));
    return dir * (a.m[key] - b.m[key]);
  });
}

/* ── Component ─────────────────────────────────────────────── */

export default function SalespersonCollectionReport() {
  const { label: fyLabel } = useFY();
  const { loading, error, allCustomers, customerDetail, dashboard, customerGroupMap } = useAppData();
  const isLive = useReceivablesSource() === "connectwave";

  const asOfDate = dashboard?.asOfDate ?? new Date().toISOString().slice(0, 10);
  const months = useMemo(() => (dashboard?.trend ?? []).map((t) => t.month), [dashboard]);
  const asOfMonth = months.length ? months[months.length - 1] : "";

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
  // Collapsed by default: the Received / Total Pending columns show only their Total; expanding
  // reveals the breakup sub-columns (On Account / Against Invoices, and As-on-today / Till-month-end).
  const [receivedExpanded, setReceivedExpanded] = useState<boolean>(false);
  const [pendingExpanded, setPendingExpanded] = useState<boolean>(false);
  // Outstanding (Today) collapsed by default → Total only; expanding reveals Net Debit / Net Credit.
  const [outstandingExpanded, setOutstandingExpanded] = useState<boolean>(false);
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
  const [sortKey, setSortKey] = useState<SortKey>("pending");
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

  // Per-customer → per-month split of "Received" into ON ACCOUNT (advance / unallocated)
  // vs AGAINST a specific invoice, built from the receipt + manual other-payment
  // transactions (both carry an allocation type + ref invoice). Cheque-return rows
  // (type "check_return", negative) are excluded — they sit on the Due side, not Received.
  // Used only to derive the on-account SHARE of each month's receipts; the displayed total
  // stays anchored to trend.receipts (+ other payments) so the two columns sum exactly to it.
  const receivedSplitByCustomerMonth = useMemo(() => {
    const m = new Map<string, Map<string, { onAccount: number; against: number }>>();
    const add = (cid: string, lbl: string, amt: number, against: boolean) => {
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
        if ((r.type ?? "").toLowerCase() === "check_return") continue;
        if (!r.date) continue;
        add(c.id, isoToMonthLabel(r.date), Math.abs(r.amount), isAgainstInvoice(r.type, r.refInvoice));
      }
      for (const o of det.otherPaymentTransactions ?? []) {
        if (!o.date) continue;
        add(c.id, isoToMonthLabel(o.date), Math.abs(o.amount), isAgainstInvoice(o.type, o.refInvoice));
      }
    }
    return m;
  }, [allCustomers, customerDetail]);

  // Per-customer metrics for ONE month. Shared by the main table (selected month) and the
  // month-wise panel (every month) so the two always reconcile for the same month.
  //  - Received = PURE receipt vouchers (LAKHS → rupees) PLUS manual "other payments" for the
  //    month (non-Tally, derived from transactions). Cheque returns / credit notes / debit
  //    notes are NOT netted here — the pipeline folds them into outstanding → invoice pending
  //    → trend.overdue, i.e. the Due/Overdue side. (Works in local-JSON & Supabase.)
  //  - openDue = bills due by month-end still OPEN (net of all receipts to date) = the true
  //    "still to collect". Current/as-of month uses live invoice pending + remaining opening
  //    balance; past months use the stored month-end snapshot (trend.overdue).
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
    const received = tallyReceipts + projectAmt(opForMonth, undefined, share);
    // Sales this month, sale-type-filterable the SAME way as receipts: read the real
    // per-type monthly sales (trend.salesByType, lakhs) under a sale-type filter;
    // pre-tagging snapshots fall back to the sales-mix estimate.
    const sales = !saleTypeActive
      ? (mt?.sales ?? 0) * 100_000
      : mt?.salesByType
        ? saleTypes.reduce((s, t) => s + (mt.salesByType?.[t as SaleType] ?? 0), 0) * 100_000
        : projectAmt((mt?.sales ?? 0) * 100_000, undefined, share); // fallback: pre-tagging snapshot
    let outstanding: number;
    let openDue: number;
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
      openDue = projectAmt(c.overdue, c.overdueByType, share) + dueSoon;
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
    }
    // Split `received` into on-account vs against-invoice by the month's raw allocation mix
    // (scale-invariant ratio, so the sale-type projection on `received` carries through).
    // Unclassified receipts (no allocation/ref) default to against-invoice, the common case.
    const split = receivedSplitByCustomerMonth.get(c.id)?.get(month);
    const rawOn = split?.onAccount ?? 0;
    const rawTotal = rawOn + (split?.against ?? 0);
    const receivedOnAccount = rawTotal > 1e-9 ? received * (rawOn / rawTotal) : 0;
    const receivedAgainst = received - receivedOnAccount;
    // Partition the net balance onto exactly one side (debit if owing, credit if in advance).
    // `outstanding` is sign-preserving in every branch, so these roll up the tree via addInto.
    const outstandingDebit = outstanding > 0 ? outstanding : 0;
    const outstandingCredit = outstanding < 0 ? -outstanding : 0;
    return { sales, outstanding, outstandingDebit, outstandingCredit, due: openDue + received, received, receivedOnAccount, receivedAgainst, pending: openDue, dueSoon };
  }, [customerDetail, asOfMonth, asOfDate, shareFor, projectAmt, saleTypeActive, saleTypeSet, saleTypes, otherPaymentsByCustomerMonth, receivedSplitByCustomerMonth]);

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
        const g = customerGroupMap.mapping[c.name];
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
      return m != null && (Math.round(m.outstanding) !== 0 || Math.round(m.due) !== 0);
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

  // Re-sort every level by the active column (Total Pending desc by default).
  const sortedRoots = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: GroupNode<CM>, b: GroupNode<CM>): number => {
      if (sortKey === "salesperson")       return dir * a.label.localeCompare(b.label);
      if (sortKey === "sales")              return dir * (a.metrics.m.sales - b.metrics.m.sales);
      if (sortKey === "salesPrev")          return dir * (a.metrics.mPrev.sales - b.metrics.mPrev.sales);
      if (sortKey === "outstandingNow")     return dir * (a.metrics.m.outstanding - b.metrics.m.outstanding);
      if (sortKey === "collectionPct")      return dir * ((collectionPct(a.metrics.m) ?? -1) - (collectionPct(b.metrics.m) ?? -1));
      if (sortKey === "collectionPctPrev")  return dir * ((collectionPct(a.metrics.mPrev) ?? -1) - (collectionPct(b.metrics.mPrev) ?? -1));
      return dir * (a.metrics.m[sortKey] - b.metrics.m[sortKey]);
    };
    return sortTree(tree.roots, cmp);
  }, [tree, sortKey, sortDir]);

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
      for (const id of customerIds) {
        const c = customerById.get(id);
        if (!c) continue;
        const groupName = customerGroupMap.mapping[c.name] ?? c.name;
        const key = `${c.name}|||${c.company}|||${c.location}`;
        if (!ledgerInfo.has(key)) ledgerInfo.set(key, { c, groupName });
        const m = customerMetrics.get(id);
        if (m) {
          const fig = category === "outstanding" ? startMonthOutstanding(m) : category === "due" ? m.due : m.pending;
          ledgerFigures[key] = (ledgerFigures[key] ?? 0) + fig;
        }
        for (const inv of customerDetail[id]?.invoices ?? []) {
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
        if (keysWithRows.has(key) || Math.abs(fig) < 1) continue;
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
      setDrill({ title: catLabel, subtitle: entityLabel, rows, ledgerFigures });
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

  const dueLabel = `Due by ${selectedMonth ? monthEndLong(selectedMonth) : "—"}`;
  // Sales raised in the selected month and the month before it. Both respect the Sale Type
  // filter exactly (via trend.salesByType), the same way Outstanding/Received do.
  const salesLabel = `Sales (${selectedMonth || "—"})`;
  const salesPrevLabel = prevMonth ? `Sales (${prevMonth})` : "Sales (prev)";
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
    aoa.push([`Group by: ${groupBy.map((d) => C_DIMENSIONS.find((x) => x.key === d)?.label ?? d).join(" → ")}`]);
    aoa.push([]);
    aoa.push(["Group", salesLabel, salesPrevLabel, dueLabel, "On Account", "Against Invoices", receivedLabel, "Net Debit", "Net Credit", outstandingNowLabel, `Pending ${pendingNowLabel}`, `Pending ${pendingTillLabel}`, "Due Pending", "Collection %"]);
    // Pre-order flatten of the roll-up (parents before children), indented by depth.
    // mPrev is carried so the previous-month Sales column can be exported per row.
    const flat: { depth: number; label: string; m: Metrics; mPrev: Metrics }[] = [];
    const walk = (nodes: GroupNode<CM>[]) => {
      for (const n of nodes) {
        flat.push({ depth: n.depth, label: n.sub ? `${n.label} (${n.sub})` : n.label, m: n.metrics.m, mPrev: n.metrics.mPrev });
        if (n.children.length) walk(n.children);
      }
    };
    walk(sortedRoots);
    for (const d of flat) {
      const pct = collectionPct(d.m);
      aoa.push([`${"    ".repeat(d.depth)}${d.label}`, d.m.sales, d.mPrev.sales, d.m.due, d.m.receivedOnAccount, d.m.receivedAgainst, d.m.received, d.m.outstandingDebit, d.m.outstandingCredit, d.m.outstanding, d.m.pending - d.m.dueSoon, d.m.dueSoon, d.m.pending, pct === null ? "" : Math.round(pct * 10) / 10]);
    }
    const totalPct = collectionPct(totals);
    aoa.push(["Grand Total", totals.sales, totalsPrev.sales, totals.due, totals.receivedOnAccount, totals.receivedAgainst, totals.received, totals.outstandingDebit, totals.outstandingCredit, totals.outstanding, totals.pending - totals.dueSoon, totals.dueSoon, totals.pending, totalPct === null ? "" : Math.round(totalPct * 10) / 10]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 34 }, { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 13 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 13 } }];
    const INR = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';
    const headerRow = 9; // 1-indexed column-header row (8 meta rows incl. Sale Type/Search + Group-by)
    const firstData = headerRow + 1;
    const lastData = firstData + flat.length; // includes grand total
    for (let row = firstData; row <= lastData; row++) {
      for (const col of ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"]) {
        const cell = ws[`${col}${row}`];
        if (cell && typeof cell.v === "number") cell.z = INR;
      }
      const pctCell = ws[`N${row}`];
      if (pctCell && typeof pctCell.v === "number") pctCell.z = '0.0"%"';
    }
    // Styling: title + column header black/white/bold; grand total stronger green.
    styleRow(ws, 0, 14, HEADER_STYLE);                     // title banner
    styleRow(ws, headerRow - 1, 14, HEADER_STYLE);         // column header row (0-indexed)
    styleRow(ws, headerRow + flat.length, 14, GRAND_TOTAL_STYLE); // Grand Total row
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Collection");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveAs(blob, `Salesperson-Collection_${selectedMonth}_${asOfDate}.xlsx`);
  };

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

  const kpiCards: { label: string; value: string; icon: typeof Coins; warn: boolean; sub?: string }[] = [
    { label: salesLabel,          value: fmt(totals.sales),       icon: Coins,          warn: false },
    { label: salesPrevLabel,      value: fmt(totalsPrev.sales),   icon: Coins,          warn: false },
    { label: dueLabel,            value: fmt(totals.due),         icon: CalendarClock,  warn: false },
    { label: receivedLabel,       value: fmt(totals.received),    icon: Coins,          warn: false },
    { label: outstandingNowLabel,    value: fmt(totals.outstanding), icon: Wallet,         warn: true,
      sub: `Dr ${fmt(totals.outstandingDebit)} · Cr ${fmt(totals.outstandingCredit)}` },
    { label: "Due Pending",       value: fmt(totals.pending),     icon: TrendingDown,   warn: true  },
    {
      label: "Collection %",
      value: collectionPct(totals) === null ? "—" : `${(collectionPct(totals) as number).toFixed(1)}%`,
      icon: Percent, warn: false,
    },
  ];

  const COLS: { key: SortKey; label: string; align?: "right"; width?: string; wrap?: boolean }[] = [
    { key: "salesperson",   label: "Salesperson", wrap: true, width: "w-[110px]" },
    { key: "sales",         label: salesLabel,          align: "right", wrap: true, width: "w-[110px]" },
    { key: "salesPrev",     label: salesPrevLabel,      align: "right", wrap: true, width: "w-[110px]" },
    { key: "due",           label: dueLabel,            align: "right", wrap: true, width: "w-[110px]" },
    { key: "outstandingNow", label: outstandingNowLabel, align: "right", wrap: true, width: "w-[110px]" },
    { key: "outstandingDebit",  label: "Net Debit",         align: "right" },
    { key: "outstandingCredit", label: "Net Credit",        align: "right" },
    { key: "receivedOnAccount", label: "On Account",        align: "right" },
    { key: "receivedAgainst",   label: "Against Invoices",  align: "right" },
    { key: "received",          label: "Total",             align: "right" },
    { key: "pending",       label: "Due Pending",       align: "right" },
    { key: "collectionPct", label: prevMonth ? `Collection % (${selectedMonth})` : "Collection %", align: "right", width: "w-[95px]", wrap: true },
    { key: "collectionPctPrev", label: prevMonth ? `Collection % (${prevMonth})` : "Collection % (prev)", align: "right", width: "w-[95px]", wrap: true },
  ];
  type Col = (typeof COLS)[number];
  const anyExpanded = receivedExpanded || pendingExpanded || outstandingExpanded;
  const leadingCols    = COLS.filter((c) => ["salesperson", "sales", "salesPrev", "due"].includes(c.key));
  const collectionCols = COLS.filter((c) => ["collectionPct", "collectionPctPrev"].includes(c.key));
  const debitCol     = COLS.find((c) => c.key === "outstandingDebit")!;
  const creditCol    = COLS.find((c) => c.key === "outstandingCredit")!;
  const onAccountCol = COLS.find((c) => c.key === "receivedOnAccount")!;
  const againstCol   = COLS.find((c) => c.key === "receivedAgainst")!;
  const totalCol     = COLS.find((c) => c.key === "received")!;
  const pendingCol   = COLS.find((c) => c.key === "pending")!;

  /** A sortable column header cell (used for every non-grouped column). */
  const sortHead = (
    col: Col, rowSpan?: number,
    opts?: { headRef?: React.Ref<HTMLTableCellElement>; extra?: ReactNode; freeze?: FreezeStick },
  ) => (
    <TableHead
      key={col.key}
      ref={opts?.headRef}
      rowSpan={rowSpan}
      style={opts?.freeze?.style}
      className={`text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none ${col.wrap ? "" : "whitespace-nowrap"} ${col.width ?? ""} ${col.align === "right" ? "text-right" : ""} ${opts?.freeze?.className ?? ""}`}
      onClick={() => toggleSort(col.key)}
    >
      <span className={`inline-flex items-center gap-1 ${col.align === "right" ? "justify-end w-full" : ""}`}>
        {col.label}
        {sortIcon(col.key)}
        {opts?.extra}
      </span>
    </TableHead>
  );

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

  /** Small +/− button toggling a column's breakup sub-columns. */
  const makeToggle = (expanded: boolean, set: Dispatch<SetStateAction<boolean>>, hint: string) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); set((v) => !v); }}
      className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded border border-border/70 text-foreground/60 hover:bg-muted hover:text-foreground shrink-0"
      title={expanded ? `Hide ${hint}` : `Show ${hint}`}
    >
      {expanded ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
    </button>
  );
  const receivedToggle = makeToggle(receivedExpanded, setReceivedExpanded, "On Account / Against Invoices breakup");
  const pendingToggle  = makeToggle(pendingExpanded, setPendingExpanded, "As-on-today / Till-month-end breakup");
  const outstandingToggle = makeToggle(outstandingExpanded, setOutstandingExpanded, "Net Debit / Net Credit breakup");

  /** The metric cells for one row (grand total or any roll-up node), in column order.
   *  `strong` bolds the figures (grand total + depth-0 nodes). */
  const metricCells = (
    m: Metrics, mPrev: Metrics, ids: string[], label: string, strong: boolean,
  ): ReactNode => {
    const pct = collectionPct(m);
    const pctPrev = collectionPct(mPrev);
    const sz = strong ? "text-sm " : "";
    const bold = strong ? "font-semibold " : "";
    return (
      <>
        <TableCell className={`${sz}text-right font-mono ${bold}`}>{fmt(m.sales)}</TableCell>
        <TableCell className={`${sz}text-right font-mono`}>{fmt(mPrev.sales)}</TableCell>
        {drillCell(ids, "due", label, `${sz}text-right font-mono`, fmt(m.due))}
        {receivedExpanded && <>
          <TableCell className={`${sz}text-right font-mono text-muted-foreground border-l border-border/60`}>{fmt(m.receivedOnAccount)}</TableCell>
          <TableCell className={`${sz}text-right font-mono text-muted-foreground`}>{fmt(m.receivedAgainst)}</TableCell>
        </>}
        <TableCell className={`${sz}text-right font-mono`}>{fmt(m.received)}</TableCell>
        {outstandingExpanded && <>
          <TableCell className={`${sz}text-right font-mono text-muted-foreground border-l border-border`}>{fmt(m.outstandingDebit)}</TableCell>
          <TableCell className={`${sz}text-right font-mono text-muted-foreground`}>{fmt(m.outstandingCredit)}</TableCell>
        </>}
        <TableCell className={`${sz}text-right font-mono ${bold}${outstandingExpanded ? "" : "border-l border-border"}`}>{fmt(m.outstanding)}</TableCell>
        {pendingExpanded && <>
          <TableCell className={`${sz}text-right font-mono text-muted-foreground border-l border-border/60`}>{fmt(m.pending - m.dueSoon)}</TableCell>
          <TableCell className={`${sz}text-right font-mono text-muted-foreground`}>{fmt(m.dueSoon)}</TableCell>
        </>}
        {drillCell(ids, "pending", label, `${sz}text-right font-mono ${bold}${m.pending > 0 ? "text-destructive" : ""}`, fmt(m.pending))}
        <TableCell className={`${sz}text-right font-mono ${pctStyle(pct)}`}>{pct === null ? "—" : `${pct.toFixed(1)}%`}</TableCell>
        <TableCell className={`${sz}text-right font-mono ${pctStyle(pctPrev)}`}>{prevMonth == null || pctPrev === null ? "—" : `${pctPrev.toFixed(1)}%`}</TableCell>
      </>
    );
  };

  /** Recursive roll-up rows; pagination/scope is whole-tree. depth-0 click also scopes the panel. */
  const renderNodes = (nodes: GroupNode<CM>[]): ReactNode =>
    nodes.map((n) => {
      const hasChildren = n.children.length > 0;
      const isOpen = expanded.has(n.key);
      const tint = n.depth === 0 ? "" : n.depth === 1 ? "bg-muted/20" : "bg-muted/10";
      const isSelected = n.depth === 0 && selectedNode?.label === n.label;
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
                className={`whitespace-nowrap ${n.depth === 0 ? "font-medium text-sm" : "text-[13px] text-muted-foreground"} ${f.className}`}
              >
                {n.label}
                {n.sub && <span className="ml-1.5 text-[10px] font-normal opacity-70">{n.sub}</span>}
                {hasChildren && <span className="ml-1.5 text-[11px] opacity-70">({n.children.length})</span>}
              </TableCell>
            ); })()}
            {metricCells(n.metrics.m, n.metrics.mPrev, n.ids, n.label, n.depth === 0)}
          </TableRow>
          {isOpen && hasChildren && renderNodes(n.children)}
        </Fragment>
      );
    });

  // Total column count (for empty-state colSpan): chevron + label + metric columns.
  // Metric columns: sales, salesPrev, due, received, outstandingNow, pending, collectionPct, collectionPctPrev = 8.
  const metricColCount = 8 + (receivedExpanded ? 2 : 0) + (outstandingExpanded ? 2 : 0) + (pendingExpanded ? 2 : 0);
  const totalColCount = 2 + metricColCount;
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
        <Button variant="outline" size="sm" className="rounded-button border-border" onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          Export Excel
        </Button>
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
          <li>Use the +/− toggles to show or hide each breakup.</li>
        </ul>
      </details>

      {/* Main table */}
      <Card className="rounded-card border-border bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {sortedRoots.length} {groupByLabel}{sortedRoots.length !== 1 ? "s" : ""}
          </span>
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">Click a row to expand; the top level also scopes the Monthly analysis. Use the <Pin className="h-3 w-3 inline" /> on the group column to freeze it while scrolling</span>
        </div>
        <ScrollableTable>
          <Table>
            <TableHeader>
              {/* Received and Total Pending are each collapsed by default (Total only, with a +
                  toggle). When expanded, a two-row header groups their breakup under the banner. */}
              <TableRow className="bg-muted/50">
                <TableHead
                  ref={chevRef}
                  rowSpan={anyExpanded ? 2 : 1}
                  style={freezeStick("chevron", { header: true }).style}
                  className={`w-8 ${freezeStick("chevron", { header: true }).className}`}
                />
                <TableHead
                  ref={spHeadRef}
                  rowSpan={anyExpanded ? 2 : 1}
                  style={freezeStick("label", { header: true }).style}
                  className={`text-xs font-semibold text-foreground/70 align-bottom pb-2 cursor-pointer select-none whitespace-nowrap ${freezeStick("label", { header: true }).className}`}
                  onClick={() => toggleSort("salesperson")}
                >
                  <span className="inline-flex items-center gap-1">
                    {groupBy.map((d) => C_DIMENSIONS.find((x) => x.key === d)?.label ?? d).join(" → ")}
                    {sortIcon("salesperson")}
                    {freezePin()}
                  </span>
                </TableHead>
                {sortHead(COLS.find((c) => c.key === "sales")!, anyExpanded ? 2 : 1)}
                {sortHead(COLS.find((c) => c.key === "salesPrev")!, anyExpanded ? 2 : 1)}
                {sortHead(COLS.find((c) => c.key === "due")!, anyExpanded ? 2 : 1)}
                {receivedExpanded ? (
                  <TableHead colSpan={3} className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border">
                    <span className="inline-flex items-center justify-center">{receivedLabel}{receivedToggle}</span>
                  </TableHead>
                ) : (
                  <TableHead
                    rowSpan={anyExpanded ? 2 : 1}
                    className="text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none w-[110px] text-right border-l border-border"
                    onClick={() => toggleSort("received")}
                  >
                    <span className="inline-flex items-center gap-1 justify-end w-full">{receivedLabel}{sortIcon("received")}{receivedToggle}</span>
                  </TableHead>
                )}
                {outstandingExpanded ? (
                  <TableHead colSpan={3} className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border">
                    <span className="inline-flex items-center justify-center">{outstandingNowLabel}{outstandingToggle}</span>
                  </TableHead>
                ) : (
                  <TableHead
                    rowSpan={anyExpanded ? 2 : 1}
                    className="text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none w-[110px] text-right border-l border-border"
                    onClick={() => toggleSort("outstandingNow")}
                  >
                    <span className="inline-flex items-center gap-1 justify-end w-full">{outstandingNowLabel}{sortIcon("outstandingNow")}{outstandingToggle}</span>
                  </TableHead>
                )}
                {pendingExpanded ? (
                  <TableHead colSpan={3} className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border">
                    <span className="inline-flex items-center justify-center">{pendingCol.label}{pendingToggle}</span>
                  </TableHead>
                ) : (
                  <TableHead
                    rowSpan={anyExpanded ? 2 : 1}
                    className="text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none w-[95px] text-right border-l border-border"
                    onClick={() => toggleSort("pending")}
                  >
                    <span className="inline-flex items-center gap-1 justify-end w-full">{pendingCol.label}{sortIcon("pending")}{pendingToggle}</span>
                  </TableHead>
                )}
                {collectionCols.map((col) => sortHead(col, anyExpanded ? 2 : 1))}
              </TableRow>
              {anyExpanded && (
                <TableRow className="bg-muted/50">
                  {receivedExpanded && [onAccountCol, againstCol, totalCol].map((col) => (
                    <TableHead
                      key={col.key}
                      className={`text-xs font-medium text-foreground/60 cursor-pointer select-none whitespace-nowrap text-right ${col.key === "receivedOnAccount" ? "border-l border-border" : ""}`}
                      onClick={() => toggleSort(col.key)}
                    >
                      <span className="inline-flex items-center gap-1 justify-end w-full">{col.label}{sortIcon(col.key)}</span>
                    </TableHead>
                  ))}
                  {outstandingExpanded && (
                    <>
                      {[debitCol, creditCol].map((col) => (
                        <TableHead
                          key={col.key}
                          className={`text-xs font-medium text-foreground/60 cursor-pointer select-none whitespace-nowrap text-right ${col.key === "outstandingDebit" ? "border-l border-border" : ""}`}
                          onClick={() => toggleSort(col.key)}
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">{col.label}{sortIcon(col.key)}</span>
                        </TableHead>
                      ))}
                      <TableHead
                        className="text-xs font-medium text-foreground/60 cursor-pointer select-none whitespace-nowrap text-right"
                        onClick={() => toggleSort("outstandingNow")}
                      >
                        <span className="inline-flex items-center gap-1 justify-end w-full">Total{sortIcon("outstandingNow")}</span>
                      </TableHead>
                    </>
                  )}
                  {pendingExpanded && (
                    <>
                      <TableHead className="text-xs font-medium text-foreground/60 whitespace-nowrap text-right border-l border-border">{pendingNowLabel}</TableHead>
                      <TableHead className="text-xs font-medium text-foreground/60 whitespace-nowrap text-right">{pendingTillLabel}</TableHead>
                      <TableHead
                        className="text-xs font-medium text-foreground/60 cursor-pointer select-none whitespace-nowrap text-right"
                        onClick={() => toggleSort("pending")}
                      >
                        <span className="inline-flex items-center gap-1 justify-end w-full">Total{sortIcon("pending")}</span>
                      </TableHead>
                    </>
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
                    {metricCells(totals, totalsPrev, allCustomerIds, "Grand Total", true)}
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
        const chartData = monthlyData.map((d) => ({
          month: d.month,
          Due: d.due,
          Received: d.received,
          Pending: d.pending,
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
                  <Line yAxisId="right" type="monotone" dataKey="Collection %" stroke="hsl(28, 80%, 52%)" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Month table */}
            <ScrollableTable>
              <Table>
                <TableHeader>
                  {/* Received and Pending are each collapsed by default; the + toggle reveals the breakup. */}
                  <TableRow className="bg-muted/50">
                    <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 whitespace-nowrap">Month</TableHead>
                    <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap">Opening</TableHead>
                    <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap">Closing</TableHead>
                    <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap">Due</TableHead>
                    {receivedExpanded ? (
                      <TableHead colSpan={3} className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border">
                        <span className="inline-flex items-center justify-center">Received{receivedToggle}</span>
                      </TableHead>
                    ) : (
                      <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap border-l border-border">
                        <span className="inline-flex items-center gap-1 justify-end w-full">Received{receivedToggle}</span>
                      </TableHead>
                    )}
                    {pendingExpanded ? (
                      <TableHead colSpan={3} className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border">
                        <span className="inline-flex items-center justify-center">Pending{pendingToggle}</span>
                      </TableHead>
                    ) : (
                      <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap border-l border-border">
                        <span className="inline-flex items-center gap-1 justify-end w-full">Pending{pendingToggle}</span>
                      </TableHead>
                    )}
                    <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap">Collection %</TableHead>
                  </TableRow>
                  {anyExpanded && (
                    <TableRow className="bg-muted/50">
                      {receivedExpanded && <>
                        <TableHead className="text-xs font-medium text-foreground/60 text-right whitespace-nowrap border-l border-border">On Account</TableHead>
                        <TableHead className="text-xs font-medium text-foreground/60 text-right whitespace-nowrap">Against Invoices</TableHead>
                        <TableHead className="text-xs font-medium text-foreground/60 text-right whitespace-nowrap">Total</TableHead>
                      </>}
                      {pendingExpanded && <>
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
                        {receivedExpanded && <>
                          <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(d.receivedOnAccount)}</TableCell>
                          <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(d.receivedAgainst)}</TableCell>
                        </>}
                        <TableCell className="text-sm text-right font-mono">{fmt(d.received)}</TableCell>
                        {pendingExpanded && <>
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
                      {receivedExpanded && <>
                        <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(sumOnAccount)}</TableCell>
                        <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(sumAgainst)}</TableCell>
                      </>}
                      <TableCell className="text-sm text-right font-mono">{fmt(sumReceived)}</TableCell>
                      {pendingExpanded && <>
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
    </div>
  );
}
