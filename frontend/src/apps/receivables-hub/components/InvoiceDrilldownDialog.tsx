import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import {
  Download, Share2, Mail, MessageCircle, Search, FileText, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, ChevronDown,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@hub/components/ui/dialog";
import { Button } from "@hub/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@hub/components/ui/dropdown-menu";
import { Input } from "@hub/components/ui/input";
import {
  TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { MultiSelect } from "@hub/components/MultiSelect";
import { SaleTypeMultiSelect } from "@hub/components/SaleTypeMultiSelect";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ColumnPicker } from "@hub/components/ColumnPicker";
import { formatDateDMY } from "@hub/lib/utils";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";
import type { InvoiceStatus, SaleType } from "@hub/lib/types";

/** One open-bill line shown in the drill-down. */
export interface InvoiceDrillRow {
  customerName: string;
  groupName: string;
  company: string;
  location: string;
  number: string;
  billRefName: string;
  date: string;
  amount: number;
  received: number;
  pending: number;
  dueDate: string;
  overdueDays: number;
  status: InvoiceStatus;
  voucherType: SaleType;
  /** Synthetic reconciliation line bridging gross bills → the report's net figure. */
  isAdjustment?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle: string;
  rows: InvoiceDrillRow[];
  asOfDate: string;
  /** Report's net figure per ledger key (`name|||company|||location`) for the clicked
   *  category. The popup adds a reconciliation line so each ledger/group/total matches
   *  the base report exactly. */
  ledgerFigures?: Record<string, number>;
}

const SALE_TYPE_LABELS: Record<string, string> = {
  ink: "Ink", spare_parts: "Spare Parts", machine: "Machine", head: "Head", other: "Other",
};

const STATUS_ORDER: InvoiceStatus[] = ["overdue", "partial", "pending", "paid"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const statusStyle: Record<InvoiceStatus, string> = {
  paid:    "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  partial: "bg-primary/15 text-primary border-primary/30",
  overdue: "bg-destructive/15 text-destructive border-destructive/30",
  pending: "bg-muted text-muted-foreground border-border",
};

/** ₹ Cr / L / raw — mirrors the report's `fmt`. */
const fmt = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000)   return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

type ColKey =
  | "customerName" | "number" | "billRefName" | "date"
  | "amount" | "received" | "pending" | "dueDate" | "overdueDays" | "voucherType" | "status";

const COL_DEFS: { key: ColKey; label: string; align?: "right"; money?: boolean }[] = [
  { key: "customerName", label: "Customer" },
  { key: "number",       label: "Voucher #" },
  { key: "billRefName",  label: "Bill Ref" },
  { key: "date",         label: "Date" },
  { key: "amount",       label: "Amount",   align: "right", money: true },
  { key: "received",     label: "Received", align: "right", money: true },
  { key: "pending",      label: "Pending",  align: "right", money: true },
  { key: "dueDate",      label: "Due Date" },
  { key: "overdueDays",  label: "OD Days",  align: "right" },
  { key: "voucherType",  label: "Sale Type" },
  { key: "status",       label: "Status" },
];

const exportVal = (key: ColKey, r: InvoiceDrillRow): string | number => {
  switch (key) {
    case "customerName": return r.customerName;
    case "number":       return r.number;
    case "billRefName":  return r.billRefName;
    case "date":         return formatDateDMY(r.date);
    case "amount":       return r.amount;
    case "received":     return r.received;
    case "pending":      return r.pending;
    case "dueDate":      return formatDateDMY(r.dueDate);
    case "overdueDays":  return r.overdueDays > 0 ? r.overdueDays : 0;
    case "voucherType":  return SALE_TYPE_LABELS[r.voucherType] ?? r.voucherType;
    case "status":       return r.status;
  }
};

export function InvoiceDrilldownDialog({ open, onOpenChange, title, subtitle, rows, asOfDate, ledgerFigures }: Props) {
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [saleTypes, setSaleTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<ColKey>("pending");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [visibleCols, setVisibleCols] = useState<string[]>(COL_DEFS.map((c) => c.key));
  const [groupBy, setGroupBy] = useState<"customer" | "group">("customer");
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Switching view resets expansion so each view shows its default (Customers open, Groups collapsed).
  useEffect(() => { setToggled(new Set()); }, [groupBy]);

  const customerOptions = useMemo(
    () => [...new Set(rows.map((r) => r.customerName).filter(Boolean))].sort(),
    [rows],
  );
  const companyOptions = useMemo(
    () => [...new Set(rows.map((r) => r.company).filter(Boolean))].sort(),
    [rows],
  );
  const locationOptions = useMemo(
    () => [...new Set(rows.map((r) => r.location).filter(Boolean))].sort(),
    [rows],
  );
  const statusOptions = useMemo(() => {
    const present = new Set(rows.map((r) => r.status));
    return STATUS_ORDER.filter((s) => present.has(s)).map(cap);
  }, [rows]);

  const filtered = useMemo(() => {
    const custSet = new Set(customerNames);
    const coSet = new Set(companies);
    const locSet = new Set(locations);
    const stSet = new Set(saleTypes);
    const statusSet = new Set(statuses.map((s) => s.toLowerCase()));
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (customerNames.length && !custSet.has(r.customerName)) return false;
      if (companies.length && !coSet.has(r.company)) return false;
      if (locations.length && !locSet.has(r.location)) return false;
      if (saleTypes.length && saleTypes.length < 5 && !stSet.has(r.voucherType)) return false;
      if (statuses.length && !statusSet.has(r.status)) return false;
      if (q && !(r.customerName.toLowerCase().includes(q) || (r.number ?? "").toLowerCase().includes(q) || (r.billRefName ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, customerNames, companies, locations, saleTypes, statuses, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    const textKeys: ColKey[] = ["customerName", "number", "billRefName", "date", "dueDate", "voucherType", "status"];
    arr.sort((a, b) =>
      textKeys.includes(sortKey)
        ? dir * String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""))
        : dir * ((a[sortKey] as number) - (b[sortKey] as number)),
    );
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: ColKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "customerName" ? "asc" : "desc"); }
  };
  const sortIcon = (key: ColKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  // Reconcile each ledger's bill-level pending to the report's net figure — but only
  // in the default (unfiltered) view, since a popup filter shows a subset of bills.
  const reconcile =
    ledgerFigures != null &&
    !customerNames.length && !companies.length && !locations.length &&
    !saleTypes.length && !statuses.length && !search.trim();

  // Bucket rows into groups/ledgers with subtotals, ordered by the active sort column.
  type Bucket = { key: string; label: string; sub?: string; rows: InvoiceDrillRow[]; amount: number; received: number; pending: number };
  const orderBuckets = (arr: Bucket[]): Bucket[] => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "amount" || sortKey === "received" || sortKey === "pending") arr.sort((a, b) => dir * (a[sortKey] - b[sortKey]));
    else arr.sort((a, b) => dir * a.label.localeCompare(b.label));
    return arr;
  };
  // A "ledger" = customer name + company + location (matches the report's ledger rows),
  // so two same-named ledgers in different companies stay separate.
  const bucketLedgers = (rows: InvoiceDrillRow[]): Bucket[] => {
    const map = new Map<string, Bucket>();
    for (const r of rows) {
      const k = `${r.customerName}|||${r.company}|||${r.location}`;
      let g = map.get(k);
      if (!g) { g = { key: k, label: r.customerName, sub: `${r.company} · ${r.location}`, rows: [], amount: 0, received: 0, pending: 0 }; map.set(k, g); }
      g.rows.push(r); g.amount += r.amount; g.received += r.received; g.pending += r.pending;
    }
    const arr = [...map.values()];
    if (reconcile) {
      for (const g of arr) {
        const net = ledgerFigures![g.key];
        if (net == null || Math.abs(g.pending - net) < 1) continue;
        const adj = g.pending - net; // >0: advances/credits reduce; <0: receipts add
        const r0 = g.rows[0];
        g.rows = [...g.rows, {
          customerName: g.label, groupName: r0.groupName, company: r0.company, location: r0.location,
          number: "", billRefName: adj >= 0 ? "Advances / on-account / credit notes (not bill-allocated)" : "Receipts collected this period",
          date: "", amount: 0, received: adj, pending: -adj, dueDate: "", overdueDays: 0,
          status: "pending", voucherType: "other", isAdjustment: true,
        }];
        g.received += adj; g.pending -= adj; // pending now equals the report's net figure
      }
    }
    return orderBuckets(arr);
  };
  const bucketGroups = (rows: InvoiceDrillRow[]): Bucket[] => {
    const map = new Map<string, Bucket>();
    for (const r of rows) {
      const k = r.groupName;
      let g = map.get(k);
      if (!g) { g = { key: k, label: k, rows: [], amount: 0, received: 0, pending: 0 }; map.set(k, g); }
      g.rows.push(r); g.amount += r.amount; g.received += r.received; g.pending += r.pending;
    }
    return orderBuckets([...map.values()]);
  };

  // Customers view: ledger → invoices. Groups view: group → ledger → invoices.
  const customerTree = useMemo(() => bucketLedgers(sorted), [sorted, sortKey, sortDir, reconcile, ledgerFigures]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupTree = useMemo(
    () => bucketGroups(sorted).map((g) => {
      const ledgers = bucketLedgers(g.rows);
      // Group subtotal = sum of its ledgers (so it reflects the reconciliation too).
      const amount = ledgers.reduce((s, l) => s + l.amount, 0);
      const received = ledgers.reduce((s, l) => s + l.received, 0);
      const pending = ledgers.reduce((s, l) => s + l.pending, 0);
      return { ...g, ledgers, amount, received, pending };
    }),
    [sorted, sortKey, sortDir, reconcile, ledgerFigures], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Grand total derived from the (reconciled) ledger tree so it matches the report.
  const totals = useMemo(
    () => customerTree.reduce(
      (t, b) => { t.amount += b.amount; t.received += b.received; t.pending += b.pending; return t; },
      { amount: 0, received: 0, pending: 0 },
    ),
    [customerTree],
  );

  const topCount = groupBy === "group" ? groupTree.length : customerTree.length;

  // Open/close: Customers view defaults OPEN (toggled = collapsed), Groups view
  // defaults CLOSED (toggled = expanded). Reset when the view switches.
  const isOpen = (k: string) => (groupBy === "customer" ? !toggled.has(k) : toggled.has(k));
  const toggle = (k: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  const clearAll = () => {
    setCustomerNames([]); setCompanies([]); setLocations([]); setSaleTypes([]); setStatuses([]); setSearch("");
  };
  const chips: FilterChip[] = [
    customerNames.length > 0 && {
      label: customerNames.length <= 2 ? `Customer: ${customerNames.join(", ")}` : `${customerNames.length} customers`,
      onRemove: () => setCustomerNames([]),
    },
    companies.length > 0 && {
      label: companies.length <= 2 ? `Company: ${companies.join(", ")}` : `${companies.length} companies`,
      onRemove: () => setCompanies([]),
    },
    locations.length > 0 && {
      label: locations.length <= 2 ? `Location: ${locations.join(", ")}` : `${locations.length} locations`,
      onRemove: () => setLocations([]),
    },
    saleTypes.length > 0 && {
      label: saleTypes.length <= 2 ? `Type: ${saleTypes.map((t) => SALE_TYPE_LABELS[t] ?? t).join(", ")}` : `${saleTypes.length} types`,
      onRemove: () => setSaleTypes([]),
    },
    statuses.length > 0 && {
      label: statuses.length <= 2 ? `Status: ${statuses.join(", ")}` : `${statuses.length} statuses`,
      onRemove: () => setStatuses([]),
    },
    search.trim() && { label: `Search: ${search.trim()}`, onRemove: () => setSearch("") },
  ].filter(Boolean) as FilterChip[];

  const visibleDefs = COL_DEFS.filter((d) => visibleCols.includes(d.key));

  const scrollBy = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: "smooth" });

  // Arrow / Page / Home / End keys scroll the table (both axes) while the popup is
  // open — unless focus is in a text field or an open dropdown (so typing/search work).
  useEffect(() => {
    if (!open) return;
    const HSTEP = 320, VSTEP = 240;
    const onKey = (e: KeyboardEvent) => {
      const node = scrollRef.current;
      if (!node) return;
      const el = document.activeElement as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return;
        const role = el.getAttribute("role");
        if (role && ["combobox", "listbox", "menu", "menuitem", "option"].includes(role)) return;
      }
      let dx = 0, dy = 0;
      switch (e.key) {
        case "ArrowRight": dx = HSTEP; break;
        case "ArrowLeft":  dx = -HSTEP; break;
        case "ArrowDown":  dy = VSTEP; break;
        case "ArrowUp":    dy = -VSTEP; break;
        case "PageDown":   dy = node.clientHeight - 40; break;
        case "PageUp":     dy = -(node.clientHeight - 40); break;
        case "Home":       node.scrollTo({ top: 0, behavior: "smooth" }); e.preventDefault(); return;
        case "End":        node.scrollTo({ top: node.scrollHeight, behavior: "smooth" }); e.preventDefault(); return;
        default: return;
      }
      e.preventDefault();
      node.scrollBy({ left: dx, top: dy, behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /** Render one data cell for a visible column. */
  const renderCell = (key: ColKey, r: InvoiceDrillRow): ReactNode => {
    if (r.isAdjustment) {
      // Reconciliation line: label in the first column, only Received/Pending carry values.
      if (key === "customerName") return <TableCell key={key} className="whitespace-nowrap italic text-muted-foreground">{r.billRefName}</TableCell>;
      if (key === "received")     return <TableCell key={key} className="text-right font-mono italic text-muted-foreground">{fmt(r.received)}</TableCell>;
      if (key === "pending")      return <TableCell key={key} className="text-right font-mono italic text-muted-foreground">{fmt(r.pending)}</TableCell>;
      return <TableCell key={key} />;
    }
    switch (key) {
      case "customerName":
        return (
          <TableCell key={key} className="whitespace-nowrap">
            {r.customerName}
            <span className="ml-1.5 text-[10px] text-muted-foreground opacity-70">{r.company} · {r.location}</span>
          </TableCell>
        );
      case "number":
        return <TableCell key={key} className="font-mono whitespace-nowrap max-w-[160px] truncate" title={r.number || "—"}>{r.number || "—"}</TableCell>;
      case "billRefName":
        return <TableCell key={key} className="text-muted-foreground whitespace-nowrap max-w-[140px] truncate" title={r.billRefName || "—"}>{r.billRefName || "—"}</TableCell>;
      case "date":
        return <TableCell key={key} className="text-muted-foreground whitespace-nowrap">{formatDateDMY(r.date)}</TableCell>;
      case "amount":
        return <TableCell key={key} className="text-right font-mono">{fmt(r.amount)}</TableCell>;
      case "received":
        return <TableCell key={key} className={`text-right font-mono ${r.received > 0 ? "text-emerald-700 font-medium" : "text-muted-foreground"}`}>{fmt(r.received)}</TableCell>;
      case "pending":
        return <TableCell key={key} className={`text-right font-mono ${r.pending > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{fmt(r.pending)}</TableCell>;
      case "dueDate":
        return <TableCell key={key} className="text-muted-foreground whitespace-nowrap">{formatDateDMY(r.dueDate)}</TableCell>;
      case "overdueDays":
        return (
          <TableCell key={key} className={`text-right font-mono ${r.overdueDays > 90 ? "text-destructive font-semibold" : r.overdueDays > 0 ? "text-primary font-medium" : "text-muted-foreground"}`}>
            {r.overdueDays > 0 ? r.overdueDays : "—"}
          </TableCell>
        );
      case "voucherType":
        return <TableCell key={key} className="whitespace-nowrap text-xs">{SALE_TYPE_LABELS[r.voucherType] ?? r.voucherType}</TableCell>;
      case "status":
        return (
          <TableCell key={key}>
            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-button border capitalize ${statusStyle[r.status]}`}>{r.status}</span>
          </TableCell>
        );
    }
  };

  /** Render one total cell for a visible column. */
  const renderTotalCell = (key: ColKey, idx: number): ReactNode => {
    if (idx === 0) return <TableCell key={key} className="text-sm uppercase tracking-wide text-foreground/80 whitespace-nowrap">Total ({topCount} {groupBy === "group" ? "groups" : "ledgers"})</TableCell>;
    if (key === "amount")   return <TableCell key={key} className="text-right font-mono text-sm">{fmt(totals.amount)}</TableCell>;
    if (key === "received") return <TableCell key={key} className="text-right font-mono text-sm text-emerald-700">{fmt(totals.received)}</TableCell>;
    if (key === "pending")  return <TableCell key={key} className="text-right font-mono text-sm text-destructive">{fmt(totals.pending)}</TableCell>;
    return <TableCell key={key} />;
  };

  /** A collapsible subtotal row (group or ledger) — `level` controls indent. */
  const renderSummaryRow = (
    rowKey: string, label: string, sub: string | undefined, count: number, countNoun: string,
    vals: { amount: number; received: number; pending: number },
    level: number, open: boolean, onClick: () => void,
  ): ReactNode => (
    <TableRow
      key={rowKey}
      className={`cursor-pointer text-[13px] ${level === 0 ? "bg-muted/50 hover:bg-muted/70 font-semibold" : "bg-muted/25 hover:bg-muted/40 font-medium"}`}
      onClick={onClick}
    >
      {visibleDefs.map((d, idx) => {
        if (idx === 0) return (
          <TableCell key={d.key} className="whitespace-nowrap" style={{ paddingLeft: 12 + level * 22 }}>
            <span className="inline-flex items-center gap-1.5">
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {label}
              {sub && <span className="text-[10px] text-muted-foreground opacity-70">{sub}</span>}
              <span className="text-[10px] text-muted-foreground">({count} {countNoun})</span>
            </span>
          </TableCell>
        );
        if (d.key === "amount")   return <TableCell key={d.key} className="text-right font-mono">{fmt(vals.amount)}</TableCell>;
        if (d.key === "received") return <TableCell key={d.key} className="text-right font-mono text-emerald-700">{fmt(vals.received)}</TableCell>;
        if (d.key === "pending")  return <TableCell key={d.key} className="text-right font-mono text-destructive">{fmt(vals.pending)}</TableCell>;
        return <TableCell key={d.key} />;
      })}
    </TableRow>
  );

  /** An invoice row, indented under its group/customer. */
  const renderInvoiceRow = (r: InvoiceDrillRow, rowKey: string, indentClass: string): ReactNode => (
    <TableRow key={rowKey} className={`hover:bg-muted/30 transition-colors text-[13px] ${indentClass}`}>
      {visibleDefs.map((d) => renderCell(d.key, r))}
    </TableRow>
  );

  const buildExport = (): { blob: Blob; filename: string } => {
    const aoa: (string | number)[][] = [];
    aoa.push([title]);
    aoa.push([subtitle]);
    aoa.push([`As on: ${formatDateDMY(asOfDate)}`, `Grouped by: ${groupBy === "group" ? "Customer group" : "Customer"}`]);
    aoa.push([
      `Customer: ${customerNames.length ? customerNames.join(", ") : "All"}`,
      `Company: ${companies.length ? companies.join(", ") : "All"}`,
      `Location: ${locations.length ? locations.join(", ") : "All"}`,
      `Sale Type: ${saleTypes.length ? saleTypes.map((t) => SALE_TYPE_LABELS[t] ?? t).join(", ") : "All"}`,
      `Status: ${statuses.length ? statuses.join(", ") : "All"}`,
      `Search: ${search.trim() || "—"}`,
    ]);
    aoa.push([]);

    // Build export columns from the visible set. The Customer column expands to
    // Customer + Company + Location so the structured export keeps that detail.
    const header: string[] = [];
    const extractors: ((r: InvoiceDrillRow) => string | number)[] = [];
    const money: { idx: number; key: "amount" | "received" | "pending" }[] = [];
    for (const d of visibleDefs) {
      if (d.key === "customerName") {
        header.push("Customer", "Company", "Location");
        extractors.push((r) => r.customerName, (r) => r.company, (r) => r.location);
      } else {
        if (d.money) money.push({ idx: header.length, key: d.key as "amount" | "received" | "pending" });
        header.push(d.label);
        extractors.push((r) => exportVal(d.key, r));
      }
    }
    const colHeaderIdx0 = aoa.length; // 0-indexed position of the column-header row
    aoa.push(header);
    // Summary row builder (group/customer subtotals + grand total) aligned to the columns.
    const summaryRow = (label: string, v: { amount: number; received: number; pending: number }) => {
      const a: (string | number)[] = header.map(() => "");
      a[0] = label;
      for (const m of money) a[m.idx] = v[m.key];
      return a;
    };
    const invCountOf = (c: Bucket) => c.rows.filter((r) => !r.isAdjustment).length;
    const ledgerLabel = (c: Bucket) => `${c.label}${c.sub ? ` — ${c.sub}` : ""} (${invCountOf(c)} invoices)`;
    // Mirror the on-screen view: Groups → group subtotal → ledger subtotal → invoices.
    // Track 0-indexed subtotal rows so they can be styled (green) afterwards.
    const subtotalRows0: number[] = [];
    const pushSummary = (label: string, v: { amount: number; received: number; pending: number }) => {
      subtotalRows0.push(aoa.length);
      aoa.push(summaryRow(label, v));
    };
    if (groupBy === "group") {
      for (const g of groupTree) {
        pushSummary(`${g.label} (${g.ledgers.length} ledgers)`, g);
        for (const c of g.ledgers) {
          pushSummary(`    ${ledgerLabel(c)}`, c);
          for (const r of c.rows) aoa.push(extractors.map((f) => f(r)));
        }
      }
    } else {
      for (const c of customerTree) {
        pushSummary(ledgerLabel(c), c);
        for (const r of c.rows) aoa.push(extractors.map((f) => f(r)));
      }
    }
    const grandRow0 = aoa.length;
    aoa.push(summaryRow(`Total (${topCount} ${groupBy === "group" ? "groups" : "ledgers"})`, totals));

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const ncols = header.length;
    ws["!cols"] = header.map((h) => ({ wch: h === "Customer" ? 30 : h === "Bill Ref" || h === "Voucher #" ? 16 : 13 }));
    const INR = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';
    const firstData = colHeaderIdx0 + 2; // 1-indexed first data row (row after the column header)
    const lastData = aoa.length;          // 1-indexed last row
    for (let row = firstData; row <= lastData; row++) {
      for (const m of money) {
        const cell = ws[`${XLSX.utils.encode_col(m.idx)}${row}`];
        if (cell && typeof cell.v === "number") cell.z = INR;
      }
    }
    // Styling: title + column header black/white/bold; subtotals green; grand total stronger green.
    styleRow(ws, 0, ncols, HEADER_STYLE);
    styleRow(ws, colHeaderIdx0, ncols, HEADER_STYLE);
    for (const r0 of subtotalRows0) styleRow(ws, r0, ncols, TOTAL_STYLE);
    styleRow(ws, grandRow0, ncols, GRAND_TOTAL_STYLE);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invoices");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const safe = subtitle.replace(/[^\w-]+/g, "_").slice(0, 60);
    return { blob, filename: `Invoices_${safe}_${asOfDate}.xlsx` };
  };

  /** Download the styled Excel export. */
  const handleExport = () => {
    const { blob, filename } = buildExport();
    saveAs(blob, filename);
  };

  const shareSubject = `${title} — as on ${formatDateDMY(asOfDate)}`;
  const shareText = (filename: string) => `${subtitle}\n\nReceivables export: ${filename}`;
  const canShareFiles = (() => {
    const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
    try {
      return !!nav.canShare && nav.canShare({ files: [new File([""], "a.xlsx")] });
    } catch {
      return false;
    }
  })();

  /** Native OS share sheet — Email / WhatsApp / Teams / … — with the file attached. */
  const handleShareNative = async () => {
    const { blob, filename } = buildExport();
    const file = new File([blob], filename, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: shareSubject, text: shareText(filename) });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return; // user dismissed the sheet
      }
    }
    saveAs(blob, filename); // last resort: at least save the file
  };

  /** Email — download the file + open the mail client (mailto cannot carry attachments). */
  const handleShareEmail = () => {
    const { blob, filename } = buildExport();
    saveAs(blob, filename);
    const body = `${shareText(filename)}\n\n(The file "${filename}" was just downloaded — please attach it to this email.)`;
    window.location.href = `mailto:?subject=${encodeURIComponent(shareSubject)}&body=${encodeURIComponent(body)}`;
  };

  /** WhatsApp — download the file + open WhatsApp with the message (attach the file manually). */
  const handleShareWhatsApp = () => {
    const { blob, filename } = buildExport();
    saveAs(blob, filename);
    const text = `*${shareSubject}*\n\n${shareText(filename)}\n\n(File "${filename}" downloaded — please attach it.)`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            {title}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{subtitle} · as on {formatDateDMY(asOfDate)}</p>
        </DialogHeader>

        {/* Filter bar */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">View</span>
            <div className="inline-flex rounded-input border border-border h-8 overflow-hidden">
              <button
                type="button"
                onClick={() => setGroupBy("customer")}
                className={`px-2.5 text-xs font-medium transition-colors ${groupBy === "customer" ? "bg-primary text-primary-foreground" : "bg-transparent text-foreground hover:bg-muted/50"}`}
              >
                Customers
              </button>
              <button
                type="button"
                onClick={() => setGroupBy("group")}
                className={`px-2.5 text-xs font-medium transition-colors border-l border-border ${groupBy === "group" ? "bg-primary text-primary-foreground" : "bg-transparent text-foreground hover:bg-muted/50"}`}
              >
                Groups
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Customer</span>
            <MultiSelect options={customerOptions} value={customerNames} onChange={setCustomerNames} allLabel="All Customers" noun="customers" triggerClassName="w-44 h-8 text-xs rounded-input border-border" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Company</span>
            <MultiSelect options={companyOptions} value={companies} onChange={setCompanies} allLabel="All Companies" noun="companies" triggerClassName="w-36 h-8 text-xs rounded-input border-border" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Location</span>
            <MultiSelect options={locationOptions} value={locations} onChange={setLocations} allLabel="All Locations" noun="locations" triggerClassName="w-36 h-8 text-xs rounded-input border-border" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Sale Type</span>
            <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} triggerClassName="w-36 h-8 text-xs rounded-input border-border" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Status</span>
            <MultiSelect options={statusOptions} value={statuses} onChange={setStatuses} allLabel="All Status" noun="statuses" triggerClassName="w-32 h-8 text-xs rounded-input border-border" />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[160px] max-w-xs">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Search</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Customer / voucher / bill ref…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 rounded-input border-border text-xs" />
            </div>
          </div>
          <ColumnPicker columns={COL_DEFS} visible={visibleCols} onChange={setVisibleCols} />
          <Button variant="outline" size="sm" className="rounded-button border-border h-8" onClick={handleExport} disabled={sorted.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export Excel
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-button border-border h-8" disabled={sorted.length === 0}>
                <Share2 className="h-3.5 w-3.5 mr-1.5" />
                Share
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {canShareFiles && (
                <DropdownMenuItem onClick={handleShareNative} className="cursor-pointer">
                  <Share2 className="h-4 w-4 mr-2" />
                  Share via apps… <span className="ml-1 text-[10px] text-muted-foreground">(file attached)</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleShareEmail} className="cursor-pointer">
                <Mail className="h-4 w-4 mr-2" />
                Email
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleShareWhatsApp} className="cursor-pointer">
                <MessageCircle className="h-4 w-4 mr-2" />
                WhatsApp
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Active filters — live chips, each removable */}
        {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearAll} />}

        {/* Scroll controls for the wide table */}
        <div className="flex items-center justify-end gap-2 -mb-1">
          <span className="text-[11px] text-muted-foreground mr-auto">Use arrow keys ← ↑ → ↓ (or the buttons) to scroll the table.</span>
          <Button variant="outline" size="icon" className="h-7 w-7 rounded-button border-border" onClick={() => scrollBy(-320)} aria-label="Scroll left">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7 rounded-button border-border" onClick={() => scrollBy(320)} aria-label="Scroll right">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Invoice table (own scroll box; ← / → scroll it sideways — see window key handler) */}
        <div
          ref={scrollRef}
          className="rounded-card border border-border overflow-auto max-h-[55vh]"
        >
          <table className="w-full caption-bottom text-sm">
            <TableHeader>
              <TableRow className="bg-muted sticky top-0 z-10">
                {visibleDefs.map((d) => (
                  <TableHead
                    key={d.key}
                    className={`text-xs font-semibold text-foreground/70 cursor-pointer select-none whitespace-nowrap ${d.align === "right" ? "text-right" : ""}`}
                    onClick={() => toggleSort(d.key)}
                  >
                    <span className={`inline-flex items-center gap-1 ${d.align === "right" ? "justify-end w-full" : ""}`}>
                      {d.label}{sortIcon(d.key)}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
              {/* Pinned totals row — part of the sticky header block (no seam with the body) */}
              {sorted.length > 0 && (
                <TableRow className="bg-muted sticky top-12 z-[9] font-semibold border-b-2 border-border/60 hover:bg-muted">
                  {visibleDefs.map((d, idx) => renderTotalCell(d.key, idx))}
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleDefs.length} className="text-center py-10 text-muted-foreground text-sm">No invoices match these filters.</TableCell>
                </TableRow>
              ) : groupBy === "group" ? (
                // Group → Customer → Invoices (collapsed to group level by default)
                groupTree.map((g) => (
                  <Fragment key={`g:${g.key}`}>
                    {renderSummaryRow(`g:${g.key}`, g.label, undefined, g.ledgers.length, "ledgers", g, 0, isOpen(g.key), () => toggle(g.key))}
                    {isOpen(g.key) && g.ledgers.map((c) => {
                      const ck = `${g.key}|${c.key}`;
                      const invCount = c.rows.filter((r) => !r.isAdjustment).length;
                      return (
                        <Fragment key={`c:${ck}`}>
                          {renderSummaryRow(`c:${ck}`, c.label, c.sub, invCount, "invoices", c, 1, isOpen(ck), () => toggle(ck))}
                          {isOpen(ck) && c.rows.map((r, i) => renderInvoiceRow(r, `${ck}|${r.number}|${r.billRefName}|${i}`, "[&>td:first-child]:pl-16"))}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))
              ) : (
                // Ledger → Invoices (open by default)
                customerTree.map((c) => {
                  const invCount = c.rows.filter((r) => !r.isAdjustment).length;
                  return (
                    <Fragment key={`c:${c.key}`}>
                      {renderSummaryRow(`c:${c.key}`, c.label, c.sub, invCount, "invoices", c, 0, isOpen(c.key), () => toggle(c.key))}
                      {isOpen(c.key) && c.rows.map((r, i) => renderInvoiceRow(r, `${c.key}|${r.number}|${r.billRefName}|${i}`, "[&>td:first-child]:pl-10"))}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Bill-level open invoices (as on {formatDateDMY(asOfDate)}). Where a ledger carries advances / on-account / credit notes not tied to a specific bill, a reconciliation line nets the bills down to the report's figure — so each ledger, group and total matches the base report.
        </p>
      </DialogContent>
    </Dialog>
  );
}
