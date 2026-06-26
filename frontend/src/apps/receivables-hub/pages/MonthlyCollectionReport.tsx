import {
  useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, Fragment,
  type Dispatch, type SetStateAction, type CSSProperties,
} from "react";
import { Navigate } from "react-router-dom";
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import { HEADER_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";
import {
  HandCoins, RefreshCw, AlertTriangle, ChevronRight, ChevronDown,
  ArrowUpDown, ArrowUp, ArrowDown, Download, Search, Plus, Minus, Pin, Snowflake, Lock,
} from "lucide-react";
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
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { useFY } from "@hub/lib/fyContext";
import { useSession } from "@/core/platform/session";
import { computeOpenDue } from "@hub/lib/collectionMetrics";
import {
  loadSnapshot, snapshotCapturedAt, captureMonthSnapshot, type DueSnapshotRow,
} from "@hub/lib/collectionSnapshot";
import { BASE } from "@hub/lib/menus";
import type { Customer, SaleType } from "@hub/lib/types";

/* ── Constants ─────────────────────────────────────────────── */

/** Manager's collection target = this fraction of the (frozen) Due. */
const TARGET_RATE = 0.65;

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
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthLabelToEndDate(label: string): Date {
  const [mon, yy] = label.split("-");
  return new Date(2000 + parseInt(yy, 10), (MONTH_IDX[mon] ?? 0) + 1, 0, 23, 59, 59, 999);
}
function monthLabelToStartDate(label: string): Date {
  const [mon, yy] = label.split("-");
  return new Date(2000 + parseInt(yy, 10), MONTH_IDX[mon] ?? 0, 1);
}
function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}
const monthEndLong = (label: string) => ddmmyyyy(monthLabelToEndDate(label));
const monthStartLong = (label: string) => ddmmyyyy(monthLabelToStartDate(label));
function formatDateLong(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : ddmmyyyy(d);
}
function isoToMonthLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${MONTH_ABBR[d.getMonth()]}-${String(d.getFullYear() % 100).padStart(2, "0")}`;
}

/** Receipt / other-payment applied AGAINST a specific invoice (true) vs ON ACCOUNT (false). */
function isAgainstInvoice(type: string | null | undefined, refInvoice: string | null | undefined): boolean {
  const ty = (type ?? "").toUpperCase();
  if (ty.includes("ON ACC") || ty.includes("ADVANCE")) return false;
  if (ty.includes("AGST")) return true;
  return !!(refInvoice && refInvoice.trim());
}

const ALL_SALE_TYPES: SaleType[] = ["ink", "spare_parts", "machine", "head", "other"];
const SALE_TYPE_LABELS: Record<string, string> = {
  ink: "Ink", spare_parts: "Spare Parts", machine: "Machine", head: "Head", other: "Other",
};

/** Normalize a salesperson name: trim + UPPERCASE; blank / "Others" → "OTHERS". */
const spName = (s: string | undefined): string => {
  const t = (s ?? "").trim();
  return t ? t.toUpperCase() : "OTHERS";
};

/* ── Metrics ───────────────────────────────────────────────── */

// Only RAW, SUMMABLE fields are stored. Opening / Target / Pending / % are DERIVED at each
// aggregation level (see below) — never summed from per-customer values. This matters because
// credit/advance customers carry a NEGATIVE outstanding; deriving at the aggregate lets those
// negatives net the total down (summing a per-customer max(…) floor would wipe them out and
// over-state Opening — that was the 102/107 Cr bug).
interface Metrics {
  outstanding: number;      // live net balance (negative for advance/credit customers)
  due: number;              // frozen due-by-month-end (anchor)
  received: number;         // live month-to-date collections
  receivedOnAccount: number;
  receivedAgainst: number;
  dueSoon: number;          // frozen portion of `due` not yet overdue at capture
}
const emptyMetrics = (): Metrics => ({
  outstanding: 0, due: 0, received: 0, receivedOnAccount: 0, receivedAgainst: 0, dueSoon: 0,
});
const addInto = (t: Metrics, m: Metrics): void => {
  t.outstanding += m.outstanding; t.due += m.due; t.received += m.received;
  t.receivedOnAccount += m.receivedOnAccount; t.receivedAgainst += m.receivedAgainst; t.dueSoon += m.dueSoon;
};

// ── Derived figures (computed at each aggregation level) ──────────────────────────────
/** Start-of-month balance, reconstructed exactly like the existing report: the net balance
 *  with this month's collections added back, floored by Due. Σoutstanding nets advances. */
const openingOf = (m: Metrics): number => Math.max(m.outstanding + m.received, m.due);
const targetOf = (m: Metrics): number => TARGET_RATE * m.due;
const pendingOf = (m: Metrics): number => m.due - m.received;
/** Pending split: Received pays down the OVERDUE bucket first, then the coming-due bucket. */
const pendingOverdueOf = (m: Metrics): number => Math.max(Math.max(m.due - m.dueSoon, 0) - m.received, 0);
const pendingComingDueOf = (m: Metrics): number => {
  const overflow = Math.max(m.received - Math.max(m.due - m.dueSoon, 0), 0);
  return Math.max(m.dueSoon - overflow, 0);
};
const collectionPct = (m: Metrics): number | null => (m.due > 0 ? (m.received / m.due) * 100 : null);
const targetPct = (m: Metrics): number | null => { const t = targetOf(m); return t > 0 ? (m.received / t) * 100 : null; };

const pctStyle = (pct: number | null): string => {
  if (pct === null) return "";
  if (pct >= 90) return "text-emerald-600 font-semibold";
  if (pct >= 60) return "text-warning font-semibold";
  return "text-destructive font-semibold";
};

type SortKey = "salesperson" | "opening" | "due" | "target" | "received" | "pending" | "collectionPct" | "collectionPctPrev";
type SortDir = "asc" | "desc";

interface CustomerLine { id: string; name: string; sub: string; m: Metrics; mPrev: Metrics; }
interface SPRow { salesperson: string; rows: CustomerLine[]; m: Metrics; mPrev: Metrics; }

function sortRows<T extends { m: Metrics; mPrev: Metrics }>(
  arr: T[], name: (x: T) => string, key: SortKey, dir: number,
): void {
  arr.sort((a, b) => {
    if (key === "salesperson") return dir * name(a).localeCompare(name(b));
    if (key === "opening") return dir * (openingOf(a.m) - openingOf(b.m));
    if (key === "target") return dir * (targetOf(a.m) - targetOf(b.m));
    if (key === "pending") return dir * (pendingOf(a.m) - pendingOf(b.m));
    if (key === "collectionPct") return dir * ((collectionPct(a.m) ?? -1) - (collectionPct(b.m) ?? -1));
    if (key === "collectionPctPrev") return dir * ((collectionPct(a.mPrev) ?? -1) - (collectionPct(b.mPrev) ?? -1));
    return dir * (a.m[key] - b.m[key]); // due | received
  });
}

/* ── Component ─────────────────────────────────────────────── */

export default function MonthlyCollectionReport() {
  const { label: fyLabel } = useFY();
  const { isAdmin, user } = useSession();
  const { loading, error, allCustomers, customerDetail, dashboard } = useAppData();

  const asOfDate = dashboard?.asOfDate ?? new Date().toISOString().slice(0, 10);
  const months = useMemo(() => (dashboard?.trend ?? []).map((t) => t.month), [dashboard]);
  const asOfMonth = months.length ? months[months.length - 1] : "";

  // Filters
  const [monthState, setMonthState] = useState<string>("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [salesPersons, setSalesPersons] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [customerSegment, setCustomerSegment] = useState<"all" | "active" | "no_activity">("active");
  const [saleTypes, setSaleTypes] = useState<string[]>([]);
  const [customerSearch, setCustomerSearch] = useState<string>("");
  const [receivedExpanded, setReceivedExpanded] = useState<boolean>(false);
  const [pendingExpanded, setPendingExpanded] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("pending");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Freeze panes: 0 none, 1 Salesperson (default), 2 + Opening, 3 + Due.
  const [freezeLevel, setFreezeLevel] = useState<0 | 1 | 2 | 3>(1);
  const chevRef = useRef<HTMLTableCellElement>(null);
  const spHeadRef = useRef<HTMLTableCellElement>(null);
  const openHeadRef = useRef<HTMLTableCellElement>(null);
  const dueHeadRef = useRef<HTMLTableCellElement>(null);
  const [colW, setColW] = useState({ chev: 32, sp: 160, open: 130, due: 130 });

  // Snapshot state
  const [snapSelected, setSnapSelected] = useState<Map<string, DueSnapshotRow>>(new Map());
  const [snapPrev, setSnapPrev] = useState<Map<string, DueSnapshotRow>>(new Map());
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);

  useEffect(() => {
    if (months.length && !months.includes(monthState)) setMonthState(asOfMonth);
  }, [months, asOfMonth, monthState]);

  const selectedMonth = months.includes(monthState) ? monthState : asOfMonth;
  const isCurrentMonth = selectedMonth === asOfMonth;
  const prevMonth = useMemo(() => {
    const i = months.indexOf(selectedMonth);
    return i > 0 ? months[i - 1] : null;
  }, [months, selectedMonth]);

  // Load frozen snapshots for the selected + previous months.
  useEffect(() => {
    let alive = true;
    if (!selectedMonth) return;
    void loadSnapshot(selectedMonth).then((m) => { if (alive) setSnapSelected(m); });
    void snapshotCapturedAt(selectedMonth).then((t) => { if (alive) setCapturedAt(t); });
    return () => { alive = false; };
  }, [selectedMonth, reloadKey]);
  useEffect(() => {
    let alive = true;
    if (!prevMonth) { setSnapPrev(new Map()); return; }
    void loadSnapshot(prevMonth).then((m) => { if (alive) setSnapPrev(m); });
    return () => { alive = false; };
  }, [prevMonth, reloadKey]);

  // Dropdown options
  const companyOptions = useMemo(() => [...new Set(allCustomers.map((c) => c.company).filter(Boolean))].sort(), [allCustomers]);
  const locationOptions = useMemo(() => [...new Set(allCustomers.map((c) => c.location).filter(Boolean))].sort(), [allCustomers]);
  const salesPersonOptions = useMemo(() => [...new Set(allCustomers.map((c) => spName(c.salesPerson)))].sort(), [allCustomers]);

  // ── Sale-type filter (projection by sales-mix share; exact receipts via receiptsByType) ──
  const saleTypeActive = saleTypes.length > 0 && saleTypes.length < ALL_SALE_TYPES.length;
  const saleTypeSet = useMemo(() => new Set(saleTypes), [saleTypes]);
  const shareFor = useCallback((c: Customer): number => {
    if (!saleTypeActive) return 1;
    const salesTotal = ALL_SALE_TYPES.reduce((s, t) => s + (c.salesByType?.[t] ?? 0), 0);
    if (salesTotal > 1e-9) return saleTypes.reduce((s, t) => s + (c.salesByType?.[t as SaleType] ?? 0), 0) / salesTotal;
    return saleTypeSet.has("other") ? 1 : 0;
  }, [saleTypeActive, saleTypes, saleTypeSet]);
  const projectAmt = useCallback(
    (total: number, byType: Partial<Record<SaleType, number>> | undefined, share: number): number => {
      if (!saleTypeActive) return total;
      const typedSum = saleTypes.reduce((s, t) => s + (byType?.[t as SaleType] ?? 0), 0);
      const breakdownSum = ALL_SALE_TYPES.reduce((s, t) => s + (byType?.[t] ?? 0), 0);
      return typedSum + (total - breakdownSum) * share;
    },
    [saleTypeActive, saleTypes],
  );

  // Filtered raw customers
  const filteredCustomers = useMemo(() => {
    let d = allCustomers;
    if (companies.length) { const set = new Set(companies); d = d.filter((c) => set.has(c.company)); }
    if (locations.length) { const set = new Set(locations); d = d.filter((c) => set.has(c.location)); }
    if (salesPersons.length) { const set = new Set(salesPersons); d = d.filter((c) => set.has(spName(c.salesPerson))); }
    if (categories.length) d = d.filter((c) => matchesCategory(c, categories));
    if (customerSegment !== "all") {
      const act = new Map<string, { sales: number; receipts: number; creditNotes: number; otherPayments: number }>();
      for (const c of d) {
        let a = act.get(c.name);
        if (!a) { a = { sales: 0, receipts: 0, creditNotes: 0, otherPayments: 0 }; act.set(c.name, a); }
        a.sales += c.sales; a.receipts += c.receipts; a.creditNotes += c.creditNotes; a.otherPayments += c.otherPayments ?? 0;
      }
      const activeNames = new Set<string>();
      for (const [name, a] of act) if (a.sales > 0 || a.receipts > 0 || a.creditNotes > 0 || a.otherPayments > 0) activeNames.add(name);
      d = d.filter((c) => (customerSegment === "active" ? activeNames.has(c.name) : !activeNames.has(c.name)));
    }
    if (saleTypeActive) {
      d = d.filter((c) => {
        const hasInType = saleTypes.some((t) => (c.salesByType?.[t as SaleType] ?? 0) > 0 || (c.outstandingByType?.[t as SaleType] ?? 0) > 0);
        if (hasInType) return true;
        const salesTotal = ALL_SALE_TYPES.reduce((s, t) => s + (c.salesByType?.[t] ?? 0), 0);
        return salesTotal <= 1e-9 && saleTypeSet.has("other");
      });
    }
    const q = customerSearch.trim().toLowerCase();
    if (q) d = d.filter((c) => c.name.toLowerCase().includes(q));
    return d;
  }, [allCustomers, companies, locations, salesPersons, categories, customerSegment, saleTypeActive, saleTypes, saleTypeSet, customerSearch]);

  // Per-customer → per-month manual "other payments" (non-Tally), folded into Received.
  const otherPaymentsByCustomerMonth = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const c of allCustomers) {
      const txns = customerDetail[c.id]?.otherPaymentTransactions ?? [];
      if (!txns.length) continue;
      const byMonth = new Map<string, number>();
      for (const t of txns) { if (!t.date) continue; const lbl = isoToMonthLabel(t.date); if (lbl) byMonth.set(lbl, (byMonth.get(lbl) ?? 0) + t.amount); }
      if (byMonth.size) m.set(c.id, byMonth);
    }
    return m;
  }, [allCustomers, customerDetail]);

  // Per-customer → per-month on-account vs against-invoice split of Received.
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

  // Per-customer metrics for ONE month, with FROZEN opening/due from the snapshot (or a
  // labelled live/trend fallback). Received / Pending stay live.
  const metricsForMonth = useCallback((c: Customer, month: string, snap: Map<string, DueSnapshotRow>): Metrics => {
    const detail = customerDetail[c.id];
    const mt = detail?.trend.find((t) => t.month === month);
    const share = shareFor(c);

    // Received (live) — Tally receipts (tagged by bill sale type) + manual other payments.
    const opForMonth = otherPaymentsByCustomerMonth.get(c.id)?.get(month) ?? 0;
    const tallyReceipts = !saleTypeActive
      ? (mt?.receipts ?? 0) * 100_000
      : mt?.receiptsByType
        ? saleTypes.reduce((s, t) => s + (mt.receiptsByType?.[t as SaleType] ?? 0), 0) * 100_000
        : projectAmt((mt?.receipts ?? 0) * 100_000, undefined, share);
    const received = tallyReceipts + projectAmt(opForMonth, undefined, share);

    // Frozen due — snapshot first, else live computation.
    const snapRow = snap.get(c.id);
    let dueRaw: number, dueSoonRaw: number;
    if (snapRow) {
      dueRaw = snapRow.due; dueSoonRaw = snapRow.dueSoon;
    } else {
      const od = computeOpenDue(c, detail, month, asOfMonth, asOfDate);
      dueRaw = od.due; dueSoonRaw = od.dueSoon;
    }
    const due = projectAmt(dueRaw, undefined, share);
    const dueSoon = projectAmt(dueSoonRaw, undefined, share);

    // Live net balance (NOT frozen). Opening is DERIVED from this at the aggregate level
    // (openingOf) so advance/credit customers' negative balances net the total down — the
    // existing report does the same. Storing/summing a per-customer Opening over-states it.
    const obByType = mt?.outstandingByType
      ? (Object.fromEntries(ALL_SALE_TYPES.map((t) => [t, (mt.outstandingByType?.[t] ?? 0) * 100_000])) as Partial<Record<SaleType, number>>)
      : undefined;
    const outstanding = month === asOfMonth
      ? projectAmt(c.outstanding, c.outstandingByType, share)
      : projectAmt((mt?.outstanding ?? 0) * 100_000, obByType, share);

    // Split Received into on-account vs against-invoice by the month's raw allocation mix.
    const split = receivedSplitByCustomerMonth.get(c.id)?.get(month);
    const rawOn = split?.onAccount ?? 0;
    const rawTotal = rawOn + (split?.against ?? 0);
    const receivedOnAccount = rawTotal > 1e-9 ? received * (rawOn / rawTotal) : 0;
    const receivedAgainst = received - receivedOnAccount;

    return { outstanding, due, received, receivedOnAccount, receivedAgainst, dueSoon };
  }, [customerDetail, months, asOfMonth, asOfDate, shareFor, projectAmt, saleTypeActive, saleTypes, otherPaymentsByCustomerMonth, receivedSplitByCustomerMonth]);

  const customerMetrics = useMemo(() => {
    const map = new Map<string, Metrics>();
    for (const c of filteredCustomers) map.set(c.id, metricsForMonth(c, selectedMonth, snapSelected));
    return map;
  }, [filteredCustomers, selectedMonth, snapSelected, metricsForMonth]);
  const customerMetricsPrev = useMemo(() => {
    const map = new Map<string, Metrics>();
    if (prevMonth) for (const c of filteredCustomers) map.set(c.id, metricsForMonth(c, prevMonth, snapPrev));
    return map;
  }, [filteredCustomers, prevMonth, snapPrev, metricsForMonth]);

  const spRows = useMemo<SPRow[]>(() => {
    const map = new Map<string, { salesperson: string; customers: CustomerLine[]; m: Metrics; mPrev: Metrics }>();
    for (const c of filteredCustomers) {
      const sp = spName(c.salesPerson);
      const m = customerMetrics.get(c.id) ?? emptyMetrics();
      const mPrev = customerMetricsPrev.get(c.id) ?? emptyMetrics();
      if (Math.round(openingOf(m)) === 0 && Math.round(m.due) === 0 && Math.round(m.received) === 0) continue;
      let row = map.get(sp);
      if (!row) { row = { salesperson: sp, customers: [], m: emptyMetrics(), mPrev: emptyMetrics() }; map.set(sp, row); }
      row.customers.push({ id: c.id, name: c.name, sub: `${c.company} · ${c.location}`, m, mPrev });
      addInto(row.m, m); addInto(row.mPrev, mPrev);
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...map.values()].map((acc) => {
      const rows = [...acc.customers];
      sortRows(rows, (r) => r.name, sortKey, dir);
      return { salesperson: acc.salesperson, rows, m: acc.m, mPrev: acc.mPrev };
    });
    sortRows(arr, (r) => r.salesperson, sortKey, dir);
    return arr;
  }, [filteredCustomers, customerMetrics, customerMetricsPrev, sortKey, sortDir]);

  const totals = useMemo<Metrics>(() => { const t = emptyMetrics(); for (const r of spRows) addInto(t, r.m); return t; }, [spRows]);
  const totalsPrev = useMemo<Metrics>(() => { const t = emptyMetrics(); for (const r of spRows) addInto(t, r.mPrev); return t; }, [spRows]);

  // Measure leading column widths for sticky offsets.
  const measureCols = useCallback(() => {
    const chev = chevRef.current?.offsetWidth ?? 32;
    const sp = spHeadRef.current?.offsetWidth ?? 160;
    const open = openHeadRef.current?.offsetWidth ?? 130;
    const due = dueHeadRef.current?.offsetWidth ?? 130;
    setColW((prev) => (prev.chev === chev && prev.sp === sp && prev.open === open && prev.due === due ? prev : { chev, sp, open, due }));
  }, []);
  useLayoutEffect(measureCols);
  useEffect(() => { window.addEventListener("resize", measureCols); return () => window.removeEventListener("resize", measureCols); }, [measureCols]);

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
    setExpanded((prev) => { const next = new Set(prev); if (next.has(sp)) next.delete(sp); else next.add(sp); return next; });

  const handleCapture = async () => {
    if (capturedAt && !window.confirm(`A snapshot for ${selectedMonth} was already captured on ${formatDateLong(capturedAt)}.\n\nRe-capturing overwrites the frozen Opening / Due with TODAY's values. This is only correct at the very start of the month. Continue?`)) return;
    setCapturing(true); setCaptureMsg(null);
    try {
      const { count } = await captureMonthSnapshot({
        month: selectedMonth, prevMonth, asOfMonth, asOfDate,
        allCustomers, customerDetail, capturedBy: user?.id ?? null,
      });
      setCaptureMsg(`Froze ${count} customer rows for ${selectedMonth}.`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setCaptureMsg(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCapturing(false);
    }
  };

  const clearFilters = () => {
    setCompanies([]); setLocations([]); setSalesPersons([]); setCategories([]); setCustomerSegment("all"); setSaleTypes([]); setCustomerSearch("");
  };
  const filterChips: FilterChip[] = [
    companies.length > 0 && { label: companies.length <= 2 ? `Company: ${companies.join(", ")}` : `${companies.length} companies`, onRemove: () => setCompanies([]) },
    locations.length > 0 && { label: locations.length <= 2 ? `Location: ${locations.join(", ")}` : `${locations.length} locations`, onRemove: () => setLocations([]) },
    salesPersons.length > 0 && { label: salesPersons.length <= 2 ? `Person: ${salesPersons.join(", ")}` : `${salesPersons.length} persons`, onRemove: () => setSalesPersons([]) },
    categories.length > 0 && { label: categories.length <= 2 ? `Category: ${categories.join(", ")}` : `${categories.length} categories`, onRemove: () => setCategories([]) },
    customerSegment !== "all" && { label: `Segment: ${customerSegment === "active" ? "Active" : "No Activity"}`, onRemove: () => setCustomerSegment("all") },
    saleTypes.length > 0 && { label: saleTypes.length <= 2 ? `Type: ${saleTypes.map((t) => SALE_TYPE_LABELS[t] ?? t).join(", ")}` : `${saleTypes.length} types`, onRemove: () => setSaleTypes([]) },
    customerSearch.trim() && { label: `Search: ${customerSearch.trim()}`, onRemove: () => setCustomerSearch("") },
  ].filter(Boolean) as FilterChip[];

  // Labels
  const openingLabel = `Opening O/S (${selectedMonth ? monthStartLong(selectedMonth) : "—"})`;
  const dueLabel = `Due upto ${selectedMonth ? monthEndLong(selectedMonth) : "—"}`;
  const targetLabel = `Target (${Math.round(TARGET_RATE * 100)}%)`;
  const receivedLabel = `Received in ${selectedMonth || "—"}`;
  const pendingOverdueLabel = "Overdue";
  const pendingTillLabel = `Till ${selectedMonth ? monthEndLong(selectedMonth) : "month-end"}`;
  const frozen = snapSelected.size > 0;

  /* ── Export ── */
  const handleExport = () => {
    const aoa: (string | number)[][] = [];
    aoa.push(["Monthly Collection Report (v2)"]);
    aoa.push([`Financial Year: ${fyLabel}`]);
    aoa.push([`Month: ${selectedMonth}${isCurrentMonth ? " (current)" : ""}`]);
    aoa.push([`Frozen: ${frozen ? `Yes — captured ${capturedAt ? formatDateLong(capturedAt) : "—"}` : "No (live values)"}`]);
    aoa.push([]);
    aoa.push(["Salesperson", openingLabel, dueLabel, targetLabel, "On Account", "Against Invoices", receivedLabel, `Pending ${pendingOverdueLabel}`, `Pending ${pendingTillLabel}`, "Pending Total", `Collection % (${selectedMonth})`, prevMonth ? `Collection % (${prevMonth})` : "Collection % (prev)"]);
    const pctNum = (p: number | null) => (p === null ? "" : Math.round(p * 10) / 10);
    for (const r of spRows) {
      aoa.push([r.salesperson, openingOf(r.m), r.m.due, targetOf(r.m), r.m.receivedOnAccount, r.m.receivedAgainst, r.m.received, pendingOverdueOf(r.m), pendingComingDueOf(r.m), pendingOf(r.m), pctNum(collectionPct(r.m)), pctNum(collectionPct(r.mPrev))]);
    }
    aoa.push(["Grand Total", openingOf(totals), totals.due, targetOf(totals), totals.receivedOnAccount, totals.receivedAgainst, totals.received, pendingOverdueOf(totals), pendingComingDueOf(totals), pendingOf(totals), pctNum(collectionPct(totals)), pctNum(collectionPct(totalsPrev))]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 28 }, { wch: 20 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }];
    const INR = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';
    const firstData = 7; // 1-indexed first salesperson row (6 header rows)
    const lastData = firstData + spRows.length;
    for (let row = firstData; row <= lastData; row++) {
      for (const col of ["B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
        const cell = ws[`${col}${row}`];
        if (cell && typeof cell.v === "number") cell.z = INR;
      }
      for (const col of ["K", "L"]) {
        const cell = ws[`${col}${row}`];
        if (cell && typeof cell.v === "number") cell.z = '0.0"%"';
      }
    }
    styleRow(ws, 0, 12, HEADER_STYLE);
    styleRow(ws, 5, 12, HEADER_STYLE);
    styleRow(ws, 6 + spRows.length, 12, GRAND_TOTAL_STYLE);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Collection");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Monthly-Collection_${selectedMonth}_${asOfDate}.xlsx`);
  };

  /* ── Freeze panes ── */
  type FreezeId = "chevron" | "salesperson" | "opening" | "due";
  type FreezeStick = { className: string; style?: CSSProperties };
  const freezeLevelOf = (id: FreezeId): 1 | 2 | 3 => (id === "opening" ? 2 : id === "due" ? 3 : 1);
  const leftOf = (id: FreezeId): number =>
    id === "chevron" ? 0 : id === "salesperson" ? colW.chev
    : id === "opening" ? colW.chev + colW.sp
    : colW.chev + colW.sp + colW.open;
  const freezeStick = (id: FreezeId, opts?: { header?: boolean; bg?: string }): FreezeStick => {
    if (freezeLevel < freezeLevelOf(id)) return { className: "" };
    const bg = opts?.bg ?? (opts?.header ? "bg-muted" : "bg-surface");
    const boundary = id !== "chevron" && freezeLevelOf(id) === freezeLevel;
    const shadow = boundary ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.18)]" : "";
    return { className: `sticky ${opts?.header ? "z-20" : "z-10"} ${bg} ${shadow}`, style: { left: leftOf(id) } };
  };
  const freezePin = (level: 1 | 2 | 3) => {
    const active = freezeLevel >= level;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setFreezeLevel(freezeLevel === level ? (level - 1) as 0 | 1 | 2 : level); }}
        className={`ml-1 inline-flex items-center justify-center h-4 w-4 rounded shrink-0 ${active ? "text-primary" : "text-foreground/35 hover:text-foreground/70"}`}
        title={active ? "Unfreeze this column" : "Freeze columns up to here"}
      >
        <Pin className={`h-3 w-3 ${active ? "fill-primary" : ""}`} />
      </button>
    );
  };
  const makeToggle = (expandedState: boolean, set: Dispatch<SetStateAction<boolean>>, hint: string) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); set((v) => !v); }}
      className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded border border-border/70 text-foreground/60 hover:bg-muted hover:text-foreground shrink-0"
      title={expandedState ? `Hide ${hint}` : `Show ${hint}`}
    >
      {expandedState ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
    </button>
  );
  const receivedToggle = makeToggle(receivedExpanded, setReceivedExpanded, "On Account / Against Invoices breakup");
  const pendingToggle = makeToggle(pendingExpanded, setPendingExpanded, "Overdue / Till-month-end breakup");
  const anyExpanded = receivedExpanded || pendingExpanded;

  // Number of body columns (for empty-state colspan): chevron + sp + opening + due + target
  // + received(1 or 3) + pending(1 or 3) + targetMet% + 2 collection%.
  const totalCols = 5 + (receivedExpanded ? 3 : 1) + (pendingExpanded ? 3 : 1) + 3;

  /* ── Render ── */
  if (!isAdmin) return <Navigate to={BASE} replace />;

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

  const pctCell = (p: number | null) => (p === null ? "—" : `${p.toFixed(1)}%`);

  return (
    <div className="p-6 space-y-5 max-w-[1500px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-button bg-primary/15 flex items-center justify-center">
            <HandCoins className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Collection Report (v2)</h1>
            <p className="text-sm text-muted-foreground">
              {fyLabel} · {selectedMonth || "—"} · as on {formatDateLong(asOfDate)}
              <span className="ml-2 inline-flex items-center gap-1 text-[11px]">
                {frozen ? (
                  <span className="text-emerald-600"><Lock className="h-3 w-3 inline mr-0.5" />Frozen{capturedAt ? ` ${formatDateLong(capturedAt)}` : ""}</span>
                ) : (
                  <span className="text-warning"><Snowflake className="h-3 w-3 inline mr-0.5" />Not frozen (live)</span>
                )}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" className="rounded-button" onClick={handleCapture} disabled={capturing}>
            <Snowflake className={`h-4 w-4 mr-2 ${capturing ? "animate-spin" : ""}`} />
            {capturing ? "Capturing…" : frozen ? `Re-capture ${selectedMonth}` : `Capture ${selectedMonth}`}
          </Button>
          <Button variant="outline" size="sm" className="rounded-button border-border" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export Excel
          </Button>
        </div>
      </div>

      {captureMsg && (
        <div className="text-xs rounded-card border border-border bg-muted/40 px-3 py-2 text-foreground/80">{captureMsg}</div>
      )}

      {/* Frozen / not-frozen banner */}
      {!frozen && isCurrentMonth && (
        <div className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground/80">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <span>
            <strong>Due is not frozen for {selectedMonth} yet</strong> — it is showing live values that drift through the month.
            Click <em>Capture {selectedMonth}</em> (ideally on the 1st) to freeze it so Received + Pending reconciles against a fixed Due. (Opening is always the live start-of-month reconstruction, matching the main report.)
          </span>
        </div>
      )}
      {!frozen && !isCurrentMonth && (
        <div className="flex items-start gap-2 rounded-card border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>No frozen snapshot for {selectedMonth}. Opening / Due are estimated from the month-end trend.</span>
        </div>
      )}

      {/* Filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Month</span>
              <Select value={selectedMonth} onValueChange={setMonthState}>
                <SelectTrigger className="w-[130px] rounded-input border-border text-sm h-9"><SelectValue placeholder="Month" /></SelectTrigger>
                <SelectContent className="rounded-input max-h-72">
                  {months.map((m) => (<SelectItem key={m} value={m}>{m}{m === asOfMonth ? " (current)" : ""}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Company</span>
              <MultiSelect options={companyOptions} value={companies} onChange={setCompanies} allLabel="All Companies" noun="companies" triggerClassName="w-40 h-9 text-sm rounded-input border-border" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Location</span>
              <MultiSelect options={locationOptions} value={locations} onChange={setLocations} allLabel="All Locations" noun="locations" triggerClassName="w-40 h-9 text-sm rounded-input border-border" />
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
                <SelectTrigger className="w-40 rounded-input border-border h-9 text-sm"><SelectValue /></SelectTrigger>
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
                <Input placeholder="Search customer..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} className="pl-9 h-9 rounded-input border-border text-sm" />
              </div>
            </div>
          </div>
          <FilterChips chips={filterChips} onClearAll={clearFilters} />
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        <strong>Opening O/S</strong> = start-of-month balance (net outstanding + this month's collections added back, floored by Due) — same basis as the main Collection Report. <strong>Due upto {selectedMonth ? monthEndLong(selectedMonth) : "month-end"}</strong> is the <strong>frozen</strong> anchor (captured at month start, doesn't drift); <strong>Target</strong> = {Math.round(TARGET_RATE * 100)}% of Due. <strong>{selectedMonth || "Month"} to-date (live):</strong> Received = On Account + Against Invoices (incl. manual other payments); Pending = Due − Received (Overdue first, then coming-due); Collection % = Received ÷ Due. Because Due is frozen, Received + Pending always reconciles to it.
      </p>

      {/* Main table */}
      <Card className="rounded-card border-border bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{spRows.length} salesperson{spRows.length !== 1 ? "s" : ""}</span>
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">Click a salesperson to drill into customers; use the <Pin className="h-3 w-3 inline" /> on a column to freeze it while scrolling</span>
        </div>
        <ScrollableTable>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead ref={chevRef} rowSpan={anyExpanded ? 2 : 1} style={freezeStick("chevron", { header: true }).style} className={`w-8 ${freezeStick("chevron", { header: true }).className}`} />
                {/* Salesperson */}
                {(() => { const f = freezeStick("salesperson", { header: true }); return (
                  <TableHead ref={spHeadRef} rowSpan={anyExpanded ? 2 : 1} style={f.style} className={`text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none w-[110px] ${f.className}`} onClick={() => toggleSort("salesperson")}>
                    <span className="inline-flex items-center gap-1">Salesperson{sortIcon("salesperson")}{freezePin(1)}</span>
                  </TableHead>
                ); })()}
                {/* Opening (frozen) */}
                {(() => { const f = freezeStick("opening", { header: true }); return (
                  <TableHead ref={openHeadRef} rowSpan={anyExpanded ? 2 : 1} style={f.style} className={`text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none w-[140px] text-right ${f.className}`} onClick={() => toggleSort("opening")}>
                    <span className="inline-flex items-center gap-1 justify-end w-full">{openingLabel}{sortIcon("opening")}{freezePin(2)}</span>
                  </TableHead>
                ); })()}
                {/* Due (frozen) */}
                {(() => { const f = freezeStick("due", { header: true }); return (
                  <TableHead ref={dueHeadRef} rowSpan={anyExpanded ? 2 : 1} style={f.style} className={`text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none w-[130px] text-right ${f.className}`} onClick={() => toggleSort("due")}>
                    <span className="inline-flex items-center gap-1 justify-end w-full">{dueLabel}{sortIcon("due")}{freezePin(3)}</span>
                  </TableHead>
                ); })()}
                {/* Target */}
                <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none w-[100px] text-right" onClick={() => toggleSort("target")}>
                  <span className="inline-flex items-center gap-1 justify-end w-full">{targetLabel}{sortIcon("target")}</span>
                </TableHead>
                {/* Received */}
                {receivedExpanded ? (
                  <TableHead colSpan={3} className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border">
                    <span className="inline-flex items-center justify-center">{receivedLabel}{receivedToggle}</span>
                  </TableHead>
                ) : (
                  <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none w-[110px] text-right border-l border-border" onClick={() => toggleSort("received")}>
                    <span className="inline-flex items-center gap-1 justify-end w-full">{receivedLabel}{sortIcon("received")}{receivedToggle}</span>
                  </TableHead>
                )}
                {/* Pending */}
                {pendingExpanded ? (
                  <TableHead colSpan={3} className="text-xs font-semibold text-foreground/70 text-center whitespace-nowrap border-l border-border">
                    <span className="inline-flex items-center justify-center">Pending{pendingToggle}</span>
                  </TableHead>
                ) : (
                  <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none w-[100px] text-right border-l border-border" onClick={() => toggleSort("pending")}>
                    <span className="inline-flex items-center gap-1 justify-end w-full">Pending{sortIcon("pending")}{pendingToggle}</span>
                  </TableHead>
                )}
                {/* Target Met % */}
                <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 text-right whitespace-nowrap w-[90px] border-l border-border">Target Met %</TableHead>
                {/* Collection % current + prev */}
                <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none w-[95px] text-right" onClick={() => toggleSort("collectionPct")}>
                  <span className="inline-flex items-center gap-1 justify-end w-full">{prevMonth ? `Coll % (${selectedMonth})` : "Coll %"}{sortIcon("collectionPct")}</span>
                </TableHead>
                <TableHead rowSpan={anyExpanded ? 2 : 1} className="text-xs font-semibold text-foreground/70 leading-tight align-middle cursor-pointer select-none w-[95px] text-right" onClick={() => toggleSort("collectionPctPrev")}>
                  <span className="inline-flex items-center gap-1 justify-end w-full">{prevMonth ? `Coll % (${prevMonth})` : "Coll % (prev)"}{sortIcon("collectionPctPrev")}</span>
                </TableHead>
              </TableRow>
              {anyExpanded && (
                <TableRow className="bg-muted/50">
                  {receivedExpanded && <>
                    <TableHead className="text-xs font-medium text-foreground/60 whitespace-nowrap text-right border-l border-border">On Account</TableHead>
                    <TableHead className="text-xs font-medium text-foreground/60 whitespace-nowrap text-right">Against Invoices</TableHead>
                    <TableHead className="text-xs font-medium text-foreground/60 whitespace-nowrap text-right">Total</TableHead>
                  </>}
                  {pendingExpanded && <>
                    <TableHead className="text-xs font-medium text-foreground/60 whitespace-nowrap text-right border-l border-border">{pendingOverdueLabel}</TableHead>
                    <TableHead className="text-xs font-medium text-foreground/60 whitespace-nowrap text-right">{pendingTillLabel}</TableHead>
                    <TableHead className="text-xs font-medium text-foreground/60 whitespace-nowrap text-right">Total</TableHead>
                  </>}
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {spRows.length === 0 ? (
                <TableRow><TableCell colSpan={totalCols} className="text-center py-12 text-muted-foreground">No salespersons match your filters.</TableCell></TableRow>
              ) : (
                <>
                  {/* Grand total */}
                  <TableRow className="bg-muted/60 border-b-2 border-border/60 font-semibold">
                    <TableCell style={freezeStick("chevron", { bg: "bg-muted" }).style} className={freezeStick("chevron", { bg: "bg-muted" }).className} />
                    <TableCell style={freezeStick("salesperson", { bg: "bg-muted" }).style} className={`text-sm whitespace-nowrap uppercase tracking-wide text-foreground/80 ${freezeStick("salesperson", { bg: "bg-muted" }).className}`}>Grand Total</TableCell>
                    {(() => { const f = freezeStick("opening", { bg: "bg-muted" }); return (<TableCell style={f.style} className={`text-sm text-right font-mono ${f.className}`}>{fmt(openingOf(totals))}</TableCell>); })()}
                    {(() => { const f = freezeStick("due", { bg: "bg-muted" }); return (<TableCell style={f.style} className={`text-sm text-right font-mono ${f.className}`}>{fmt(totals.due)}</TableCell>); })()}
                    <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(targetOf(totals))}</TableCell>
                    {receivedExpanded && <>
                      <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(totals.receivedOnAccount)}</TableCell>
                      <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(totals.receivedAgainst)}</TableCell>
                    </>}
                    <TableCell className={`text-sm text-right font-mono ${receivedExpanded ? "" : "border-l border-border/60"}`}>{fmt(totals.received)}</TableCell>
                    {pendingExpanded && <>
                      <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(pendingOverdueOf(totals))}</TableCell>
                      <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(pendingComingDueOf(totals))}</TableCell>
                    </>}
                    <TableCell className={`text-sm text-right font-mono ${pendingExpanded ? "" : "border-l border-border/60"} ${pendingOf(totals) > 0 ? "text-destructive" : ""}`}>{fmt(pendingOf(totals))}</TableCell>
                    <TableCell className={`text-sm text-right font-mono border-l border-border/60 ${pctStyle(targetPct(totals))}`}>{pctCell(targetPct(totals))}</TableCell>
                    <TableCell className={`text-sm text-right font-mono ${pctStyle(collectionPct(totals))}`}>{pctCell(collectionPct(totals))}</TableCell>
                    <TableCell className={`text-sm text-right font-mono ${pctStyle(collectionPct(totalsPrev))}`}>{prevMonth == null ? "—" : pctCell(collectionPct(totalsPrev))}</TableCell>
                  </TableRow>

                  {spRows.map((row) => {
                    const isOpen = expanded.has(row.salesperson);
                    const pct = collectionPct(row.m);
                    const pctPrev = collectionPct(row.mPrev);
                    const tpct = targetPct(row.m);
                    return (
                      <Fragment key={row.salesperson}>
                        <TableRow className={`group transition-colors cursor-pointer ${isOpen ? "bg-primary/5" : "hover:bg-muted/30"}`} onClick={() => toggleExpand(row.salesperson)}>
                          {(() => { const f = freezeStick("chevron", { bg: "bg-surface group-hover:bg-[hsl(var(--muted))]" }); return (
                            <TableCell style={f.style} className={`text-muted-foreground ${f.className}`}>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                          ); })()}
                          {(() => { const f = freezeStick("salesperson", { bg: "bg-surface group-hover:bg-[hsl(var(--muted))]" }); return (
                            <TableCell style={f.style} className={`font-medium text-sm whitespace-nowrap ${f.className}`}>{row.salesperson}<span className="ml-1.5 text-[11px] text-muted-foreground">({row.rows.length})</span></TableCell>
                          ); })()}
                          {(() => { const f = freezeStick("opening", { bg: "bg-surface group-hover:bg-[hsl(var(--muted))]" }); return (<TableCell style={f.style} className={`text-sm text-right font-mono font-semibold ${f.className}`}>{fmt(openingOf(row.m))}</TableCell>); })()}
                          {(() => { const f = freezeStick("due", { bg: "bg-surface group-hover:bg-[hsl(var(--muted))]" }); return (<TableCell style={f.style} className={`text-sm text-right font-mono ${f.className}`}>{fmt(row.m.due)}</TableCell>); })()}
                          <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(targetOf(row.m))}</TableCell>
                          {receivedExpanded && <>
                            <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(row.m.receivedOnAccount)}</TableCell>
                            <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(row.m.receivedAgainst)}</TableCell>
                          </>}
                          <TableCell className={`text-sm text-right font-mono ${receivedExpanded ? "" : "border-l border-border/60"}`}>{fmt(row.m.received)}</TableCell>
                          {pendingExpanded && <>
                            <TableCell className="text-sm text-right font-mono text-muted-foreground border-l border-border/60">{fmt(pendingOverdueOf(row.m))}</TableCell>
                            <TableCell className="text-sm text-right font-mono text-muted-foreground">{fmt(pendingComingDueOf(row.m))}</TableCell>
                          </>}
                          <TableCell className={`text-sm text-right font-mono font-semibold ${pendingExpanded ? "" : "border-l border-border/60"} ${pendingOf(row.m) > 0 ? "text-destructive" : ""}`}>{fmt(pendingOf(row.m))}</TableCell>
                          <TableCell className={`text-sm text-right font-mono border-l border-border/60 ${pctStyle(tpct)}`}>{pctCell(tpct)}</TableCell>
                          <TableCell className={`text-sm text-right font-mono ${pctStyle(pct)}`}>{pctCell(pct)}</TableCell>
                          <TableCell className={`text-sm text-right font-mono ${pctStyle(pctPrev)}`}>{prevMonth == null ? "—" : pctCell(pctPrev)}</TableCell>
                        </TableRow>

                        {isOpen && row.rows.map((cl) => {
                          const cpct = collectionPct(cl.m);
                          const cpctPrev = collectionPct(cl.mPrev);
                          const ctpct = targetPct(cl.m);
                          return (
                            <TableRow key={cl.id} className="bg-muted/20 text-[13px]">
                              <TableCell style={freezeStick("chevron", { bg: "bg-surface" }).style} className={freezeStick("chevron", { bg: "bg-surface" }).className} />
                              {(() => { const f = freezeStick("salesperson", { bg: "bg-surface" }); return (
                                <TableCell style={f.style} className={`whitespace-nowrap pl-6 text-muted-foreground ${f.className}`}>{cl.name}<span className="ml-1.5 text-[10px] opacity-70">{cl.sub}</span></TableCell>
                              ); })()}
                              {(() => { const f = freezeStick("opening", { bg: "bg-surface" }); return (<TableCell style={f.style} className={`text-right font-mono ${f.className}`}>{fmt(openingOf(cl.m))}</TableCell>); })()}
                              {(() => { const f = freezeStick("due", { bg: "bg-surface" }); return (<TableCell style={f.style} className={`text-right font-mono ${f.className}`}>{fmt(cl.m.due)}</TableCell>); })()}
                              <TableCell className="text-right font-mono text-muted-foreground">{fmt(targetOf(cl.m))}</TableCell>
                              {receivedExpanded && <>
                                <TableCell className="text-right font-mono text-muted-foreground border-l border-border/60">{fmt(cl.m.receivedOnAccount)}</TableCell>
                                <TableCell className="text-right font-mono text-muted-foreground">{fmt(cl.m.receivedAgainst)}</TableCell>
                              </>}
                              <TableCell className={`text-right font-mono ${receivedExpanded ? "" : "border-l border-border/60"}`}>{fmt(cl.m.received)}</TableCell>
                              {pendingExpanded && <>
                                <TableCell className="text-right font-mono text-muted-foreground border-l border-border/60">{fmt(pendingOverdueOf(cl.m))}</TableCell>
                                <TableCell className="text-right font-mono text-muted-foreground">{fmt(pendingComingDueOf(cl.m))}</TableCell>
                              </>}
                              <TableCell className={`text-right font-mono ${pendingExpanded ? "" : "border-l border-border/60"} ${pendingOf(cl.m) > 0 ? "text-destructive/80" : ""}`}>{fmt(pendingOf(cl.m))}</TableCell>
                              <TableCell className={`text-right font-mono border-l border-border/60 ${pctStyle(ctpct)}`}>{pctCell(ctpct)}</TableCell>
                              <TableCell className={`text-right font-mono ${pctStyle(cpct)}`}>{pctCell(cpct)}</TableCell>
                              <TableCell className={`text-right font-mono ${pctStyle(cpctPrev)}`}>{prevMonth == null ? "—" : pctCell(cpctPrev)}</TableCell>
                            </TableRow>
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
    </div>
  );
}
