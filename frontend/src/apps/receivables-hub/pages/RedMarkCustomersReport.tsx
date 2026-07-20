import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";
import {
  ShieldAlert, Download, Search, ArrowUpDown, ArrowUp, ArrowDown, FileText,
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
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from "@hub/components/ui/pagination";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { CustomerCategoryMultiSelect, matchesCategory } from "@hub/components/CustomerCategoryMultiSelect";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { useFY } from "@hub/lib/fyContext";
import { fetchRedMarkRows } from "@hub/lib/musterApi";
import { HEADER_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";

/* ── Helpers ───────────────────────────────────────────────── */

const fmt = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000)   return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, "all"] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

interface RmRow {
  id: string;
  customer: string;
  salesPerson: string;
  category: string;
  categories?: string[];
  company: string;
  location: string;
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
  reason: string;
}

type SortKey = "customer" | "salesPerson" | "outstanding" | "overdue" | "maxOverdueDays";

/* ── Page ──────────────────────────────────────────────────── */

export default function RedMarkCustomersReport() {
  const { loading, error, allCustomers, salesPersonOptions } = useAppData();
  const { label: fyLabel } = useFY();

  // Optional `reason` from the ext_redmark master, joined by Tally GUID (= Customer.id on Live).
  const [reasonByGuid, setReasonByGuid] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    fetchRedMarkRows()
      .then((rows) => { if (alive) setReasonByGuid(new Map(rows.map((r) => [r.ledger_id, r.reason ?? ""]))); })
      .catch(() => { /* reason is a nice-to-have; ignore if the master is unreachable */ });
    return () => { alive = false; };
  }, []);

  const [search, setSearch] = useState("");
  const [salesPersons, setSalesPersons] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("outstanding");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);

  // Every Red Mark customer. `blocked` carries the Red Mark flag; allCustomers is already
  // salesperson-scoped by useAppData.
  const allRows = useMemo<RmRow[]>(() => {
    return allCustomers
      .filter((c) => c.blocked)
      .map((c) => ({
        id: c.id,
        customer: c.name,
        salesPerson: c.salesPerson || "—",
        category: c.category || "",
        company: c.company,
        location: c.location,
        outstanding: c.outstanding,
        overdue: c.overdue,
        maxOverdueDays: c.maxOverdueDays,
        reason: reasonByGuid.get(c.id) ?? "",
      }));
  }, [allCustomers, reasonByGuid]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const spSet = new Set(salesPersons);
    const rows = allRows.filter((r) => {
      if (spSet.size > 0 && !spSet.has(r.salesPerson)) return false;
      if (!matchesCategory(r, categories)) return false;
      if (q && !(r.customer.toLowerCase().includes(q) || r.salesPerson.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q))) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortKey) {
        case "outstanding": av = a.outstanding; bv = b.outstanding; break;
        case "overdue": av = a.overdue; bv = b.overdue; break;
        case "maxOverdueDays": av = a.maxOverdueDays; bv = b.maxOverdueDays; break;
        case "salesPerson": av = a.salesPerson; bv = b.salesPerson; break;
        default: av = a.customer; bv = b.customer;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return rows;
  }, [allRows, search, salesPersons, categories, sortKey, sortDir]);

  // Summary
  const totalOutstanding = filteredRows.reduce((s, r) => s + r.outstanding, 0);
  const totalOverdue = filteredRows.reduce((s, r) => s + r.overdue, 0);

  // Pagination
  const effectivePageSize = pageSize === "all" ? Math.max(1, filteredRows.length) : pageSize;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / effectivePageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = pageSize === "all"
    ? filteredRows
    : filteredRows.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);
  const rangeStart = filteredRows.length === 0 ? 0 : (safePage - 1) * effectivePageSize + 1;
  const rangeEnd = Math.min(safePage * effectivePageSize, filteredRows.length);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "customer" || k === "salesPerson" ? "asc" : "desc"); }
    setCurrentPage(1);
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? <ArrowUpDown className="h-3 w-3 inline opacity-40" />
    : sortDir === "asc" ? <ArrowUp className="h-3 w-3 inline" />
    : <ArrowDown className="h-3 w-3 inline" />;

  const exportXlsx = () => {
    const header = ["Customer", "Sales Person", "Company", "Location", "Category", "Outstanding", "Overdue", "Max OD Days", "Reason"];
    const aoa: (string | number)[][] = [
      [`Red Mark Customers — ${fyLabel}`],
      [],
      header,
      ...filteredRows.map((r) => [
        r.customer, r.salesPerson, r.company, r.location, r.category,
        Math.round(r.outstanding), Math.round(r.overdue), r.maxOverdueDays, r.reason,
      ]),
      ["", "", "", "", "Total", Math.round(totalOutstanding), Math.round(totalOverdue), "", ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 34 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 40 }];
    styleRow(ws, 0, header.length, HEADER_STYLE);          // title
    styleRow(ws, 2, header.length, HEADER_STYLE);          // column header
    styleRow(ws, aoa.length - 1, header.length, GRAND_TOTAL_STYLE);  // grand total
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Red Mark Customers");
    XLSX.writeFile(wb, `red-mark-customers-${fyLabel.replace(/\s+/g, "")}.xlsx`);
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading Red Mark customers…</div>;
  }
  if (error) {
    return <div className="p-6 text-sm text-destructive">Failed to load: {error}</div>;
  }

  return (
    <div className="p-6 space-y-5 max-w-[1280px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-destructive" /> Red Mark Customers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customers hand-flagged as Red Mark (managed in Masters → Red Mark on the Live/Tally view), with their live outstanding and overdue. ({fyLabel})
          </p>
        </div>
        <Button onClick={exportXlsx} disabled={filteredRows.length === 0} className="rounded-button gap-2">
          <Download className="h-4 w-4" /> Export Excel
        </Button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Red Mark Customers", value: String(filteredRows.length), sub: "flagged" },
          { label: "Total Outstanding", value: fmt(totalOutstanding), sub: "across flagged customers" },
          { label: "Total Overdue", value: fmt(totalOverdue), sub: "across flagged customers" },
        ].map((s) => (
          <Card key={s.label} className="rounded-card border-border bg-surface">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-lg font-bold text-foreground mt-1">{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search customer / salesperson / reason"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            className="pl-8 w-64 h-9 rounded-input text-sm"
          />
        </div>
        <SalesPersonMultiSelect options={salesPersonOptions} value={salesPersons} onChange={(v) => { setSalesPersons(v); setCurrentPage(1); }} />
        <CustomerCategoryMultiSelect value={categories} onChange={(v) => { setCategories(v); setCurrentPage(1); }} triggerClassName="w-44 h-9 text-sm rounded-input" />
      </div>

      {/* Table */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-0">
          {filteredRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <FileText className="h-8 w-8 opacity-40" />
              No Red Mark customers match the current filters.
            </div>
          ) : (
            <ScrollableTable>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs cursor-pointer" onClick={() => toggleSort("customer")}>Customer <SortIcon k="customer" /></TableHead>
                    <TableHead className="text-xs cursor-pointer" onClick={() => toggleSort("salesPerson")}>Sales Person <SortIcon k="salesPerson" /></TableHead>
                    <TableHead className="text-xs">Company</TableHead>
                    <TableHead className="text-xs">Location</TableHead>
                    <TableHead className="text-xs">Category</TableHead>
                    <TableHead className="text-xs text-right cursor-pointer" onClick={() => toggleSort("outstanding")}>Outstanding <SortIcon k="outstanding" /></TableHead>
                    <TableHead className="text-xs text-right cursor-pointer" onClick={() => toggleSort("overdue")}>Overdue <SortIcon k="overdue" /></TableHead>
                    <TableHead className="text-xs text-right cursor-pointer" onClick={() => toggleSort("maxOverdueDays")}>Max OD <SortIcon k="maxOverdueDays" /></TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRows.map((r, i) => (
                    <TableRow key={`${r.id}-${i}`} className="hover:bg-muted/20">
                      <TableCell className="text-xs font-medium">{r.customer}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.salesPerson}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.company}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.location}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.category || "—"}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-semibold">{fmt(r.outstanding)}</TableCell>
                      <TableCell className={`text-xs text-right font-mono ${r.overdue > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{fmt(r.overdue)}</TableCell>
                      <TableCell className="text-xs text-right font-mono text-muted-foreground">{r.maxOverdueDays > 0 ? r.maxOverdueDays : "—"}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground max-w-[280px] truncate" title={r.reason}>{r.reason || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {/* Grand total */}
                  <TableRow className="bg-muted/50 font-semibold border-t border-border">
                    <TableCell className="text-xs font-bold" colSpan={5}>Total ({filteredRows.length} customer{filteredRows.length === 1 ? "" : "s"})</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{fmt(totalOutstanding)}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold text-destructive">{fmt(totalOverdue)}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableBody>
              </Table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {filteredRows.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(v === "all" ? "all" : Number(v) as PageSize); setCurrentPage(1); }}>
              <SelectTrigger className="w-[90px] h-8 rounded-input border-border text-sm"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-input">
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <SelectItem key={String(opt)} value={String(opt)}>{opt === "all" ? "All" : opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{rangeStart}–{rangeEnd} of {filteredRows.length}</span>
          </div>
          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    aria-disabled={safePage === 1}
                    className={safePage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {getPageWindow(safePage, totalPages).map((p, i) =>
                  p === "..." ? (
                    <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink isActive={p === safePage} onClick={() => setCurrentPage(p)} className="cursor-pointer">{p}</PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    aria-disabled={safePage === totalPages}
                    className={safePage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </div>
  );
}
