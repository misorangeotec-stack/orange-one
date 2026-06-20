import { useState, useMemo, useEffect, useRef, useCallback, Fragment, type ReactNode, type Dispatch, type SetStateAction } from "react";
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { HEADER_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";
import {
  HandCoins, RefreshCw, AlertTriangle, ChevronRight, ChevronDown,
  ArrowUpDown, ArrowUp, ArrowDown, Wallet, CalendarClock, Coins,
  TrendingDown, Percent, Download, BarChart3, X, Search, Plus, Minus,
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
import { SaleTypeMultiSelect } from "@hub/components/SaleTypeMultiSelect";
import { MultiSelect } from "@hub/components/MultiSelect";
import { InvoiceDrilldownDialog, type InvoiceDrillRow } from "@hub/components/InvoiceDrilldownDialog";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { useFY } from "@hub/lib/fyContext";
import { sumOutstanding } from "@hub/lib/receivables";
import type { Customer, SaleType } from "@hub/lib/types";

/* ── Helpers ───────────────────────────────────────────────── */

const fmt = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000)   return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

const MONTH_IDX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** "May-26" → Date for the last calendar day of that month (local, end-of-day). */
function monthLabelToEndDate(label: string): Date {
  const [mon, yy] = label.split("-");
  const monthIdx = MONTH_IDX[mon] ?? 0;
  const year = 2000 + parseInt(yy, 10);
  return new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);
}

/** Format a JS Date as DD-MM-YYYY (numeric, dashes). */
function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/** "May-26" → "31-05-2026" (last day of that month) */
function monthEndLong(label: string): string {
  return ddmmyyyy(monthLabelToEndDate(label));
}

function formatDateLong(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return ddmmyyyy(d);
}

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
/** ISO date "2025-08-15" → trend month label "Aug-25" (matches trend.month). */
function isoToMonthLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${MONTH_ABBR[d.getMonth()]}-${String(d.getFullYear() % 100).padStart(2, "0")}`;
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

type SortKey = "salesperson" | "outstanding" | "due" | "receivedOnAccount" | "receivedAgainst" | "received" | "pending" | "collectionPct" | "collectionPctPrev";
type SortDir = "asc" | "desc";
type ViewMode = "customer" | "group";

/** All sale-type keys (mirrors SaleTypeMultiSelect); used for residual projection. */
const ALL_SALE_TYPES: SaleType[] = ["ink", "spare_parts", "machine", "head", "other"];
const SALE_TYPE_LABELS: Record<string, string> = {
  ink: "Ink", spare_parts: "Spare Parts", machine: "Machine", head: "Head", other: "Other",
};

interface Metrics {
  outstanding: number;
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
  outstanding: 0, due: 0, received: 0, receivedOnAccount: 0, receivedAgainst: 0, pending: 0, dueSoon: 0,
});
const addInto = (t: Metrics, m: Metrics): void => {
  t.outstanding       += m.outstanding;
  t.due               += m.due;
  t.received          += m.received;
  t.receivedOnAccount += m.receivedOnAccount;
  t.receivedAgainst   += m.receivedAgainst;
  t.pending           += m.pending;
  t.dueSoon           += m.dueSoon;
};
const collectionPct = (m: Metrics): number | null => (m.due > 0 ? (m.received / m.due) * 100 : null);

/** Outstanding to DISPLAY = the START-of-month balance = month-end balance + that month's
 *  receipts (the money already collected this month is added back). This is always ≥ Due
 *  (Due is the portion of that opening balance which had come due), so the report never shows
 *  Due greater than Outstanding. The `m.due` floor guards credit-heavy groups whose net
 *  month-end balance is pushed below the due amount by customers sitting in advance. */
const startMonthOutstanding = (m: Metrics): number => Math.max(m.outstanding + m.received, m.due);

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

  const asOfDate = dashboard?.asOfDate ?? new Date().toISOString().slice(0, 10);
  const months = useMemo(() => (dashboard?.trend ?? []).map((t) => t.month), [dashboard]);
  const asOfMonth = months.length ? months[months.length - 1] : "";

  // Filter / control state
  const [monthState, setMonthState] = useState<string>("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [salesPersons, setSalesPersons] = useState<string[]>([]);
  const [saleTypes, setSaleTypes] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("customer");
  // Collapsed by default: the Received / Total Pending columns show only their Total; expanding
  // reveals the breakup sub-columns (On Account / Against Invoices, and As-on-today / Till-month-end).
  const [receivedExpanded, setReceivedExpanded] = useState<boolean>(false);
  const [pendingExpanded, setPendingExpanded] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Expanded group rows (group view): keyed by `${salesperson}::${groupKey}`.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // Invoice drill-down popup (current month only).
  const [drill, setDrill] = useState<{ title: string; subtitle: string; rows: InvoiceDrillRow[]; ledgerFigures: Record<string, number> } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("pending");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Month-wise panel: null = consolidated (all filtered salespersons)
  const [selectedSalesperson, setSelectedSalesperson] = useState<string | null>(null);
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

  // ── Sale-type filter (best-effort projection) ────────────────────────────────
  // The pipeline only stores OUTSTANDING per sale type per month — not receipts or
  // overdue. So when a sale type is selected we filter Outstanding/Due exactly where
  // a per-type breakdown exists and ESTIMATE the rest (Received, past-month overdue)
  // by the customer's sales mix — the same residual-share approach the Dashboard uses.
  // All 5 types selected = no filter.
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
  }, [allCustomers, companies, locations, salesPersons, saleTypeActive, saleTypes, saleTypeSet, customerSearch]);

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
    // Received = Tally receipts + manual other-payments for this month (both lack a
    // per-type breakdown → estimate by sales-mix share).
    const opForMonth = otherPaymentsByCustomerMonth.get(c.id)?.get(month) ?? 0;
    const received = projectAmt((mt?.receipts ?? 0) * 100_000 + opForMonth, undefined, share);
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
    return { outstanding, due: openDue + received, received, receivedOnAccount, receivedAgainst, pending: openDue, dueSoon };
  }, [customerDetail, asOfMonth, asOfDate, shareFor, projectAmt, saleTypeActive, saleTypeSet, otherPaymentsByCustomerMonth, receivedSplitByCustomerMonth]);

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

  // Group by salesperson; each salesperson's drill rows are either individual customers
  // or customers rolled up into customer-groups (View toggle).
  const spRows = useMemo<SPRow[]>(() => {
    interface Acc { salesperson: string; customers: CustomerLine[]; m: Metrics; mPrev: Metrics; }
    const map = new Map<string, Acc>();
    for (const c of filteredCustomers) {
      const sp = spName(c.salesPerson);
      const m = customerMetrics.get(c.id) ?? emptyMetrics();
      const mPrev = customerMetricsPrev.get(c.id) ?? emptyMetrics();
      // Skip customers whose (displayed) total outstanding is zero for the selected month.
      if (Math.round(startMonthOutstanding(m)) === 0) continue;
      let row = map.get(sp);
      if (!row) { row = { salesperson: sp, customers: [], m: emptyMetrics(), mPrev: emptyMetrics() }; map.set(sp, row); }
      row.customers.push({ id: c.id, name: c.name, company: c.company, location: c.location, m, mPrev });
      addInto(row.m, m);
      addInto(row.mPrev, mPrev);
    }

    const dir = sortDir === "asc" ? 1 : -1;

    // Roll a salesperson's customer lines up into customer-groups (mapping sheet);
    // customers absent from the mapping become their own single-party group.
    const rollupGroups = (custs: CustomerLine[]): DrillRow[] => {
      const groups = new Map<string, { lines: CustomerLine[]; m: Metrics; mPrev: Metrics }>();
      for (const cl of custs) {
        const gName = customerGroupMap.mapping[cl.name] ?? cl.name;
        let g = groups.get(gName);
        if (!g) { g = { lines: [], m: emptyMetrics(), mPrev: emptyMetrics() }; groups.set(gName, g); }
        g.lines.push(cl);
        addInto(g.m, cl.m);
        addInto(g.mPrev, cl.mPrev);
      }
      return [...groups.entries()].map(([gName, g]): DrillRow => {
        const isGroup = g.lines.length > 1;
        const children: PartyLine[] = g.lines.map((cl) => ({
          key: cl.id,
          name: cl.name,
          sub: `${cl.company} · ${cl.location}`,
          m: cl.m,
          mPrev: cl.mPrev,
        }));
        sortRows(children, (c) => c.name, sortKey, dir);
        return {
          key: `G:${gName}`,
          name: gName,
          sub: isGroup ? `${g.lines.length} ledgers` : "",
          isGroup,
          children,
          customerIds: g.lines.map((cl) => cl.id),
          m: g.m,
          mPrev: g.mPrev,
        };
      });
    };

    const arr: SPRow[] = [...map.values()].map((acc) => {
      const rows: DrillRow[] = viewMode === "group"
        ? rollupGroups(acc.customers)
        : acc.customers.map((cl) => ({
            key: cl.id,
            name: cl.name,
            sub: `${cl.company} · ${cl.location}`,
            isGroup: false,
            children: [],
            customerIds: [cl.id],
            m: cl.m,
            mPrev: cl.mPrev,
          }));
      // Sort drill rows by the same active column as the salesperson groups.
      sortRows(rows, (r) => r.name, sortKey, dir);
      return { salesperson: acc.salesperson, rows, customerIds: acc.customers.map((cl) => cl.id), m: acc.m, mPrev: acc.mPrev };
    });
    sortRows(arr, (r) => r.salesperson, sortKey, dir);
    return arr;
  }, [filteredCustomers, customerMetrics, customerMetricsPrev, sortKey, sortDir, viewMode, customerGroupMap]);

  const totals = useMemo<Metrics>(() => {
    const t = emptyMetrics();
    for (const r of spRows) addInto(t, r.m);
    // Use the locked NET convention for the headline outstanding in the current month.
    // Skip when a sale type is active — sumOutstanding would use the un-projected (full)
    // balances, diverging from the projected per-row totals shown in the table.
    if (isCurrentMonth && !saleTypeActive) t.outstanding = sumOutstanding(filteredCustomers);
    return t;
  }, [spRows, filteredCustomers, isCurrentMonth, saleTypeActive]);

  // Previous-month totals — only Due/Received feed the grand-total Collection % (prev) cell.
  const totalsPrev = useMemo<Metrics>(() => {
    const t = emptyMetrics();
    for (const r of spRows) addInto(t, r.mPrev);
    return t;
  }, [spRows]);

  /* ── Month-wise series for the panel (selected salesperson, or consolidated) ── */
  interface MonthRow extends Metrics { month: string; sales: number; }
  const monthlyData = useMemo<MonthRow[]>(() => {
    const custs = selectedSalesperson
      ? filteredCustomers.filter((c) => spName(c.salesPerson) === selectedSalesperson)
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
  }, [selectedSalesperson, filteredCustomers, months, customerDetail, metricsForMonth]);

  // If the selected salesperson is filtered out, revert the panel to consolidated.
  useEffect(() => {
    if (selectedSalesperson && !spRows.some((r) => r.salesperson === selectedSalesperson)) {
      setSelectedSalesperson(null);
    }
  }, [spRows, selectedSalesperson]);

  /* ── Handlers ── */
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "salesperson" ? "asc" : "desc"); }
  };
  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };
  const toggleExpand = (sp: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sp)) next.delete(sp); else next.add(sp);
      return next;
    });
  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
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
      for (const id of customerIds) {
        const c = customerById.get(id);
        if (!c) continue;
        const groupName = customerGroupMap.mapping[c.name] ?? c.name;
        const m = customerMetrics.get(id);
        if (m) {
          const key = `${c.name}|||${c.company}|||${c.location}`;
          const fig = category === "outstanding" ? startMonthOutstanding(m) : category === "due" ? m.due : m.pending;
          ledgerFigures[key] = (ledgerFigures[key] ?? 0) + fig;
        }
        for (const inv of customerDetail[id]?.invoices ?? []) {
          if (inv.billType === "Agst Ref" || inv.amount <= 0) continue;
          if (inv.pending <= 0) continue;
          if (dueOnly && new Date(inv.dueDate) > monthEnd) continue;
          rows.push({
            customerName: c.name, groupName, company: c.company, location: c.location,
            number: inv.number, billRefName: inv.billRefName, date: inv.date,
            amount: inv.amount, received: inv.amount - inv.pending, pending: inv.pending,
            dueDate: inv.dueDate, overdueDays: inv.overdueDays, status: inv.status,
            voucherType: inv.voucherType,
          });
        }
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

  // All backing ids across the visible salespersons (for the Grand Total drill).
  const allCustomerIds = useMemo(() => spRows.flatMap((r) => r.customerIds), [spRows]);

  /** A figure cell that drills into its invoices — clickable only in the current month.
   *  Plain render fn (not a component) so cells don't remount each render. */
  const drillCell = (
    ids: string[], category: "outstanding" | "due" | "pending", label: string,
    className: string, children: ReactNode,
  ) => (
    <TableCell
      className={`${className} ${isCurrentMonth ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
      title={isCurrentMonth ? "Click to view invoices" : "Per-invoice detail is available for the current month only"}
      onClick={isCurrentMonth ? (e) => { e.stopPropagation(); openDrill(ids, category, label); } : undefined}
    >
      {children}
    </TableCell>
  );

  const clearFilters = () => {
    setCompanies([]); setLocations([]); setSalesPersons([]); setSaleTypes([]); setCustomerSearch("");
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
    saleTypes.length > 0 && {
      label: saleTypes.length <= 2
        ? `Type: ${saleTypes.map((t) => SALE_TYPE_LABELS[t] ?? t).join(", ")}`
        : `${saleTypes.length} types`,
      onRemove: () => setSaleTypes([]),
    },
    customerSearch.trim() && { label: `Search: ${customerSearch.trim()}`, onRemove: () => setCustomerSearch("") },
  ].filter(Boolean) as FilterChip[];

  const dueLabel = `Due upto ${selectedMonth ? monthEndLong(selectedMonth) : "—"}`;
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
      `Search: ${customerSearch.trim() || "—"}`,
    ]);
    aoa.push([]);
    aoa.push(["Salesperson", "Total Outstanding", dueLabel, "On Account", "Against Invoices", receivedLabel, `Pending ${pendingNowLabel}`, `Pending ${pendingTillLabel}`, "Total Pending", "Collection %"]);
    for (const r of spRows) {
      const pct = collectionPct(r.m);
      aoa.push([r.salesperson, startMonthOutstanding(r.m), r.m.due, r.m.receivedOnAccount, r.m.receivedAgainst, r.m.received, r.m.pending - r.m.dueSoon, r.m.dueSoon, r.m.pending, pct === null ? "" : Math.round(pct * 10) / 10]);
    }
    const totalPct = collectionPct(totals);
    aoa.push(["Grand Total", startMonthOutstanding(totals), totals.due, totals.receivedOnAccount, totals.receivedAgainst, totals.received, totals.pending - totals.dueSoon, totals.dueSoon, totals.pending, totalPct === null ? "" : Math.round(totalPct * 10) / 10]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 13 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];
    const INR = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';
    const firstData = 9; // 1-indexed first salesperson row (8 header rows incl. Sale Type/Search)
    const lastData = firstData + spRows.length; // includes grand total
    for (let row = firstData; row <= lastData; row++) {
      for (const col of ["B", "C", "D", "E", "F", "G", "H", "I"]) {
        const cell = ws[`${col}${row}`];
        if (cell && typeof cell.v === "number") cell.z = INR;
      }
      const pctCell = ws[`J${row}`];
      if (pctCell && typeof pctCell.v === "number") pctCell.z = '0.0"%"';
    }
    // Styling: title + column header black/white/bold; grand total stronger green.
    styleRow(ws, 0, 10, HEADER_STYLE);                  // title banner
    styleRow(ws, 7, 10, HEADER_STYLE);                  // column header row
    styleRow(ws, 8 + spRows.length, 10, GRAND_TOTAL_STYLE); // Grand Total row
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

  const kpiCards = [
    { label: "Total Outstanding", value: fmt(startMonthOutstanding(totals)), icon: Wallet, warn: true  },
    { label: dueLabel,            value: fmt(totals.due),         icon: CalendarClock,  warn: false },
    { label: receivedLabel,       value: fmt(totals.received),    icon: Coins,          warn: false },
    { label: "Total Pending",     value: fmt(totals.pending),     icon: TrendingDown,   warn: true  },
    {
      label: "Collection %",
      value: collectionPct(totals) === null ? "—" : `${(collectionPct(totals) as number).toFixed(1)}%`,
      icon: Percent, warn: false,
    },
  ];

  const COLS: { key: SortKey; label: string; align?: "right"; width?: string; wrap?: boolean }[] = [
    { key: "salesperson",   label: "Salesperson" },
    { key: "outstanding",   label: "Total Outstanding", align: "right" },
    { key: "due",           label: dueLabel,            align: "right" },
    { key: "receivedOnAccount", label: "On Account",        align: "right" },
    { key: "receivedAgainst",   label: "Against Invoices",  align: "right" },
    { key: "received",          label: "Total",             align: "right" },
    { key: "pending",       label: "Total Pending",     align: "right" },
    { key: "collectionPct", label: prevMonth ? `Collection % (${selectedMonth})` : "Collection %", align: "right", width: "w-[80px]", wrap: true },
    { key: "collectionPctPrev", label: prevMonth ? `Collection % (${prevMonth})` : "Collection % (prev)", align: "right", width: "w-[80px]", wrap: true },
  ];
  type Col = (typeof COLS)[number];
  const anyExpanded = receivedExpanded || pendingExpanded;
  const leadingCols    = COLS.filter((c) => ["salesperson", "outstanding", "due"].includes(c.key));
  const collectionCols = COLS.filter((c) => ["collectionPct", "collectionPctPrev"].includes(c.key));
  const onAccountCol = COLS.find((c) => c.key === "receivedOnAccount")!;
  const againstCol   = COLS.find((c) => c.key === "receivedAgainst")!;
  const totalCol     = COLS.find((c) => c.key === "received")!;
  const pendingCol   = COLS.find((c) => c.key === "pending")!;

  /** A sortable column header cell (used for every non-grouped column). */
  const sortHead = (col: Col, rowSpan?: number) => (
    <TableHead
      key={col.key}
      rowSpan={rowSpan}
      className={`text-xs font-semibold text-foreground/70 cursor-pointer select-none ${col.wrap ? "" : "whitespace-nowrap"} ${col.width ?? ""} ${col.align === "right" ? "text-right" : ""}`}
      onClick={() => toggleSort(col.key)}
    >
      <span className={`inline-flex items-center gap-1 ${col.align === "right" ? "justify-end w-full" : ""}`}>
        {col.label}
        {sortIcon(col.key)}
      </span>
    </TableHead>
  );

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

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-button bg-primary/15 flex items-center justify-center">
            <HandCoins className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Salesperson Collection Report</h1>
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

      {/* Filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">View</span>
              <div className="inline-flex rounded-input border border-border h-9 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewMode("customer")}
                  className={`px-3 text-sm font-medium transition-colors ${viewMode === "customer" ? "bg-primary text-primary-foreground" : "bg-transparent text-foreground hover:bg-muted/50"}`}
                >
                  Customers
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("group")}
                  className={`px-3 text-sm font-medium transition-colors border-l border-border ${viewMode === "group" ? "bg-primary text-primary-foreground" : "bg-transparent text-foreground hover:bg-muted/50"}`}
                >
                  Groups
                </button>
              </div>
            </div>
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
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground -mt-3">
        Total Pending = "As on {formatDateLong(asOfDate)}" (Overdue — matches the dashboard's overview) + "Till month-end" (bills coming due by {selectedMonth ? monthEndLong(selectedMonth) : "month-end"}). Due = Pending + Received; Outstanding = start-of-month balance. Received = On Account (advance / unallocated) + Against Invoices, and includes manual "other payments". Use the +/− toggles to show or hide each breakup.
      </p>

      {/* Main table */}
      <Card className="rounded-card border-border bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {spRows.length} salesperson{spRows.length !== 1 ? "s" : ""}
          </span>
          <span className="text-[11px] text-muted-foreground">Click a salesperson to drill into {viewMode === "group" ? "groups" : "customers"} + see their monthly trend below</span>
        </div>
        <ScrollableTable>
          <Table>
            <TableHeader>
              {/* Received and Total Pending are each collapsed by default (Total only, with a +
                  toggle). When expanded, a two-row header groups their breakup under the banner. */}
              <TableRow className="bg-muted/50">
                <TableHead className="w-8" rowSpan={anyExpanded ? 2 : 1} />
                {leadingCols.map((col) => sortHead(col, anyExpanded ? 2 : 1))}
                {receivedExpanded ? (
                  <TableHead colSpan={3} className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border">
                    <span className="inline-flex items-center justify-center">{receivedLabel}{receivedToggle}</span>
                  </TableHead>
                ) : (
                  <TableHead
                    rowSpan={anyExpanded ? 2 : 1}
                    className="text-xs font-semibold text-foreground/70 cursor-pointer select-none whitespace-nowrap text-right border-l border-border"
                    onClick={() => toggleSort("received")}
                  >
                    <span className="inline-flex items-center gap-1 justify-end w-full">{receivedLabel}{sortIcon("received")}{receivedToggle}</span>
                  </TableHead>
                )}
                {pendingExpanded ? (
                  <TableHead colSpan={3} className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border">
                    <span className="inline-flex items-center justify-center">{pendingCol.label}{pendingToggle}</span>
                  </TableHead>
                ) : (
                  <TableHead
                    rowSpan={anyExpanded ? 2 : 1}
                    className="text-xs font-semibold text-foreground/70 cursor-pointer select-none whitespace-nowrap text-right border-l border-border"
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
              {spRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLS.length + 1} className="text-center py-12 text-muted-foreground">
                    No salespersons match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {/* Grand total row */}
                  <TableRow className="bg-muted/60 border-b-2 border-border/60 font-semibold">
                    <TableCell />
                    <TableCell className="text-sm whitespace-nowrap uppercase tracking-wide text-foreground/80">Grand Total</TableCell>
                    {drillCell(allCustomerIds, "outstanding", "Grand Total", "text-sm text-right font-mono", fmt(startMonthOutstanding(totals)))}
                    {drillCell(allCustomerIds, "due", "Grand Total", "text-sm text-right font-mono", fmt(totals.due))}
                    {receivedExpanded && <>
                      <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(totals.receivedOnAccount)}</TableCell>
                      <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(totals.receivedAgainst)}</TableCell>
                    </>}
                    <TableCell className="text-sm text-right font-mono">{fmt(totals.received)}</TableCell>
                    {pendingExpanded && <>
                      <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(totals.pending - totals.dueSoon)}</TableCell>
                      <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(totals.dueSoon)}</TableCell>
                    </>}
                    {drillCell(allCustomerIds, "pending", "Grand Total", `text-sm text-right font-mono ${totals.pending > 0 ? "text-destructive" : ""}`, fmt(totals.pending))}
                    <TableCell className={`text-sm text-right font-mono ${pctStyle(collectionPct(totals))}`}>
                      {collectionPct(totals) === null ? "—" : `${(collectionPct(totals) as number).toFixed(1)}%`}
                    </TableCell>
                    <TableCell className={`text-sm text-right font-mono ${pctStyle(collectionPct(totalsPrev))}`}>
                      {prevMonth == null || collectionPct(totalsPrev) === null ? "—" : `${(collectionPct(totalsPrev) as number).toFixed(1)}%`}
                    </TableCell>
                  </TableRow>

                  {spRows.map((row) => {
                    const isOpen = expanded.has(row.salesperson);
                    const isSelected = selectedSalesperson === row.salesperson;
                    const pct = collectionPct(row.m);
                    const pctPrev = collectionPct(row.mPrev);
                    return (
                      <Fragment key={row.salesperson}>
                        <TableRow
                          className={`transition-colors cursor-pointer ${isSelected ? "bg-primary/10" : isOpen ? "bg-primary/5" : "hover:bg-muted/30"}`}
                          onClick={() => { toggleExpand(row.salesperson); setSelectedSalesperson(row.salesperson); }}
                        >
                          <TableCell className="text-muted-foreground">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-medium text-sm whitespace-nowrap">
                            {row.salesperson}
                            <span className="ml-1.5 text-[11px] text-muted-foreground">({row.rows.length})</span>
                          </TableCell>
                          {drillCell(row.customerIds, "outstanding", row.salesperson, "text-sm text-right font-mono font-semibold", fmt(startMonthOutstanding(row.m)))}
                          {drillCell(row.customerIds, "due", row.salesperson, "text-sm text-right font-mono", fmt(row.m.due))}
                          {receivedExpanded && <>
                            <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(row.m.receivedOnAccount)}</TableCell>
                            <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(row.m.receivedAgainst)}</TableCell>
                          </>}
                          <TableCell className="text-sm text-right font-mono">{fmt(row.m.received)}</TableCell>
                          {pendingExpanded && <>
                            <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(row.m.pending - row.m.dueSoon)}</TableCell>
                            <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(row.m.dueSoon)}</TableCell>
                          </>}
                          {drillCell(row.customerIds, "pending", row.salesperson, `text-sm text-right font-mono font-semibold ${row.m.pending > 0 ? "text-destructive" : ""}`, fmt(row.m.pending))}
                          <TableCell className={`text-sm text-right font-mono ${pctStyle(pct)}`}>
                            {pct === null ? "—" : `${pct.toFixed(1)}%`}
                          </TableCell>
                          <TableCell className={`text-sm text-right font-mono ${pctStyle(pctPrev)}`}>
                            {prevMonth == null || pctPrev === null ? "—" : `${pctPrev.toFixed(1)}%`}
                          </TableCell>
                        </TableRow>

                        {isOpen && row.rows.map((drill) => {
                          const cpct = collectionPct(drill.m);
                          const cpctPrev = collectionPct(drill.mPrev);
                          const groupKey = `${row.salesperson}::${drill.key}`;
                          const canExpand = drill.isGroup && drill.children.length > 0;
                          const groupOpen = canExpand && expandedGroups.has(groupKey);
                          return (
                            <Fragment key={`${row.salesperson}-${drill.key}`}>
                              <TableRow
                                className={`bg-muted/20 transition-colors text-[13px] ${canExpand ? "cursor-pointer hover:bg-muted/40" : ""}`}
                                onClick={canExpand ? () => toggleGroup(groupKey) : undefined}
                              >
                                <TableCell className="text-muted-foreground pl-4">
                                  {canExpand && (groupOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
                                </TableCell>
                                <TableCell className="whitespace-nowrap pl-6 text-muted-foreground">
                                  {drill.name}
                                  {drill.sub && <span className="ml-1.5 text-[10px] opacity-70">{drill.sub}</span>}
                                </TableCell>
                                {drillCell(drill.customerIds, "outstanding", drill.name, "text-right font-mono", fmt(startMonthOutstanding(drill.m)))}
                                {drillCell(drill.customerIds, "due", drill.name, "text-right font-mono", fmt(drill.m.due))}
                                {receivedExpanded && <>
                                  <TableCell className="text-right font-mono text-muted-foreground border-l border-border/60">{fmt(drill.m.receivedOnAccount)}</TableCell>
                                  <TableCell className="text-right font-mono text-muted-foreground">{fmt(drill.m.receivedAgainst)}</TableCell>
                                </>}
                                <TableCell className="text-right font-mono">{fmt(drill.m.received)}</TableCell>
                                {pendingExpanded && <>
                                  <TableCell className="text-right font-mono text-muted-foreground border-l border-border/60">{fmt(drill.m.pending - drill.m.dueSoon)}</TableCell>
                                  <TableCell className="text-right font-mono text-muted-foreground">{fmt(drill.m.dueSoon)}</TableCell>
                                </>}
                                {drillCell(drill.customerIds, "pending", drill.name, `text-right font-mono ${drill.m.pending > 0 ? "text-destructive/80" : ""}`, fmt(drill.m.pending))}
                                <TableCell className={`text-right font-mono ${pctStyle(cpct)}`}>
                                  {cpct === null ? "—" : `${cpct.toFixed(1)}%`}
                                </TableCell>
                                <TableCell className={`text-right font-mono ${pctStyle(cpctPrev)}`}>
                                  {prevMonth == null || cpctPrev === null ? "—" : `${cpctPrev.toFixed(1)}%`}
                                </TableCell>
                              </TableRow>

                              {groupOpen && drill.children.map((party) => {
                                const ppct = collectionPct(party.m);
                                const ppctPrev = collectionPct(party.mPrev);
                                return (
                                  <TableRow key={`${groupKey}-${party.key}`} className="bg-muted/10 text-[12px]">
                                    <TableCell />
                                    <TableCell className="whitespace-nowrap pl-12 text-muted-foreground">
                                      {party.name}
                                      <span className="ml-1.5 text-[10px] opacity-70">{party.sub}</span>
                                    </TableCell>
                                    {drillCell([party.key], "outstanding", party.name, "text-right font-mono", fmt(startMonthOutstanding(party.m)))}
                                    {drillCell([party.key], "due", party.name, "text-right font-mono", fmt(party.m.due))}
                                    {receivedExpanded && <>
                                      <TableCell className="text-right font-mono text-muted-foreground border-l border-border/60">{fmt(party.m.receivedOnAccount)}</TableCell>
                                      <TableCell className="text-right font-mono text-muted-foreground">{fmt(party.m.receivedAgainst)}</TableCell>
                                    </>}
                                    <TableCell className="text-right font-mono">{fmt(party.m.received)}</TableCell>
                                    {pendingExpanded && <>
                                      <TableCell className="text-right font-mono text-muted-foreground border-l border-border/60">{fmt(party.m.pending - party.m.dueSoon)}</TableCell>
                                      <TableCell className="text-right font-mono text-muted-foreground">{fmt(party.m.dueSoon)}</TableCell>
                                    </>}
                                    {drillCell([party.key], "pending", party.name, `text-right font-mono ${party.m.pending > 0 ? "text-destructive/80" : ""}`, fmt(party.m.pending))}
                                    <TableCell className={`text-right font-mono ${pctStyle(ppct)}`}>
                                      {ppct === null ? "—" : `${ppct.toFixed(1)}%`}
                                    </TableCell>
                                    <TableCell className={`text-right font-mono ${pctStyle(ppctPrev)}`}>
                                      {prevMonth == null || ppctPrev === null ? "—" : `${ppctPrev.toFixed(1)}%`}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </>
              )}
            </TableBody>
          </Table>
        </ScrollableTable>
      </Card>

      {/* Month-wise analysis panel — consolidated by default, or per selected salesperson */}
      {(() => {
        const scopeLabel = selectedSalesperson ?? "All salespersons";
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
              {selectedSalesperson && (
                <Button
                  variant="ghost" size="sm"
                  className="h-7 px-2 text-xs rounded-button text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => setSelectedSalesperson(null)}
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
                    <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap">Outstanding</TableHead>
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
              Outstanding = start-of-month balance (so it is always ≥ Due, the part of it due by month-end); Pending = Due − Received.
              Total row: Received = total collected across the months shown; Outstanding, Due, Pending &amp; Collection % = latest month ({latest?.month ?? "—"}) — balances aren't summed across months as they'd double-count.
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
