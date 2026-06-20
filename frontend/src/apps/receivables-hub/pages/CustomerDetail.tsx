import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useState, useMemo, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  ArrowLeft, Download, ShieldAlert, Clock, AlertTriangle,
  CreditCard, TrendingUp, RefreshCw, BookOpen, Building2, ChevronDown, X, Search,
  ArrowUpDown, ArrowUp, ArrowDown, Columns3, Loader2,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuItem,
} from "@hub/components/ui/dropdown-menu";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@hub/components/ui/collapsible";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@hub/components/ui/pagination";
import { Input } from "@hub/components/ui/input";
import { Checkbox } from "@hub/components/ui/checkbox";
import { useToast } from "@hub/hooks/use-toast";
import { useAppData, consolidateByName, consolidateByGroup } from "@hub/lib/useAppData";
import { utilizationPct } from "@hub/lib/receivables";
import { matchesSearch } from "@/shared/lib/search";
import { exportCustomerPdf, exportCustomerXlsx, exportTransactionsXlsx } from "@hub/lib/exportCustomer";
import type { InvoiceStatus } from "@hub/lib/types";

/* ── Types ─────────────────────────────────────────────── */

type RiskCategory = "critical" | "high" | "medium" | "low";

/* ── Helpers ───────────────────────────────────────────── */

import { fmtINRMoney, fmtINRDrCr, formatDateDMY } from "@hub/lib/utils";

const fmt = (n: number) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000)    return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

// Lakhs-denominated values (already divided by 100k)
const fmtL = (n: number) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 100) return `${sign}₹${(abs / 100).toFixed(2)} Cr`;
  return `${sign}₹${abs.toFixed(2)} L`;
};

// Lakhs-denominated value with explicit +/− sign
const fmtLDrCr = (n: number) => {
  if (!n || Math.abs(n) < 0.005) return "₹0";
  const prefix = n < 0 ? "− " : "+ ";
  const abs = Math.abs(n);
  if (abs >= 100) return `${prefix}₹${(abs / 100).toFixed(2)} Cr`;
  return `${prefix}₹${abs.toFixed(2)} L`;
};

const riskStyle: Record<RiskCategory, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  high:     "bg-primary/15 text-primary border-primary/30",
  medium:   "bg-warning/15 text-warning border-warning/30",
  low:      "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
};

const statusStyle: Record<InvoiceStatus, string> = {
  paid:    "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  partial: "bg-primary/15 text-primary border-primary/30",
  overdue: "bg-destructive/15 text-destructive border-destructive/30",
  pending: "bg-muted text-muted-foreground border-border",
};

const trendTabs = [
  { key: "all",                label: "All",            color: "" },
  { key: "sales",              label: "Sales",          color: "hsl(var(--primary))" },
  { key: "receipts",           label: "Receipts",       color: "hsl(142, 71%, 45%)" },
  { key: "creditNotes",        label: "Credit Notes",   color: "hsl(271, 75%, 58%)" },
  { key: "debitNotes",         label: "Debit Notes",    color: "hsl(28, 80%, 70%)" },
  { key: "journalAdjustments", label: "Journal (Net)",  color: "hsl(231, 65%, 75%)" },
  { key: "checkReturns",       label: "Chq Returns",    color: "hsl(213, 94%, 52%)" },
  { key: "outstanding",        label: "Outstanding",    color: "hsl(var(--secondary))" },
  { key: "overdue",            label: "Overdue",        color: "hsl(var(--destructive))" },
] as const;

const allLines = trendTabs.filter((t) => t.key !== "all");

// Toggleable columns for the Monthly Analysis table (Month is always shown as the row anchor)
const MONTHLY_COLS = [
  { key: "sales",              label: "Sales" },
  { key: "receipts",           label: "Receipts" },
  { key: "creditNotes",        label: "Credit Notes" },
  { key: "debitNotes",         label: "Debit Notes" },
  { key: "journalAdjustments", label: "Journal (Net)" },
  { key: "checkReturns",       label: "Chq Returns" },
  { key: "outstanding",        label: "Outstanding" },
  { key: "overdue",            label: "Overdue" },
] as const;

// Options for the Transactions multi-select filters (value ≠ display label).
const VOUCHER_TYPE_OPTIONS = [
  { value: "sales",        label: "Sales Invoice" },
  { value: "receipt",      label: "Receipt" },
  { value: "credit_note",  label: "Credit Note" },
  { value: "debit_note",   label: "Debit Note" },
  { value: "journal",      label: "Journal (Dr/Cr)" },
  { value: "check_return", label: "Cheque Return" },
  { value: "other_payment", label: "Other Payment" },
] as const;

const STATUS_OPTIONS = [
  { value: "paid",    label: "Paid" },
  { value: "partial", label: "Partial" },
  { value: "overdue", label: "Overdue" },
  { value: "pending", label: "Pending" },
] as const;

/* ── Transaction ledger types & column config ──────────────────────────── */

type TxnKind =
  | "sales" | "receipt" | "credit_note" | "debit_note"
  | "journal_dr" | "journal_cr" | "check_return" | "other_payment";

type TxnRow = {
  rowKey: string;
  date: string;
  kind: TxnKind;
  voucherNo: string;
  refInvoice: string | null;
  amount: number;
  signedAmount: number;        // + increases outstanding, − reduces
  received?: number;           // sales rows only: amount − pending
  pending?: number;
  dueDate?: string;
  overdueDays?: number;
  status?: InvoiceStatus;
  narration?: string;
  saleType?: string;           // sales rows only
  subType?: string;            // e.g. AGST REF / ON ACCOUNT for receipts
  _company: string;
  _location: string;
};

const TXN_TYPE_META: Record<TxnKind, { label: string; cls: string }> = {
  sales:        { label: "Sales",       cls: "bg-primary/10 text-primary border-primary/20" },
  receipt:      { label: "Receipt",     cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  credit_note:  { label: "Credit Note", cls: "bg-purple-100 text-purple-700 border-purple-200" },
  debit_note:   { label: "Debit Note",  cls: "bg-orange-100 text-orange-700 border-orange-200" },
  journal_dr:   { label: "Journal Dr",  cls: "bg-destructive/10 text-destructive border-destructive/20" },
  journal_cr:   { label: "Journal Cr",  cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  check_return: { label: "Chq Return",  cls: "bg-blue-100 text-blue-700 border-blue-200" },
  other_payment: { label: "Other Pmt",  cls: "bg-indigo-100 text-indigo-700 border-indigo-200" },
};

type TxnSortKey =
  | "date" | "kind" | "voucherNo" | "refInvoice"
  | "_company" | "_location"
  | "amount" | "received" | "pending"
  | "dueDate" | "overdueDays" | "status";

type TxnTotals = { amount: number; received: number; pending: number; salesCount: number };

type TxnColumn = {
  key: string;
  label: string;
  sortKey: TxnSortKey;
  align: "left" | "right";
  /** Only offered/shown on the consolidated (multi-entity) view. */
  consolidatedOnly?: boolean;
  cell: (r: TxnRow) => ReactNode;
  total?: (t: TxnTotals) => ReactNode;
  /** Raw value used for spreadsheet export. */
  exportValue: (r: TxnRow) => string | number;
};

// Single source of truth for the Transactions table: header, body, totals,
// the column selector, and export all derive from this list.
const TXN_COLUMNS: TxnColumn[] = [
  {
    key: "date", label: "Date", sortKey: "date", align: "left",
    cell: (r) => <span className="text-sm text-muted-foreground whitespace-nowrap">{formatDateDMY(r.date)}</span>,
    exportValue: (r) => formatDateDMY(r.date),
  },
  {
    key: "kind", label: "Type", sortKey: "kind", align: "left",
    cell: (r) => {
      const meta = TXN_TYPE_META[r.kind];
      return (
        <>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${meta.cls}`}>{meta.label}</Badge>
          {r.subType && (r.kind === "receipt" || r.kind === "other_payment") && (
            <span className="text-[10px] text-muted-foreground ml-1">{r.subType}</span>
          )}
        </>
      );
    },
    exportValue: (r) => TXN_TYPE_META[r.kind].label + (r.subType && (r.kind === "receipt" || r.kind === "other_payment") ? ` (${r.subType})` : ""),
  },
  {
    key: "voucherNo", label: "Voucher #", sortKey: "voucherNo", align: "left",
    cell: (r) => (
      <span className="text-sm font-mono whitespace-nowrap max-w-[160px] truncate inline-block align-bottom" title={r.voucherNo || "—"}>
        {r.voucherNo || "—"}
      </span>
    ),
    exportValue: (r) => r.voucherNo || "",
  },
  {
    key: "refInvoice", label: "Against / Ref", sortKey: "refInvoice", align: "left",
    cell: (r) => <span className="text-sm text-muted-foreground">{r.refInvoice ?? "—"}</span>,
    exportValue: (r) => r.refInvoice ?? "",
  },
  {
    key: "_company", label: "Company", sortKey: "_company", align: "left", consolidatedOnly: true,
    cell: (r) => <span className="text-sm text-muted-foreground">{r._company}</span>,
    exportValue: (r) => r._company,
  },
  {
    key: "_location", label: "Location", sortKey: "_location", align: "left", consolidatedOnly: true,
    cell: (r) => <span className="text-sm text-muted-foreground">{r._location}</span>,
    exportValue: (r) => r._location,
  },
  {
    key: "amount", label: "Amount", sortKey: "amount", align: "right",
    cell: (r) => <span className="text-sm text-right font-mono">{fmt(r.amount)}</span>,
    total: (t) => <span className="text-sm font-mono font-bold text-foreground">{fmt(t.amount)}</span>,
    exportValue: (r) => Math.round(r.amount),
  },
  {
    key: "received", label: "Received", sortKey: "received", align: "right",
    cell: (r) => {
      const isSales = r.kind === "sales";
      return (
        <span className={`text-sm text-right font-mono ${isSales && (r.received ?? 0) > 0 ? "font-semibold text-emerald-700" : "text-muted-foreground"}`}>
          {isSales ? fmt(r.received ?? 0) : "—"}
        </span>
      );
    },
    total: (t) => <span className="text-sm font-mono font-bold text-emerald-700">{t.salesCount > 0 ? fmt(t.received) : "—"}</span>,
    exportValue: (r) => (r.kind === "sales" ? Math.round(r.received ?? 0) : ""),
  },
  {
    key: "pending", label: "Pending", sortKey: "pending", align: "right",
    cell: (r) => {
      const isSales = r.kind === "sales";
      return (
        <span className={`text-sm text-right font-mono ${isSales && (r.pending ?? 0) > 0 ? "font-semibold" : "text-muted-foreground"}`}>
          {isSales ? fmt(r.pending ?? 0) : "—"}
        </span>
      );
    },
    total: (t) => <span className="text-sm font-mono font-bold text-destructive">{t.salesCount > 0 ? fmt(t.pending) : "—"}</span>,
    exportValue: (r) => (r.kind === "sales" ? Math.round(r.pending ?? 0) : ""),
  },
  {
    key: "dueDate", label: "Due Date", sortKey: "dueDate", align: "left",
    cell: (r) => <span className="text-sm text-muted-foreground">{r.kind === "sales" ? formatDateDMY(r.dueDate) : "—"}</span>,
    exportValue: (r) => (r.kind === "sales" ? formatDateDMY(r.dueDate) : ""),
  },
  {
    key: "overdueDays", label: "OD Days", sortKey: "overdueDays", align: "right",
    cell: (r) => {
      const isSales = r.kind === "sales";
      return (
        <span className={`text-sm text-right font-mono ${
          isSales && (r.overdueDays ?? 0) > 90 ? "text-destructive font-semibold"
          : isSales && (r.overdueDays ?? 0) > 0 ? "text-primary font-semibold"
          : "text-muted-foreground"
        }`}>
          {isSales ? ((r.overdueDays ?? 0) > 0 ? r.overdueDays : "—") : "—"}
        </span>
      );
    },
    exportValue: (r) => (r.kind === "sales" && (r.overdueDays ?? 0) > 0 ? (r.overdueDays ?? 0) : ""),
  },
  {
    key: "status", label: "Status / Narration", sortKey: "status", align: "left",
    cell: (r) => {
      const isSales = r.kind === "sales";
      return (
        <span className="text-xs text-muted-foreground max-w-md truncate inline-block align-bottom" title={isSales ? r.status : (r.narration || "")}>
          {isSales && r.status ? (
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 rounded-button capitalize ${statusStyle[r.status]}`}>
              {r.status}
            </Badge>
          ) : (r.narration || "—")}
        </span>
      );
    },
    exportValue: (r) => (r.kind === "sales" ? (r.status ?? "") : (r.narration ?? "")),
  },
];

/** Checkbox multi-select for value/label filters (Voucher Type, Status).
 *  Empty selection = "all" (no filter). */
function FilterMultiSelect({
  label, options, selected, allLabel, noun, triggerWidth, onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  selected: Set<string>;
  allLabel: string;
  noun: string;
  triggerWidth: string;
  onChange: (next: Set<string>) => void;
}) {
  const summary =
    selected.size === 0 || selected.size === options.length
      ? allLabel
      : selected.size === 1
        ? options.find((o) => selected.has(o.value))?.label ?? `1 ${noun}`
        : `${selected.size} ${noun}`;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline" size="sm"
            className={`${triggerWidth} h-8 rounded-input border-border text-sm justify-between gap-2 font-normal`}
          >
            <span className="truncate">{summary}</span>
            <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[200px]">
          <div className="flex items-center gap-1 px-1 py-0.5">
            <DropdownMenuItem
              onClick={(e) => { e.preventDefault(); onChange(new Set(options.map((o) => o.value))); }}
              onSelect={(e) => e.preventDefault()}
              className="text-xs flex-1 justify-center"
            >
              Select all
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => { e.preventDefault(); onChange(new Set()); }}
              onSelect={(e) => e.preventDefault()}
              className="text-xs flex-1 justify-center"
            >
              Clear all
            </DropdownMenuItem>
          </div>
          <DropdownMenuSeparator />
          {options.map((o) => {
            const toggle = () => {
              const next = new Set(selected);
              if (next.has(o.value)) next.delete(o.value); else next.add(o.value);
              onChange(next);
            };
            return (
              <DropdownMenuItem
                key={o.value}
                onClick={(e) => { e.preventDefault(); toggle(); }}
                onSelect={(e) => e.preventDefault()}
                className="text-xs gap-2"
              >
                <Checkbox checked={selected.has(o.value)} onCheckedChange={toggle} />
                <span className="truncate">{o.label}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────── */

export default function CustomerDetail() {
  // Mounted from two routes:
  //   /outstanding-dashboard/customer/:id  → :id holds encodeURIComponent(customerName)
  //   /outstanding-dashboard/group/:id     → :id holds encodeURIComponent(groupName)
  const { id: nameEncoded } = useParams<{ id: string }>();
  const decoded = decodeURIComponent(nameEncoded ?? "");
  const location = useLocation();
  const isGroupRoute = location.pathname.includes("/outstanding-dashboard/group/");
  const customerName = decoded;  // for single-customer route, this is the Tally name
  const groupName    = decoded;  // for group route, this is the group name
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  // Voucher-type and status filters are multi-select. An empty set means "all"
  // (no filter), matching the agingBucketFilter convention.
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [voucherTypeFilter, setVoucherTypeFilter] = useState<Set<string>>(new Set());
  const [saleTypeFilter, setSaleTypeFilter] = useState(
    searchParams.get("saleType") ?? "all"
  );
  const [activeTrendKeys, setActiveTrendKeys] = useState<Set<string>>(new Set());
  const [ledgerMonth, setLedgerMonth] = useState<string | null>(null);
  const [trendOpen, setTrendOpen] = useState(true);
  const [agingOpen, setAgingOpen] = useState(true);
  const [obOpen, setObOpen] = useState(false);
  const [agingBucketFilter, setAgingBucketFilter] = useState<Set<string>>(new Set());
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [monthlyOpen, setMonthlyOpen] = useState(false);
  const [monthlyCols, setMonthlyCols] = useState<Set<string>>(
    () => new Set(MONTHLY_COLS.map((c) => c.key)),
  );
  // Transactions table column visibility (defaults to all columns shown).
  const [txnCols, setTxnCols] = useState<Set<string>>(
    () => new Set(TXN_COLUMNS.map((c) => c.key)),
  );
  const exportTopRef = useRef<HTMLDivElement>(null);
  const exportMonthlyRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [invoicePage, setInvoicePage] = useState(1);
  const INVOICES_PER_PAGE = 15;
  const transactionsRef = useRef<HTMLDivElement>(null);
  const obSectionRef = useRef<HTMLDivElement>(null);

  // Internal entity filter (company / location within this customer)
  const [entityCompany,  setEntityCompany]  = useState("all");
  const [entityLocation, setEntityLocation] = useState("all");

  // For group route: which child Tally names are currently selected (default: all)
  const [selectedChildren, setSelectedChildren] = useState<Set<string> | null>(null);
  // Tracks the children-name signature we last initialized selection with.
  // Lets us re-initialize once the group mapping finishes loading without
  // clobbering the user's manual toggles afterwards.
  const lastInitKey = useRef<string>("");

  // Reset entity filter (and child selection) when route changes
  useEffect(() => {
    setEntityCompany("all");
    setEntityLocation("all");
    setSelectedChildren(null);
    lastInitKey.current = "";  // force re-init under the new route
  }, [decoded, isGroupRoute]);

  const { loading, error, allCustomers, customerDetail, customerGroupMap, dashboard } = useAppData({ saleType: saleTypeFilter });

  // Resolve the list of Tally names that belong to this group (only meaningful
  // on the group route). A group's children are: every Tally name `n` such
  // that `mapping[n] === groupName`, plus `groupName` itself if no entry maps
  // to it (covers ungrouped customers reached via /group/:name).
  const groupChildNames = useMemo<string[]>(() => {
    if (!isGroupRoute) return [];
    const explicit = customerGroupMap.groups?.[groupName] ?? [];
    if (explicit.length > 0) return [...explicit].sort();
    return [groupName];  // ungrouped customer reached via group route
  }, [isGroupRoute, customerGroupMap.groups, groupName]);

  // Initialise child selection to "all" once we know who the children are.
  // Re-initialises if groupChildNames structurally changes (e.g. mapping loads
  // after a fallback render where only [groupName] was known). Tracking by
  // signature avoids clobbering the user's manual toggles on later re-renders.
  useEffect(() => {
    if (!isGroupRoute) return;
    const key = groupChildNames.join("|");
    if (lastInitKey.current === key) return;
    lastInitKey.current = key;
    setSelectedChildren(new Set(groupChildNames));
  }, [isGroupRoute, groupChildNames]);

  // All raw entities for this customer / group
  const allEntities = useMemo(() => {
    if (isGroupRoute) {
      const childSet = new Set(groupChildNames);
      return allCustomers.filter((c) => childSet.has(c.name));
    }
    return allCustomers.filter((c) => c.name === customerName);
  }, [allCustomers, customerName, isGroupRoute, groupChildNames]);

  // Available companies and locations for the entity filter dropdowns.
  // Each list is filtered by the OTHER selection so users can't pick a
  // company+location combination that has no entities.
  const entityCompanies = useMemo(
    () => [...new Set(
      allEntities
        .filter((c) => entityLocation === "all" || c.location === entityLocation)
        .map((c) => c.company)
    )].sort(),
    [allEntities, entityLocation],
  );
  const entityLocations = useMemo(
    () => [...new Set(
      allEntities
        .filter((c) => entityCompany === "all" || c.company === entityCompany)
        .map((c) => c.location)
    )].sort(),
    [allEntities, entityCompany],
  );

  // Entities that match the current internal filter
  const activeEntities = useMemo(() => {
    let list = allEntities;
    if (isGroupRoute && selectedChildren && selectedChildren.size > 0) {
      list = list.filter((c) => selectedChildren.has(c.name));
    }
    if (entityCompany  !== "all") list = list.filter((c) => c.company  === entityCompany);
    if (entityLocation !== "all") list = list.filter((c) => c.location === entityLocation);
    return list;
  }, [allEntities, entityCompany, entityLocation, isGroupRoute, selectedChildren]);

  // Consolidated customer object (aggregated from activeEntities).
  // - Single-customer route: merge by name (one Tally name; collapses cross-company/location duplicates).
  // - Group route: first merge by name, then roll all distinct Tally names up via consolidateByGroup
  //   (using a synthetic mapping so all selected children land in the same group).
  const customer = useMemo(() => {
    if (activeEntities.length === 0) return null;
    if (isGroupRoute) {
      const byName = consolidateByName(activeEntities);
      if (byName.length === 0) return null;
      const synthetic: Record<string, string> = {};
      for (const c of byName) synthetic[c.name] = groupName;
      const grouped = consolidateByGroup(byName, synthetic);
      return grouped[0] ?? null;
    }
    if (activeEntities.length === 1) return activeEntities[0];
    return consolidateByName(activeEntities)[0];
  }, [activeEntities, isGroupRoute, groupName]);

  const isConsolidated = allEntities.length > 1 && activeEntities.length > 1;

  // Columns offered for the Transactions table (Company/Location only when
  // viewing multiple entities) and the subset currently shown.
  const availableTxnColumns = useMemo(
    () => TXN_COLUMNS.filter((c) => !c.consolidatedOnly || isConsolidated),
    [isConsolidated],
  );
  const visibleTxnColumns = useMemo(
    () => availableTxnColumns.filter((c) => txnCols.has(c.key)),
    [availableTxnColumns, txnCols],
  );

  // Merged invoices from all active entities (sorted by date).
  // Agst Ref lines are Tally's internal advance-application bookkeeping entries
  // (always negative amounts). They must be excluded from the display — the
  // corresponding advance receipt row already appears in receiptTransactions.
  const invoices = useMemo(() =>
    activeEntities
      .flatMap((e) =>
        (customerDetail[e.id]?.invoices ?? [])
          .filter((inv) => inv.billType !== "Agst Ref" && inv.amount > 0)
          .map((inv) => ({
            ...inv,
            _company:  e.company,
            _location: e.location,
          }))
      )
      .sort((a, b) => a.date.localeCompare(b.date)),
    [activeEntities, customerDetail],
  );

  // Merged debit-note transactions
  const debitNoteTxns = useMemo(() =>
    activeEntities
      .flatMap((e) =>
        (customerDetail[e.id]?.debitNoteTransactions ?? []).map((t) => ({
          ...t, _company: e.company, _location: e.location,
        }))
      )
      .sort((a, b) => a.date.localeCompare(b.date)),
    [activeEntities, customerDetail],
  );

  // Merged credit-note transactions
  const creditNoteTxns = useMemo(() =>
    activeEntities
      .flatMap((e) =>
        (customerDetail[e.id]?.creditNoteTransactions ?? []).map((t) => ({
          ...t, _company: e.company, _location: e.location,
        }))
      )
      .sort((a, b) => a.date.localeCompare(b.date)),
    [activeEntities, customerDetail],
  );

  // Merged receipt transactions (skip rows with null date)
  const receiptTxns = useMemo(() =>
    activeEntities
      .flatMap((e) =>
        (customerDetail[e.id]?.receiptTransactions ?? [])
          .filter((t) => t.date)
          .map((t) => ({
            ...t, _company: e.company, _location: e.location,
          }))
      )
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    [activeEntities, customerDetail],
  );

  // Merged journal transactions
  const journalTxns = useMemo(() =>
    activeEntities
      .flatMap((e) =>
        (customerDetail[e.id]?.journalTransactions ?? []).map((t) => ({
          ...t, _company: e.company, _location: e.location,
        }))
      )
      .sort((a, b) => a.date.localeCompare(b.date)),
    [activeEntities, customerDetail],
  );

  // Merged other-payment transactions (manual, non-Tally; skip rows with null date)
  const otherPaymentTxns = useMemo(() =>
    activeEntities
      .flatMap((e) =>
        (customerDetail[e.id]?.otherPaymentTransactions ?? [])
          .filter((t) => t.date)
          .map((t) => ({
            ...t, _company: e.company, _location: e.location,
          }))
      )
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    [activeEntities, customerDetail],
  );

  // Consolidated monthly trend (sum by month across active entities)
  const trendData = useMemo(() => {
    const byMonth = new Map<string, { month: string; sales: number; receipts: number; creditNotes: number; debitNotes: number; journalAdjustments: number; checkReturns: number; outstanding: number; overdue: number }>();
    for (const e of activeEntities) {
      for (const t of customerDetail[e.id]?.trend ?? []) {
        if (!byMonth.has(t.month)) {
          byMonth.set(t.month, {
            ...t,
            checkReturns:       t.checkReturns ?? 0,
            debitNotes:         t.debitNotes ?? 0,
            journalAdjustments: t.journalAdjustments ?? 0,
          });
        } else {
          const m = byMonth.get(t.month)!;
          m.sales              += t.sales;
          m.receipts           += t.receipts;
          m.creditNotes        += t.creditNotes;
          m.debitNotes         += t.debitNotes ?? 0;
          m.journalAdjustments += t.journalAdjustments ?? 0;
          m.checkReturns       += t.checkReturns ?? 0;
          m.outstanding        += t.outstanding;
          m.overdue            += t.overdue;
        }
      }
    }
    // Sort chronologically by calendar order (handles cross-FY ranges, e.g.
    // Jan-26/Feb-26/Mar-26 in FY 25-26 followed by Apr-26 in FY 26-27).
    const calMonth = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const sorted = [...byMonth.values()].sort((a, b) => {
      const [am, ay] = [a.month.slice(0, 3), a.month.slice(4)];
      const [bm, by_] = [b.month.slice(0, 3), b.month.slice(4)];
      if (ay !== by_) return Number(ay) - Number(by_);
      return calMonth.indexOf(am) - calMonth.indexOf(bm);
    });
    // Pin the as-of (latest) month's overdue + outstanding to the headline KPI
    // values so the chart endpoint matches the tiles. The Tally bill-wise override
    // adjusts the headline total but not the calculated monthly series; only the
    // as-of month has a true reference (there is no Tally history for prior
    // months, so those stay as the calculated series). Trend unit is lakhs.
    if (customer && sorted.length) {
      const last = sorted[sorted.length - 1];
      last.overdue     = customer.overdue / 100_000;
      last.outstanding = customer.outstanding / 100_000;
    }
    return sorted;
  }, [activeEntities, customerDetail, customer]);

  const invoiceAgingKey = (overdueDays: number): string | null => {
    if (overdueDays <= 0)   return null;
    if (overdueDays <= 30)  return "0_30";
    if (overdueDays <= 60)  return "31_60";
    if (overdueDays <= 90)  return "61_90";
    if (overdueDays <= 120) return "91_120";
    if (overdueDays <= 180) return "121_180";
    return "180_plus";
  };

  // ── Unified transaction ledger ──────────────────────────────────────────
  // Combines invoices, receipts, credit notes, debit notes, journal Dr/Cr,
  // and cheque returns into a single chronologically sorted list.
  // (TxnKind / TxnRow are declared at module scope so the column config can
  // reference them.)

  const transactions = useMemo<TxnRow[]>(() => {
    const rows: TxnRow[] = [];

    // Sales invoices
    for (const inv of invoices) {
      rows.push({
        rowKey: `s-${inv.id}-${inv._company}-${inv._location}`,
        date: inv.date,
        kind: "sales",
        voucherNo: inv.number,
        refInvoice: null,
        amount: inv.amount,
        signedAmount: inv.amount,
        received: inv.amount - inv.pending,
        pending: inv.pending,
        dueDate: inv.dueDate,
        overdueDays: inv.overdueDays,
        status: inv.status,
        saleType: inv.voucherType,
        _company: inv._company,
        _location: inv._location,
      });
    }

    // Receipts (and cheque returns, which come through receiptTransactions
    // as type === "check_return" with negative `amount`)
    receiptTxns.forEach((r, i) => {
      const isChq = (r.type ?? "").toLowerCase() === "check_return";
      const gross = Math.abs(r.amount);
      rows.push({
        rowKey: `r-${i}-${r.date}`,
        date: r.date ?? "",
        kind: isChq ? "check_return" : "receipt",
        voucherNo: "",
        refInvoice: r.refInvoice,
        amount: gross,
        signedAmount: isChq ? gross : -gross,
        subType: r.type,
        _company: r._company,
        _location: r._location,
      });
    });

    // Credit notes
    creditNoteTxns.forEach((cn, i) => {
      rows.push({
        rowKey: `cn-${i}-${cn.voucherNo || cn.date}`,
        date: cn.date,
        kind: "credit_note",
        voucherNo: cn.voucherNo,
        refInvoice: cn.refInvoice,
        amount: cn.amount,
        signedAmount: -cn.amount,
        narration: cn.narration,
        _company: cn._company,
        _location: cn._location,
      });
    });

    // Debit notes
    debitNoteTxns.forEach((dn, i) => {
      rows.push({
        rowKey: `dn-${i}-${dn.voucherNo}`,
        date: dn.date,
        kind: "debit_note",
        voucherNo: dn.voucherNo,
        refInvoice: dn.refInvoice,
        amount: dn.amount,
        signedAmount: dn.amount,
        narration: dn.narration,
        _company: dn._company,
        _location: dn._location,
      });
    });

    // Journal Dr / Cr
    journalTxns.forEach((j, i) => {
      rows.push({
        rowKey: `j-${i}-${j.voucherNo}`,
        date: j.date,
        kind: j.type === "Dr" ? "journal_dr" : "journal_cr",
        voucherNo: j.voucherNo,
        refInvoice: j.refInvoice,
        amount: j.amount,
        signedAmount: j.signedAmount,
        narration: j.narration,
        _company: j._company,
        _location: j._location,
      });
    });

    // Other payments (manual, non-Tally) — reduce outstanding like a receipt,
    // tracked separately. paymentRef shown as the voucher reference.
    otherPaymentTxns.forEach((o, i) => {
      const gross = Math.abs(o.amount);
      rows.push({
        rowKey: `op-${i}-${o.date}`,
        date: o.date ?? "",
        kind: "other_payment",
        voucherNo: o.paymentRef ?? "",
        refInvoice: o.refInvoice,
        amount: gross,
        signedAmount: -gross,
        subType: o.type,
        narration: o.remark ?? undefined,
        _company: o._company,
        _location: o._location,
      });
    });

    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  }, [invoices, receiptTxns, creditNoteTxns, debitNoteTxns, journalTxns, otherPaymentTxns]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      // Voucher-type filter (multi-select) — "journal" matches both Dr and Cr
      if (voucherTypeFilter.size > 0) {
        const isJournal = t.kind === "journal_dr" || t.kind === "journal_cr";
        const matches = isJournal
          ? voucherTypeFilter.has("journal")
          : voucherTypeFilter.has(t.kind);
        if (!matches) return false;
      }
      // Status / aging only narrow sales rows
      if (statusFilter.size > 0) {
        if (t.kind !== "sales" || !statusFilter.has(t.status ?? "")) return false;
      }
      if (agingBucketFilter.size > 0) {
        if (t.kind !== "sales" || !agingBucketFilter.has(invoiceAgingKey(t.overdueDays ?? 0) ?? "")) return false;
      }
      if (!matchesSearch(invoiceSearch, t.voucherNo, t.refInvoice)) return false;
      return true;
    });
  }, [transactions, voucherTypeFilter, statusFilter, agingBucketFilter, invoiceSearch]);

  // ── Transactions table sort ──────────────────────────────────────────────
  // (TxnSortKey is declared at module scope alongside the column config.)
  type SortDir = "asc" | "desc";

  // Default: date ascending (matches the natural row order before the user clicks).
  const [txnSort, setTxnSort] = useState<{ key: TxnSortKey; dir: SortDir }>({
    key: "date", dir: "asc",
  });

  const handleSortClick = (key: TxnSortKey) => {
    setTxnSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
    setInvoicePage(1);
  };

  const sortedTransactions = useMemo(() => {
    const rows = [...filteredTransactions];
    const { key, dir } = txnSort;
    const mul = dir === "asc" ? 1 : -1;

    const numericKeys: TxnSortKey[] = ["amount", "received", "pending", "overdueDays"];
    const isNumeric = numericKeys.includes(key);

    rows.sort((a, b) => {
      let av: any;
      let bv: any;
      if (key === "status") {
        av = a.kind === "sales" ? (a.status ?? "") : (a.narration ?? "");
        bv = b.kind === "sales" ? (b.status ?? "") : (b.narration ?? "");
      } else {
        av = (a as any)[key];
        bv = (b as any)[key];
      }
      // null / undefined / "" sort to the end regardless of direction
      const aEmpty = av === null || av === undefined || av === "";
      const bEmpty = bv === null || bv === undefined || bv === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (isNumeric) return ((av as number) - (bv as number)) * mul;
      return String(av).localeCompare(String(bv)) * mul;
    });
    return rows;
  }, [filteredTransactions, txnSort]);

  const totalInvoicePages = Math.ceil(sortedTransactions.length / INVOICES_PER_PAGE);
  const pagedTransactions = sortedTransactions.slice(
    (invoicePage - 1) * INVOICES_PER_PAGE,
    invoicePage * INVOICES_PER_PAGE,
  );

  // Whether the status filter is meaningful for the current voucher-type filter
  const showStatusFilter = voucherTypeFilter.size === 0 || voucherTypeFilter.has("sales");

  // ── Ledger drill-down for selected month ──────────────────────────────────
  const ledgerTrendRow = useMemo(
    () => trendData.find((t) => t.month === ledgerMonth) ?? null,
    [trendData, ledgerMonth],
  );

  const ledgerOpeningBal = useMemo(() => {
    if (!ledgerTrendRow) return 0;
    return ledgerTrendRow.outstanding
      + ledgerTrendRow.receipts
      + ledgerTrendRow.creditNotes
      - ledgerTrendRow.sales;
  }, [ledgerTrendRow]);

  const ledgerInvoices = useMemo(() => {
    if (!ledgerMonth) return [];
    return invoices.filter((inv) => {
      const d = new Date(inv.date);
      const label =
        d.toLocaleString("en-US", { month: "short" }) + "-" +
        String(d.getFullYear()).slice(2);
      return label === ledgerMonth;
    });
  }, [invoices, ledgerMonth]);

  const activeLines = activeTrendKeys.size === 0
    ? allLines
    : allLines.filter((t) => activeTrendKeys.has(t.key));

  /* ── Loading / Error ─────────────────────────────────── */
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading customer data…</p>
        </div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3 max-w-md">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
          <p className="text-sm font-medium text-destructive">
            {error ?? "Customer not found"}
          </p>
          {error && <p className="text-xs text-muted-foreground">{error}</p>}
        </div>
      </div>
    );
  }

  const utilization = utilizationPct(customer);

  // ── KPI tile filter handler — same UX as the trend-strip tiles ──
  // Clicking a tile applies a transactions filter, expands the ledger,
  // and scrolls to it. Re-clicking the active tile clears the filter.
  // Helpers bridging the single-select KPI/trend tiles to the multi-select state.
  // "all" maps to an empty set; a tile is "active" only when its value is the
  // sole selection.
  const onlyVType = (vType: string) =>
    vType === "all"
      ? voucherTypeFilter.size === 0
      : voucherTypeFilter.size === 1 && voucherTypeFilter.has(vType);
  const onlyStatus = (status: string) =>
    status === "all"
      ? statusFilter.size === 0
      : statusFilter.size === 1 && statusFilter.has(status);
  const setSingleVType = (vType: string) =>
    setVoucherTypeFilter(vType === "all" ? new Set() : new Set([vType]));
  const setSingleStatus = (status: string) =>
    setStatusFilter(status === "all" ? new Set() : new Set([status]));

  const applyKpiFilter = (vType: string, status: string = "all") => {
    const currentlyActive =
      onlyVType(vType) &&
      onlyStatus(status) &&
      agingBucketFilter.size === 0;
    if (currentlyActive) {
      setVoucherTypeFilter(new Set());
      setStatusFilter(new Set());
      setInvoicePage(1);
      return;
    }
    setSingleVType(vType);
    setSingleStatus(status);
    setAgingBucketFilter(new Set());
    setInvoicesOpen(true);
    setInvoicePage(1);
    setTimeout(() => {
      transactionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const isKpiActive = (vType: string, status: string = "all") =>
    onlyVType(vType) &&
    onlyStatus(status) &&
    agingBucketFilter.size === 0;

  const debitNotesAmt   = (customer as any).debitNotes ?? 0;
  const journalAdjAmt   = (customer as any).journalAdjustments ?? 0;
  const checkReturnsAmt = customer.checkReturns ?? 0;

  type SummaryItem = {
    label: string;
    value: string;
    destructive?: boolean;
    onClick?: () => void;
    active?: boolean;
    drCr?: 'debit' | 'credit';
  };

  const summaryItems: SummaryItem[] = [
    {
      label: "Outstanding",
      value: fmt(Math.abs(customer.outstanding)),
      drCr: customer.outstanding >= 0 ? 'debit' : 'credit',
      onClick: () => applyKpiFilter("sales", "all"),
      active: isKpiActive("sales", "all"),
    },
    {
      label: "Overdue",
      value: fmt(customer.overdue),
      destructive: true,
      drCr: 'debit',
      onClick: () => applyKpiFilter("sales", "overdue"),
      active: isKpiActive("sales", "overdue"),
    },
    { label: "Credit Limit",   value: fmt(customer.creditLimit) },
    { label: "Utilization",    value: customer.blocked ? "—" : `${utilization}%`,  destructive: !customer.blocked && utilization > 100 },
    { label: "Credit Period",  value: `${customer.creditPeriod} days` },
    {
      label: "Opening Balance",
      value: fmt(Math.abs(customer.openingBalance)),
      drCr: (customer.openingDrCr ?? 'Dr') === 'Dr' ? 'debit' : 'credit',
      onClick: () => {
        setObOpen(true);
        setTimeout(() => {
          obSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      },
      active: false,
    },
    {
      label: "Sales",
      value: fmtINRMoney(customer.sales),
      drCr: 'debit',
      onClick: () => applyKpiFilter("sales", "all"),
      active: isKpiActive("sales", "all"),
    },
    {
      label: "Receipts",
      value: fmtINRMoney(customer.receipts),
      drCr: 'credit',
      onClick: () => applyKpiFilter("receipt", "all"),
      active: isKpiActive("receipt", "all"),
    },
    {
      label: "Credit Notes",
      value: fmtINRMoney(customer.creditNotes),
      drCr: 'credit',
      onClick: () => applyKpiFilter("credit_note", "all"),
      active: isKpiActive("credit_note", "all"),
    },
    {
      label: "Debit Notes",
      value: fmtINRMoney(debitNotesAmt),
      destructive: debitNotesAmt > 0,
      drCr: 'debit',
      onClick: debitNotesAmt > 0 ? () => applyKpiFilter("debit_note", "all") : undefined,
      active: isKpiActive("debit_note", "all"),
    },
    {
      label: "Journal Adj (Net)",
      value: fmtINRDrCr(journalAdjAmt),
      destructive: journalAdjAmt > 0,
      drCr: journalAdjAmt > 0 ? 'debit' : journalAdjAmt < 0 ? 'credit' : undefined,
      onClick: journalAdjAmt !== 0 ? () => applyKpiFilter("journal", "all") : undefined,
      active: isKpiActive("journal", "all"),
    },
    {
      label: "Cheque Returns",
      value: fmtINRMoney(checkReturnsAmt),
      destructive: checkReturnsAmt > 0,
      drCr: 'debit',
      onClick: checkReturnsAmt > 0 ? () => applyKpiFilter("check_return", "all") : undefined,
      active: isKpiActive("check_return", "all"),
    },
  ];

  const handleExport = async () => {
    if (!customer || exporting) return;
    setExporting(true);

    // Expand the collapsible sections so they render into the captured region.
    const prev = { trend: trendOpen, aging: agingOpen, monthly: monthlyOpen };
    setTrendOpen(true);
    setAgingOpen(true);
    setMonthlyOpen(true);
    // Let the collapsibles open and Recharts draw before capture.
    await new Promise((r) => setTimeout(r, 500));

    try {
      const meta = {
        customerName: isGroupRoute ? groupName : customer.name,
        company: entityCompany === "all" ? "All Companies" : entityCompany,
        location: entityLocation === "all" ? "All Locations" : entityLocation,
        asOfDate: dashboard?.asOfDate,
      };

      // Monthly Analysis — only the columns currently shown on screen (in ₹).
      const toRupees = (lakhs: number) => Math.round(lakhs * 100_000);
      const selectedCols = MONTHLY_COLS.filter((c) => monthlyCols.has(c.key));
      const monthlyColumns = ["Month", ...selectedCols.map((c) => c.label)];
      const monthlyRows = trendData.map((row) => [
        row.month,
        ...selectedCols.map((c) => {
          const v = Number((row as unknown as Record<string, number>)[c.key] ?? 0);
          return c.key === "outstanding" ? toRupees(Math.abs(v)) : toRupees(v);
        }),
      ]);
      const last = trendData[trendData.length - 1] as unknown as Record<string, number> | undefined;
      const monthlySummary = trendData.length
        ? ["Summary", ...selectedCols.map((c) => {
            if (c.key === "outstanding" || c.key === "overdue")
              return toRupees(Math.abs(Number(last?.[c.key] ?? 0)));
            return toRupees(trendData.reduce((s, r) => s + Number((r as unknown as Record<string, number>)[c.key] ?? 0), 0));
          })]
        : undefined;

      // Overdue aging (already in ₹).
      const agingLabels: Record<string, string> = {
        "0_30": "0–30 days", "31_60": "31–60 days", "61_90": "61–90 days",
        "91_120": "91–120 days", "121_180": "121–180 days", "180_plus": "180+ days",
      };
      const buckets = customer.agingBuckets as unknown as Record<string, number> | undefined;
      const aging = buckets
        ? Object.entries(agingLabels)
            .map(([k, label]) => ({ bucket: label, amount: Math.round(buckets[k] ?? 0) }))
            .filter((a) => a.amount !== 0)
        : [];

      // KPI cards as displayed.
      const kpis = summaryItems.map((k) => ({
        label: k.label,
        value: k.drCr ? `${k.value} (${k.drCr})` : k.value,
      }));

      await exportCustomerPdf([exportTopRef.current, exportMonthlyRef.current], meta);
      exportCustomerXlsx({
        meta, kpis, aging,
        monthly: { columns: monthlyColumns, rows: monthlyRows, summary: monthlySummary },
      });

      toast({ title: "Export complete", description: "PDF and Excel downloaded." });
    } catch (e) {
      console.error(e);
      toast({ title: "Export failed", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setTrendOpen(prev.trend);
      setAgingOpen(prev.aging);
      setMonthlyOpen(prev.monthly);
      setExporting(false);
    }
  };

  // Export the currently-filtered transactions, with only the visible columns,
  // to an Excel sheet headed by the customer name.
  const handleTransactionsExport = () => {
    if (!customer) return;
    const meta = {
      customerName: isGroupRoute ? groupName : customer.name,
      company: entityCompany === "all" ? "All Companies" : entityCompany,
      location: entityLocation === "all" ? "All Locations" : entityLocation,
      asOfDate: dashboard?.asOfDate,
    };
    const columns = visibleTxnColumns.map((c) => c.label);
    const rows = sortedTransactions.map((r) => visibleTxnColumns.map((c) => c.exportValue(r)));
    try {
      exportTransactionsXlsx({ meta, columns, rows });
      toast({ title: "Export complete", description: `${rows.length} transactions exported.` });
    } catch (e) {
      console.error(e);
      toast({ title: "Export failed", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };


  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Back + Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-2">
          <Button
            variant="ghost" size="sm"
            onClick={() => {
              const params = new URLSearchParams();
              if (saleTypeFilter !== "all") params.set("saleType", saleTypeFilter);
              if (isGroupRoute)               params.set("view", "group");
              const qs = params.toString();
              navigate(qs ? `/outstanding-dashboard/risk-register?${qs}` : "/outstanding-dashboard/risk-register");
            }}
            className="rounded-button text-muted-foreground hover:text-foreground hover:bg-transparent active:bg-transparent -ml-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Risk Register
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-button bg-primary/15 flex items-center justify-center">
              <ShieldAlert className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground">
                  {isGroupRoute ? groupName : customer.name}
                </h1>
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 rounded-button capitalize ${riskStyle[customer.risk as RiskCategory]}`}
                >
                  {customer.risk}
                </Badge>
                {customer.blocked && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 rounded-button bg-destructive/15 text-destructive border-destructive/30"
                    title="Source-sheet credit limit is set to 1 (blocked sentinel — typically INK customers only)"
                  >
                    Blocked
                  </Badge>
                )}
                {isGroupRoute ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-button bg-primary/10 text-primary border-primary/30">
                    Group · {groupChildNames.length} customers
                  </Badge>
                ) : isConsolidated && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-button bg-muted text-muted-foreground border-border">
                    Consolidated
                  </Badge>
                )}
              </div>
              {!isGroupRoute && allEntities.length === 1 && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span>{customer.company}</span>
                  <span className="text-muted-foreground/50">·</span>
                  <span>{customer.location}</span>
                </p>
              )}
              {customer.blocked && (
                <p className="text-[11px] text-muted-foreground/80 italic mt-1">
                  Note: "Blocked" is set when the source-sheet credit limit equals 1. In practice this marker is used for the INK product category only.
                </p>
              )}
              {/* Combined filters row: child multi-select (groups) + company/location */}
              {((isGroupRoute && groupChildNames.length > 1 && selectedChildren) || allEntities.length > 1) && (
                <div className="flex items-end gap-2 mt-1.5 flex-wrap">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 mb-2" />
                  {isGroupRoute && groupChildNames.length > 1 && selectedChildren && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Customers in Group</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline" size="sm"
                            className="h-7 rounded-input border-border text-xs justify-between gap-2 min-w-[220px]"
                          >
                            <span className="truncate">
                              {selectedChildren.size === groupChildNames.length
                                ? `All ${groupChildNames.length} selected`
                                : selectedChildren.size === 0
                                  ? "None selected"
                                  : `${selectedChildren.size} of ${groupChildNames.length} selected`}
                            </span>
                            <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-[280px] max-h-[60vh] overflow-y-auto">
                          <DropdownMenuLabel>Customers in {groupName}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={(e) => { e.preventDefault(); setSelectedChildren(new Set(groupChildNames)); }}
                            className="text-xs"
                          >
                            Select all
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => { e.preventDefault(); setSelectedChildren(new Set()); }}
                            className="text-xs"
                          >
                            Clear
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {groupChildNames.map((n) => (
                            <DropdownMenuCheckboxItem
                              key={n}
                              checked={selectedChildren.has(n)}
                              onCheckedChange={() => {
                                setSelectedChildren((prev) => {
                                  const next = new Set(prev ?? []);
                                  if (next.has(n)) next.delete(n); else next.add(n);
                                  return next;
                                });
                              }}
                              onSelect={(e) => e.preventDefault()}
                              className="text-xs"
                            >
                              {n}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                  {allEntities.length > 1 && (
                    <>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Company</span>
                        <Select value={entityCompany} onValueChange={setEntityCompany}>
                          <SelectTrigger className="h-7 w-[145px] rounded-input border-border text-xs">
                            <SelectValue placeholder="All Companies" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Companies</SelectItem>
                            {entityCompanies.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Location</span>
                        <Select value={entityLocation} onValueChange={setEntityLocation}>
                          <SelectTrigger className="h-7 w-[145px] rounded-input border-border text-xs">
                            <SelectValue placeholder="All Locations" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Locations</SelectItem>
                            {entityLocations.map((l) => (
                              <SelectItem key={l} value={l}>{l}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <Button
            variant="outline" size="sm"
            onClick={handleExport}
            disabled={exporting}
            className="rounded-button border-border"
          >
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </div>
      </div>

      {/* Export region 1: KPI cards → Trends → Aging */}
      <div ref={exportTopRef} className="space-y-6 bg-background">
      {/* KPI Summary — clickable cards apply a filter to the Transactions ledger */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryItems.map((item) => {
          const clickable = !!item.onClick;
          const baseCls = `rounded-lg border bg-card text-card-foreground shadow-sm rounded-card border-border bg-surface transition-all ${
            item.active ? "ring-2 ring-primary border-primary" : ""
          }`;
          const innerCls = "p-4 space-y-1";
          const labelEl = <p className="text-xs text-muted-foreground">{item.label}</p>;
          const valueEl = (
            <p className={`text-lg font-bold ${item.destructive ? "text-destructive" : "text-foreground"}`}>
              {item.value}
            </p>
          );
          const drCrEl = item.drCr ? (
            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">({item.drCr})</p>
          ) : null;
          if (clickable) {
            return (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className={`${baseCls} text-left cursor-pointer hover:border-primary/50 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
              >
                <div className={innerCls}>
                  {labelEl}
                  {valueEl}
                  {drCrEl}
                </div>
              </button>
            );
          }
          return (
            <div key={item.label} className={baseCls}>
              <div className={innerCls}>
                {labelEl}
                {valueEl}
                {drCrEl}
              </div>
            </div>
          );
        })}
      </div>


      {/* Trend Chart */}
      <Collapsible open={trendOpen} onOpenChange={setTrendOpen}>
      <Card className="rounded-card border-border bg-surface">
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <button className="flex items-center justify-between w-full text-left">
              <CardTitle className="text-sm font-semibold">Trends</CardTitle>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${trendOpen ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
        <CardContent>
          <div className="flex flex-wrap gap-1 mb-4">
            {/* All — clears selection */}
            <Button
              key="all"
              variant={activeTrendKeys.size === 0 ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTrendKeys(new Set())}
              className="rounded-button text-xs h-7"
            >
              All
            </Button>
            {/* Individual toggles — multi-select */}
            {allLines.map((t) => {
              const active = activeTrendKeys.has(t.key);
              return (
                <Button
                  key={t.key}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setActiveTrendKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.key)) next.delete(t.key);
                      else next.add(t.key);
                      return next;
                    });
                  }}
                  className="rounded-button text-xs h-7"
                >
                  {t.label}
                </Button>
              );
            })}
          </div>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={fmtL} width={72} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--surface))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "var(--radius)",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => fmtL(v)}
                />
                <>
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {activeLines.map((t) => (
                    <Line
                      key={t.key}
                      type="monotone"
                      dataKey={t.key}
                      name={t.label}
                      stroke={t.color}
                      strokeWidth={2}
                      dot={{ r: activeLines.length === 1 ? 4 : 3, fill: t.color }}
                      activeDot={{ r: activeLines.length === 1 ? 6 : 5 }}
                    />
                  ))}
                </>
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Summary strip below chart — each tile filters the Transactions table */}
          {trendData.length > 0 && (() => {
            const handleTileClick = (vType: string, status: string = "all") =>
              applyKpiFilter(vType, status);

            const tiles: Array<{
              label: string;
              value: string;
              color: string;
              filter: { voucherType: string; status: string };
            }> = [
              { label: "Total Sales",       value: fmtL(trendData.reduce((s, r) => s + r.sales, 0)),                              color: "text-primary",                 filter: { voucherType: "sales",        status: "all" }     },
              { label: "Total Receipts",    value: fmtL(trendData.reduce((s, r) => s + r.receipts, 0)),                           color: "text-[hsl(142,71%,45%)]",      filter: { voucherType: "receipt",      status: "all" }     },
              { label: "Total Cr. Notes",   value: fmtL(trendData.reduce((s, r) => s + r.creditNotes, 0)),                        color: "text-[hsl(271,75%,58%)]",      filter: { voucherType: "credit_note",  status: "all" }     },
              { label: "Total Dr. Notes",   value: fmtL(trendData.reduce((s, r) => s + (r.debitNotes ?? 0), 0)),                  color: "text-[hsl(28,80%,55%)]",       filter: { voucherType: "debit_note",   status: "all" }     },
              { label: "Journal Adj (Net)", value: fmtLDrCr(trendData.reduce((s, r) => s + (r.journalAdjustments ?? 0), 0)),      color: "text-[hsl(231,65%,55%)]",      filter: { voucherType: "journal",      status: "all" }     },
              { label: "Total Chq Returns", value: fmtL(trendData.reduce((s, r) => s + r.checkReturns, 0)),                       color: "text-[hsl(213,94%,52%)]",      filter: { voucherType: "check_return", status: "all" }     },
              { label: "Outstanding",       value: fmtL(Math.abs(trendData[trendData.length - 1]?.outstanding ?? 0)),                       color: "text-secondary",               filter: { voucherType: "sales",        status: "all" }     },
            ];

            const overdueFilter = { voucherType: "sales", status: "overdue" };
            const isOverdueActive = isKpiActive(overdueFilter.voucherType, overdueFilter.status);

            return (
              <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {tiles.map((item) => {
                  const isActive = isKpiActive(item.filter.voucherType, item.filter.status);
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => handleTileClick(item.filter.voucherType, item.filter.status)}
                      className={`text-left bg-muted/40 rounded-input px-3 py-2 transition-all hover:bg-muted/70 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        isActive ? "ring-2 ring-primary bg-primary/5" : ""
                      }`}
                    >
                      <span className="block text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{item.label}</span>
                      <span className={`block text-sm font-bold font-mono mt-0.5 ${item.color}`}>{item.value}</span>
                    </button>
                  );
                })}
                {/* Overdue tile — shows total overdue (invoice + opening balance) */}
                <button
                  type="button"
                  onClick={() => handleTileClick(overdueFilter.voucherType, overdueFilter.status)}
                  className={`text-left bg-muted/40 rounded-input px-3 py-2 transition-all hover:bg-muted/70 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isOverdueActive ? "ring-2 ring-primary bg-primary/5" : ""
                  }`}
                >
                  <span className="block text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Overdue</span>
                  <span className="block text-sm font-bold font-mono mt-0.5 text-destructive">{fmt(customer.overdue)}</span>
                  {(customer as any).remainingOpeningBalance > 0 && (
                    <span className="block text-[10px] text-muted-foreground mt-0.5">
                      incl. {fmt((customer as any).remainingOpeningBalance)} OB
                    </span>
                  )}
                </button>
              </div>
            );
          })()}
        </CardContent>
        </CollapsibleContent>
      </Card>
      </Collapsible>

      {/* Overdue Aging Breakdown */}
      {customer.overdue > 0 && (() => {
        const AGING_BUCKETS = [
          { label: "0–30 days",    key: "0_30",     color: "hsl(142, 71%, 45%)" },
          { label: "31–60 days",   key: "31_60",    color: "hsl(82, 70%, 42%)"  },
          { label: "61–90 days",   key: "61_90",    color: "hsl(47, 96%, 48%)"  },
          { label: "91–120 days",  key: "91_120",   color: "hsl(30, 90%, 52%)"  },
          { label: "121–180 days", key: "121_180",  color: "hsl(20, 90%, 50%)"  },
          { label: "180+ days",    key: "180_plus", color: "hsl(var(--destructive))" },
        ] as const;

        const handleBucketClick = (key: string) => {
          setAgingBucketFilter((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
          // Reveal the (now filtered) transactions whenever a bucket is toggled on.
          if (!agingBucketFilter.has(key)) {
            setInvoicesOpen(true);
            setInvoicePage(1);
            setVoucherTypeFilter(new Set(["sales"]));
          }
        };

        const agingData = AGING_BUCKETS.map(({ label, key, color }) => ({
          label,
          color,
          amount: (customer.agingBuckets as unknown as Record<string, number>)?.[key] ?? 0,
        })).filter((d) => d.amount > 0);

        const totalAgingAmt = agingData.reduce((s, d) => s + d.amount, 0);

        return (
          <Collapsible open={agingOpen} onOpenChange={setAgingOpen}>
          <Card className="rounded-card border-border bg-surface">
            <CardHeader className="pb-2">
              <CollapsibleTrigger asChild>
                <button className="flex items-center justify-between w-full text-left">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="h-4 w-4 text-destructive" />
                    Overdue Aging Breakdown
                    <span className="text-xs font-normal text-muted-foreground ml-1">— invoice-level only; opening balance excluded</span>
                  </CardTitle>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0 ${agingOpen ? "rotate-180" : ""}`} />
                </button>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={fmtL} width={72} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--surface))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)",
                        fontSize: 12,
                      }}
                      formatter={(v: number) => [fmt(v), "Overdue"]}
                    />
                    <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={72} cursor="pointer"
                      onClick={(entry) => handleBucketClick(AGING_BUCKETS.find((b) => b.label === entry.label)?.key ?? "")}>
                      {agingData.map((d, i) => (
                        <Cell key={i} fill={d.color} opacity={agingBucketFilter.size === 0 || agingBucketFilter.has(AGING_BUCKETS.find((b) => b.label === d.label)?.key ?? "") ? 1 : 0.35} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Bucket summary strip */}
              <div className="mt-3 pt-3 border-t border-border flex gap-4">
                {/* Left — bucket rows */}
                <div className="flex-1 space-y-1.5">
                  {agingData.map((d) => {
                    const bk = AGING_BUCKETS.find((b) => b.label === d.label)?.key ?? "";
                    const isActive = agingBucketFilter.has(bk);
                    return (
                      <div
                        key={d.label}
                        onClick={() => handleBucketClick(bk)}
                        className={`flex items-center justify-between gap-3 px-3 py-1.5 rounded-input cursor-pointer transition-colors
                          ${isActive ? "ring-1 ring-offset-0" : "bg-muted/40 hover:bg-muted/70"}`}
                        style={(isActive ? { backgroundColor: `${d.color}18`, ringColor: d.color } : {}) as CSSProperties}
                      >
                        <span className="text-xs text-muted-foreground w-24 shrink-0">{d.label}</span>
                        <span className="text-xs font-bold font-mono" style={{ color: d.color }}>{fmt(d.amount)}</span>
                        <span className="text-[10px] text-muted-foreground w-10 text-right shrink-0">
                          {totalAgingAmt > 0 ? `${((d.amount / totalAgingAmt) * 100).toFixed(1)}%` : "—"}
                        </span>
                      </div>
                    );
                  })}
                  {/* Opening balance row — only if non-zero */}
                  {(customer as any).remainingOpeningBalance > 0 && (
                    <div className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-input bg-muted/40 border border-dashed border-muted-foreground/30">
                      <span className="text-xs text-muted-foreground w-24 shrink-0 italic">Opening Bal.</span>
                      <span className="text-xs font-bold font-mono text-muted-foreground">{fmt((customer as any).remainingOpeningBalance)}</span>
                      <span className="text-[10px] text-muted-foreground w-10 text-right shrink-0">
                        {customer.overdue > 0 ? `${(((customer as any).remainingOpeningBalance / customer.overdue) * 100).toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  )}
                </div>
                {/* Right — total overdue */}
                <div className="flex items-center justify-center bg-destructive/10 border border-destructive/20 rounded-input px-6 py-3 shrink-0">
                  <div className="text-center">
                    <p className="text-[10px] text-destructive font-medium uppercase tracking-wide">Total Overdue</p>
                    <p className="text-xl font-bold font-mono text-destructive mt-1">{fmt(customer.overdue)}</p>
                    {(customer as any).remainingOpeningBalance > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        incl. {fmt((customer as any).remainingOpeningBalance)} OB
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
            </CollapsibleContent>
          </Card>
          </Collapsible>
        );
      })()}
      </div>
      {/* End export region 1 */}

      {/* Export region 2: Monthly Analysis (starts on a new PDF page) */}
      <div ref={exportMonthlyRef} className="bg-background">
      {/* Monthly Analysis Table */}
      <Collapsible open={monthlyOpen} onOpenChange={setMonthlyOpen}>
      <Card className="rounded-card border-border bg-surface overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <button className="flex items-center justify-between flex-1 text-left">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Monthly Analysis
                  <span className="text-xs font-normal text-muted-foreground ml-1">— click a row to view ledger</span>
                </CardTitle>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${monthlyOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button data-export-hide variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Columns3 className="h-3.5 w-3.5" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-xs">Show columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {MONTHLY_COLS.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    className="text-xs"
                    checked={monthlyCols.has(col.key)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(checked) =>
                      setMonthlyCols((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(col.key);
                        else next.delete(col.key);
                        return next;
                      })
                    }
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CollapsibleContent>
        <ScrollableTable>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs font-semibold text-foreground/70">Month</TableHead>
                {MONTHLY_COLS.filter((c) => monthlyCols.has(c.key)).map((c) => (
                  <TableHead key={c.key} className="text-xs font-semibold text-foreground/70 text-right">{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {trendData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={monthlyCols.size + 1} className="text-center py-8 text-muted-foreground text-sm">
                    No monthly data available.
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {trendData.map((row) => (
                    <TableRow
                      key={row.month}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setLedgerMonth(row.month)}
                    >
                      <TableCell className="text-sm font-medium">
                        <span className="flex items-center gap-1.5">
                          {row.month}
                          <BookOpen className="h-3 w-3 text-muted-foreground opacity-60" />
                        </span>
                      </TableCell>
                      {monthlyCols.has("sales") && <TableCell className="text-sm text-right font-mono">{fmtL(row.sales)}</TableCell>}
                      {monthlyCols.has("receipts") && <TableCell className="text-sm text-right font-mono">{fmtL(row.receipts)}</TableCell>}
                      {monthlyCols.has("creditNotes") && <TableCell className="text-sm text-right font-mono">{fmtL(row.creditNotes)}</TableCell>}
                      {monthlyCols.has("debitNotes") && <TableCell className="text-sm text-right font-mono text-[hsl(28,80%,55%)]">{fmtL(row.debitNotes ?? 0)}</TableCell>}
                      {monthlyCols.has("journalAdjustments") && (
                        <TableCell className={`text-sm text-right font-mono ${(row.journalAdjustments ?? 0) > 0 ? "text-destructive" : (row.journalAdjustments ?? 0) < 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                          {fmtLDrCr(row.journalAdjustments ?? 0)}
                        </TableCell>
                      )}
                      {monthlyCols.has("checkReturns") && <TableCell className="text-sm text-right font-mono text-[hsl(213,94%,52%)] font-semibold">{fmtL(row.checkReturns)}</TableCell>}
                      {monthlyCols.has("outstanding") && <TableCell className="text-sm text-right font-mono">{fmtL(Math.abs(row.outstanding))}</TableCell>}
                      {monthlyCols.has("overdue") && <TableCell className="text-sm text-right font-mono text-destructive font-semibold">{fmtL(row.overdue)}</TableCell>}
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold border-t-2 border-border">
                    <TableCell className="text-sm font-bold">Summary</TableCell>
                    {monthlyCols.has("sales") && <TableCell className="text-sm text-right font-mono font-bold">{fmtL(trendData.reduce((s, r) => s + r.sales, 0))}</TableCell>}
                    {monthlyCols.has("receipts") && <TableCell className="text-sm text-right font-mono font-bold">{fmtL(trendData.reduce((s, r) => s + r.receipts, 0))}</TableCell>}
                    {monthlyCols.has("creditNotes") && <TableCell className="text-sm text-right font-mono font-bold">{fmtL(trendData.reduce((s, r) => s + r.creditNotes, 0))}</TableCell>}
                    {monthlyCols.has("debitNotes") && <TableCell className="text-sm text-right font-mono font-bold text-[hsl(28,80%,55%)]">{fmtL(trendData.reduce((s, r) => s + (r.debitNotes ?? 0), 0))}</TableCell>}
                    {monthlyCols.has("journalAdjustments") && (() => {
                      const totJ = trendData.reduce((s, r) => s + (r.journalAdjustments ?? 0), 0);
                      return (
                        <TableCell className={`text-sm text-right font-mono font-bold ${totJ > 0 ? "text-destructive" : totJ < 0 ? "text-emerald-700" : ""}`}>
                          {fmtLDrCr(totJ)}
                        </TableCell>
                      );
                    })()}
                    {monthlyCols.has("checkReturns") && <TableCell className="text-sm text-right font-mono font-bold text-[hsl(213,94%,52%)]">{fmtL(trendData.reduce((s, r) => s + r.checkReturns, 0))}</TableCell>}
                    {monthlyCols.has("outstanding") && <TableCell className="text-sm text-right font-mono font-bold">{fmtL(Math.abs(trendData[trendData.length - 1]?.outstanding ?? 0))}</TableCell>}
                    {monthlyCols.has("overdue") && <TableCell className="text-sm text-right font-mono font-bold text-destructive">{fmtL(trendData[trendData.length - 1]?.overdue ?? 0)}</TableCell>}
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </ScrollableTable>
        </CollapsibleContent>
      </Card>
      </Collapsible>
      </div>
      {/* End export region 2 */}

      {/* Opening Balance */}
      <div ref={obSectionRef}>
      <Collapsible open={obOpen} onOpenChange={setObOpen}>
      <Card className="rounded-card border-border bg-surface">
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <button className="flex items-center justify-between w-full text-left">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Opening Balance Breakdown
              </CardTitle>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${obOpen ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Opening Balance (1-Apr-2025)</p>
              <p className="text-lg font-bold text-foreground">
                {fmt(Math.abs(customer.openingBalance))}
                <span className={`ml-1 text-sm font-medium ${customer.openingDrCr === 'Cr' ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {customer.openingDrCr ?? 'Dr'}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Included in Outstanding</p>
              <p className="text-lg font-bold text-foreground">{customer.openingDrCr === 'Cr' ? 'Reduces' : 'Yes'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Treated as Overdue Since</p>
              <p className={`text-lg font-bold ${customer.openingDrCr === 'Cr' ? 'text-green-600' : 'text-destructive'}`}>
                {customer.openingDrCr === 'Cr' ? 'N/A (Credit)' : '1-Apr-2025'}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 p-2 bg-muted/50 rounded-input">
            Opening balance is customer-level only and is not included in invoice-level aging below.
          </p>
        </CardContent>
        </CollapsibleContent>
      </Card>
      </Collapsible>
      </div>

      {/* ── Consolidated Transactions Ledger ───────────────────────────────── */}
      <div ref={transactionsRef}>
      <Collapsible open={invoicesOpen} onOpenChange={setInvoicesOpen}>
      <Card className="rounded-card border-border bg-surface overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-end justify-between flex-wrap gap-2">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-left mb-1">
                <CardTitle className="text-sm font-semibold">
                  Transactions ({filteredTransactions.length}{filteredTransactions.length !== transactions.length ? ` of ${transactions.length}` : ""})
                </CardTitle>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${invoicesOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            {agingBucketFilter.size > 0 && (() => {
              const labels: Record<string, string> = {
                "0_30": "0–30 days", "31_60": "31–60 days", "61_90": "61–90 days",
                "91_120": "91–120 days", "121_180": "121–180 days", "180_plus": "180+ days",
              };
              // Preserve bucket order rather than Set insertion order.
              const order = ["0_30", "31_60", "61_90", "91_120", "121_180", "180_plus"];
              const selected = order.filter((k) => agingBucketFilter.has(k));
              return (
                <div className="flex flex-wrap items-center gap-1 mb-1">
                  {selected.map((k) => (
                    <Badge
                      key={k}
                      className="bg-primary/10 text-primary border-primary/20 text-xs gap-1 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAgingBucketFilter((prev) => {
                          const next = new Set(prev);
                          next.delete(k);
                          return next;
                        });
                        setInvoicePage(1);
                      }}
                    >
                      {labels[k] ?? k} <X className="h-3 w-3" />
                    </Badge>
                  ))}
                  {selected.length > 1 && (
                    <Badge
                      variant="outline"
                      className="text-xs gap-1 cursor-pointer text-muted-foreground"
                      onClick={(e) => { e.stopPropagation(); setAgingBucketFilter(new Set()); setInvoicePage(1); }}
                    >
                      Clear all <X className="h-3 w-3" />
                    </Badge>
                  )}
                </div>
              );
            })()}
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Search Voucher</span>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search voucher #..."
                  value={invoiceSearch}
                  onChange={(e) => { setInvoiceSearch(e.target.value); setInvoicePage(1); }}
                  className="pl-8 h-8 w-[180px] rounded-input border-border text-sm"
                />
              </div>
            </div>
            <FilterMultiSelect
              label="Voucher Type"
              options={VOUCHER_TYPE_OPTIONS}
              selected={voucherTypeFilter}
              allLabel="All Vouchers"
              noun="types"
              triggerWidth="w-[170px]"
              onChange={(next) => { setVoucherTypeFilter(next); setInvoicePage(1); }}
            />
            {showStatusFilter && (
              <FilterMultiSelect
                label="Status (Sales)"
                options={STATUS_OPTIONS}
                selected={statusFilter}
                allLabel="All Status"
                noun="statuses"
                triggerWidth="w-[140px]"
                onChange={(next) => { setStatusFilter(next); setInvoicePage(1); }}
              />
            )}
            {/* Column selector */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Columns</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-sm rounded-input border-border" onClick={(e) => e.stopPropagation()}>
                    <Columns3 className="h-3.5 w-3.5" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <div className="flex items-center gap-1 px-1 py-0.5">
                    <DropdownMenuItem
                      onClick={(e) => { e.preventDefault(); setTxnCols(new Set(availableTxnColumns.map((c) => c.key))); }}
                      onSelect={(e) => e.preventDefault()}
                      className="text-xs flex-1 justify-center"
                    >
                      Select all
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => { e.preventDefault(); setTxnCols(new Set()); }}
                      onSelect={(e) => e.preventDefault()}
                      className="text-xs flex-1 justify-center"
                    >
                      Clear all
                    </DropdownMenuItem>
                  </div>
                  <DropdownMenuSeparator />
                  {availableTxnColumns.map((col) => {
                    const toggle = () =>
                      setTxnCols((prev) => {
                        const next = new Set(prev);
                        if (next.has(col.key)) next.delete(col.key); else next.add(col.key);
                        return next;
                      });
                    return (
                      <DropdownMenuItem
                        key={col.key}
                        onClick={(e) => { e.preventDefault(); toggle(); }}
                        onSelect={(e) => e.preventDefault()}
                        className="text-xs gap-2"
                      >
                        <Checkbox checked={txnCols.has(col.key)} onCheckedChange={toggle} />
                        <span className="truncate">{col.label}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* Export transactions */}
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">&nbsp;</span>
              <Button
                variant="outline" size="sm"
                onClick={(e) => { e.stopPropagation(); handleTransactionsExport(); }}
                disabled={filteredTransactions.length === 0}
                className="h-8 gap-1.5 text-sm rounded-input border-border"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CollapsibleContent>
        <ScrollableTable>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {visibleTxnColumns.map((col) => {
                  const active = txnSort.key === col.sortKey;
                  const Icon = !active ? ArrowUpDown : txnSort.dir === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <TableHead key={col.key} className={`text-xs font-semibold text-foreground/70 ${col.align === "right" ? "text-right" : ""}`}>
                      <button
                        type="button"
                        onClick={() => handleSortClick(col.sortKey)}
                        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer select-none ${active ? "text-primary" : ""} ${col.align === "right" ? "ml-auto" : ""}`}
                      >
                        <span>{col.label}</span>
                        <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length > 0 && (() => {
                const totals: TxnTotals = {
                  amount:    filteredTransactions.reduce((s, r) => s + r.amount, 0),
                  received:  filteredTransactions.reduce((s, r) => s + (r.kind === "sales" ? (r.received ?? 0) : 0), 0),
                  pending:   filteredTransactions.reduce((s, r) => s + (r.kind === "sales" ? (r.pending ?? 0) : 0), 0),
                  salesCount: filteredTransactions.filter((r) => r.kind === "sales").length,
                };
                // "TOTAL (N)" label sits in the first visible column; remaining
                // columns render their own total (or stay blank).
                return (
                  <TableRow className="bg-primary/5 border-b-2 border-primary/20 font-semibold sticky top-0">
                    {visibleTxnColumns.map((col, i) => (
                      <TableCell
                        key={col.key}
                        className={`${col.align === "right" ? "text-right" : ""} ${i === 0 ? "text-xs font-bold text-primary tracking-wide" : ""}`}
                      >
                        {i === 0
                          ? <span className="uppercase">Total ({filteredTransactions.length})</span>
                          : col.total?.(totals) ?? null}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })()}
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={Math.max(1, visibleTxnColumns.length)} className="text-center py-8 text-muted-foreground">
                    No transactions match the selected filter.
                  </TableCell>
                </TableRow>
              ) : (
                pagedTransactions.map((r) => (
                  <TableRow key={r.rowKey} className="hover:bg-muted/30 transition-colors">
                    {visibleTxnColumns.map((col) => (
                      <TableCell key={col.key} className={col.align === "right" ? "text-right" : ""}>
                        {col.cell(r)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollableTable>
        {totalInvoicePages > 1 && (
          <div className="px-4 py-3 border-t border-border">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setInvoicePage((p) => Math.max(1, p - 1))}
                    className={invoicePage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {Array.from({ length: totalInvoicePages }, (_, i) => i + 1).map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      isActive={page === invoicePage}
                      onClick={() => setInvoicePage(page)}
                      className="cursor-pointer"
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setInvoicePage((p) => Math.min(totalInvoicePages, p + 1))}
                    className={invoicePage === totalInvoicePages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
        </CollapsibleContent>
      </Card>
      </Collapsible>
      </div>

      {/* ── Ledger Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={!!ledgerMonth} onOpenChange={(open) => { if (!open) setLedgerMonth(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-primary" />
              Ledger — {ledgerMonth} · {customer?.name}
            </DialogTitle>
          </DialogHeader>

          {ledgerTrendRow && (
            <div className="space-y-4">
              {/* Monthly summary strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {[
                  { label: "Opening Balance",    value: fmtL(ledgerOpeningBal),                                       sub: "start of month" },
                  { label: "+ Sales",             value: fmtL(ledgerTrendRow.sales),                                   sub: "invoices raised" },
                  { label: "− Receipts",          value: fmtL(ledgerTrendRow.receipts),                                sub: "payments received", cr: true },
                  { label: "− Credit Notes",      value: fmtL(ledgerTrendRow.creditNotes),                             sub: "adjustments", cr: true },
                  { label: "+ Debit Notes",       value: fmtL((ledgerTrendRow as any).debitNotes ?? 0),                  sub: "billed extra", dn: true },
                  { label: "± Journal (Net)",     value: fmtLDrCr((ledgerTrendRow as any).journalAdjustments ?? 0),     sub: "Dr − Cr", jn: true },
                  { label: "+ Chq Returns",       value: fmtL(ledgerTrendRow.checkReturns),                            sub: "bounced cheques", chq: true },
                  { label: "Closing Outstanding", value: fmtL(Math.abs(ledgerTrendRow.outstanding)),                             sub: "end of month", closing: true },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`rounded-card border p-3 space-y-0.5 ${
                      item.closing
                        ? "border-primary/30 bg-primary/5"
                        : item.cr
                        ? "border-emerald-200 bg-emerald-50/50"
                        : (item as any).chq
                        ? "border-blue-200 bg-blue-50/50"
                        : (item as any).dn
                        ? "border-orange-200 bg-orange-50/40"
                        : (item as any).jn
                        ? "border-indigo-200 bg-indigo-50/40"
                        : "border-border bg-surface"
                    }`}
                  >
                    <p className="text-[10px] text-muted-foreground">{item.label}</p>
                    <p className={`text-sm font-bold ${
                      item.closing ? "text-primary"
                        : item.cr ? "text-emerald-700"
                        : (item as any).chq ? "text-blue-600"
                        : (item as any).dn ? "text-orange-700"
                        : (item as any).jn ? "text-indigo-700"
                        : "text-foreground"
                    }`}>
                      {item.value}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{item.sub}</p>
                  </div>
                ))}
              </div>

              {/* Overdue callout */}
              {ledgerTrendRow.overdue > 0 && (
                <div className="flex items-center gap-2 p-2.5 rounded-input bg-destructive/8 border border-destructive/20 text-destructive text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Overdue as of end of month: <span className="font-semibold ml-1">{fmtL(ledgerTrendRow.overdue)}</span>
                </div>
              )}

              {/* Invoices raised this month */}
              <div>
                <p className="text-xs font-semibold text-foreground/70 mb-2">
                  Invoices Raised in {ledgerMonth}
                  {ledgerInvoices.length === 0 && (
                    <span className="font-normal text-muted-foreground ml-1">— none</span>
                  )}
                </p>
                {ledgerInvoices.length > 0 && (
                  <ScrollableTable className="rounded-card border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-xs">Invoice #</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          {isConsolidated && <TableHead className="text-xs">Company</TableHead>}
                          <TableHead className="text-xs text-right">Amount</TableHead>
                          <TableHead className="text-xs text-right">Receipt Adj</TableHead>
                          <TableHead className="text-xs text-right">CN Adj</TableHead>
                          <TableHead className="text-xs text-right">Other Pmt</TableHead>
                          <TableHead className="text-xs text-right">Pending</TableHead>
                          <TableHead className="text-xs">Due Date</TableHead>
                          <TableHead className="text-xs text-right">OD Days</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ledgerInvoices.map((inv, idx) => (
                          <TableRow key={`${inv.id}-${idx}`} className="hover:bg-muted/20">
                            <TableCell className="text-xs font-medium whitespace-nowrap">{inv.number}</TableCell>
                            <TableCell className="text-xs capitalize text-muted-foreground">
                              {inv.voucherType.replace("_", " ")}
                            </TableCell>
                            {isConsolidated && (
                              <TableCell className="text-xs text-muted-foreground">{inv._company}</TableCell>
                            )}
                            <TableCell className="text-xs text-right font-mono">{fmt(inv.amount)}</TableCell>
                            <TableCell className="text-xs text-right font-mono text-emerald-700">
                              {inv.receiptAdj > 0 ? fmt(inv.receiptAdj) : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono text-emerald-700">
                              {inv.creditNoteAdj > 0 ? fmt(inv.creditNoteAdj) : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono text-indigo-700">
                              {(inv.otherPaymentAdj ?? 0) > 0 ? fmt(inv.otherPaymentAdj ?? 0) : "—"}
                            </TableCell>
                            <TableCell className={`text-xs text-right font-mono ${inv.pending > 0 ? "font-semibold" : "text-muted-foreground"}`}>
                              {fmt(inv.pending)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateDMY(inv.dueDate)}</TableCell>
                            <TableCell className={`text-xs text-right font-mono ${
                              inv.overdueDays > 90  ? "text-destructive font-semibold"
                              : inv.overdueDays > 0 ? "text-primary font-semibold"
                              : ""
                            }`}>
                              {inv.overdueDays > 0 ? inv.overdueDays : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 rounded-button capitalize ${statusStyle[inv.status]}`}
                              >
                                {inv.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Subtotal row */}
                        <TableRow className="bg-muted/50 font-semibold border-t border-border">
                          <TableCell className="text-xs font-bold" colSpan={isConsolidated ? 3 : 2}>
                            Total ({ledgerInvoices.length} invoice{ledgerInvoices.length !== 1 ? "s" : ""})
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono font-bold">
                            {fmt(ledgerInvoices.reduce((s, i) => s + i.amount, 0))}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono font-bold text-emerald-700">
                            {fmt(ledgerInvoices.reduce((s, i) => s + i.receiptAdj, 0))}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono font-bold text-emerald-700">
                            {fmt(ledgerInvoices.reduce((s, i) => s + i.creditNoteAdj, 0))}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono font-bold text-indigo-700">
                            {fmt(ledgerInvoices.reduce((s, i) => s + (i.otherPaymentAdj ?? 0), 0))}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono font-bold">
                            {fmt(ledgerInvoices.reduce((s, i) => s + i.pending, 0))}
                          </TableCell>
                          <TableCell colSpan={3} />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </ScrollableTable>
                )}
              </div>

              <p className="text-[10px] text-muted-foreground">
                Note: Receipt Adj, CN Adj and Other Pmt shown per invoice are cumulative totals applied to date, not restricted to this month.
                Monthly receipts and credit notes totals in the summary strip reflect actual transactions in {ledgerMonth}.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
