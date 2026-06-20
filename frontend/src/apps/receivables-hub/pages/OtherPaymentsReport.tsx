import { useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";
import {
  HandCoins, Download, Search, ArrowUpDown, ArrowUp, ArrowDown, FileText,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { Badge } from "@hub/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from "@hub/components/ui/pagination";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { CustomerCategoryMultiSelect, matchesCategory } from "@hub/components/CustomerCategoryMultiSelect";
import { MultiSelect } from "@hub/components/MultiSelect";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { useFY } from "@hub/lib/fyContext";
import { formatDateDMY } from "@hub/lib/utils";
import { HEADER_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";

/* ── Helpers ───────────────────────────────────────────────── */

const fmt = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000)   return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

/** Pipeline stores the normalized allocation ("AGST REF" / "ON ACCOUNT"). */
function allocLabel(type: string): "Against Invoice" | "On Account" {
  return type.toUpperCase().includes("AGST") ? "Against Invoice" : "On Account";
}

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

interface OpRow {
  date: string;          // ISO
  customer: string;
  salesPerson: string;
  category: string;
  categories?: string[];
  company: string;
  location: string;
  alloc: "Against Invoice" | "On Account";
  refInvoice: string;
  paymentRef: string;
  amount: number;
  remark: string;
}

type SortKey = "date" | "customer" | "salesPerson" | "alloc" | "amount";

/* ── Page ──────────────────────────────────────────────────── */

export default function OtherPaymentsReport() {
  const { loading, error, allCustomers, customerDetail, salesPersonOptions } = useAppData();
  const { label: fyLabel } = useFY();

  const [search, setSearch] = useState("");
  const [salesPersons, setSalesPersons] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [allocFilter, setAllocFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);

  // Flatten every customer's other-payment transactions into report rows.
  // allCustomers + customerDetail are already salesperson-scoped by useAppData.
  const allRows = useMemo<OpRow[]>(() => {
    const rows: OpRow[] = [];
    for (const c of allCustomers) {
      const txns = customerDetail[c.id]?.otherPaymentTransactions ?? [];
      for (const t of txns) {
        rows.push({
          date: t.date ?? "",
          customer: c.name,
          salesPerson: c.salesPerson || "—",
          category: c.category || "",
          company: c.company,
          location: c.location,
          alloc: allocLabel(t.type),
          refInvoice: t.refInvoice ?? "",
          paymentRef: t.paymentRef ?? "",
          amount: t.amount,
          remark: t.remark ?? "",
        });
      }
    }
    return rows;
  }, [allCustomers, customerDetail]);

  const allocOptions = ["Against Invoice", "On Account"];

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const spSet = new Set(salesPersons);
    const alSet = new Set(allocFilter);
    const rows = allRows.filter((r) => {
      if (spSet.size > 0 && !spSet.has(r.salesPerson)) return false;
      if (!matchesCategory(r, categories)) return false;
      if (alSet.size > 0 && !alSet.has(r.alloc)) return false;
      if (q && !(r.customer.toLowerCase().includes(q) || r.refInvoice.toLowerCase().includes(q) || r.paymentRef.toLowerCase().includes(q) || r.remark.toLowerCase().includes(q))) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortKey) {
        case "amount": av = a.amount; bv = b.amount; break;
        case "customer": av = a.customer; bv = b.customer; break;
        case "salesPerson": av = a.salesPerson; bv = b.salesPerson; break;
        case "alloc": av = a.alloc; bv = b.alloc; break;
        default: av = a.date; bv = b.date;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return rows;
  }, [allRows, search, salesPersons, categories, allocFilter, sortKey, sortDir]);

  // Summary
  const totalAmt = filteredRows.reduce((s, r) => s + r.amount, 0);
  const againstAmt = filteredRows.filter((r) => r.alloc === "Against Invoice").reduce((s, r) => s + r.amount, 0);
  const onAcctAmt = filteredRows.filter((r) => r.alloc === "On Account").reduce((s, r) => s + r.amount, 0);
  const customerCount = new Set(filteredRows.map((r) => r.customer)).size;

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
    else { setSortKey(k); setSortDir(k === "amount" || k === "date" ? "desc" : "asc"); }
    setCurrentPage(1);
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? <ArrowUpDown className="h-3 w-3 inline opacity-40" />
    : sortDir === "asc" ? <ArrowUp className="h-3 w-3 inline" />
    : <ArrowDown className="h-3 w-3 inline" />;

  const exportXlsx = () => {
    const header = ["Date", "Customer", "Sales Person", "Company", "Location", "Allocation", "Ref Invoice", "Payment Ref", "Amount", "Remarks"];
    const aoa: (string | number)[][] = [
      [`Other Payments Report — ${fyLabel}`],
      [],
      header,
      ...filteredRows.map((r) => [
        formatDateDMY(r.date), r.customer, r.salesPerson, r.company, r.location,
        r.alloc, r.refInvoice, r.paymentRef, Math.round(r.amount), r.remark,
      ]),
      ["", "", "", "", "", "", "", "Total", Math.round(totalAmt), ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 34 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 15 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 60 }];
    styleRow(ws, 0, header.length, HEADER_STYLE);          // title
    styleRow(ws, 2, header.length, HEADER_STYLE);          // column header
    styleRow(ws, aoa.length - 1, header.length, GRAND_TOTAL_STYLE);  // grand total
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Other Payments");
    XLSX.writeFile(wb, `other-payments-${fyLabel.replace(/\s+/g, "")}.xlsx`);
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading other payments…</div>;
  }
  if (error) {
    return <div className="p-6 text-sm text-destructive">Failed to load: {error}</div>;
  }

  return (
    <div className="p-6 space-y-5 max-w-[1280px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <HandCoins className="h-6 w-6 text-primary" /> Other Payments Report
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manual (non-Tally) payments recorded against invoices or on account. These reduce outstanding and are tracked separately from standard receipts. ({fyLabel})
          </p>
        </div>
        <Button onClick={exportXlsx} disabled={filteredRows.length === 0} className="rounded-button gap-2">
          <Download className="h-4 w-4" /> Export Excel
        </Button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Other Payments", value: fmt(totalAmt), sub: `${filteredRows.length} entr${filteredRows.length === 1 ? "y" : "ies"}` },
          { label: "Against Invoice", value: fmt(againstAmt), sub: `${filteredRows.filter((r) => r.alloc === "Against Invoice").length} entries` },
          { label: "On Account", value: fmt(onAcctAmt), sub: `${filteredRows.filter((r) => r.alloc === "On Account").length} entries` },
          { label: "Customers", value: String(customerCount), sub: "with other payments" },
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
            placeholder="Search customer / invoice / ref"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            className="pl-8 w-64 h-9 rounded-input text-sm"
          />
        </div>
        <SalesPersonMultiSelect options={salesPersonOptions} value={salesPersons} onChange={(v) => { setSalesPersons(v); setCurrentPage(1); }} />
        <CustomerCategoryMultiSelect value={categories} onChange={(v) => { setCategories(v); setCurrentPage(1); }} triggerClassName="w-44 h-9 text-sm rounded-input" />
        <MultiSelect options={allocOptions} value={allocFilter} onChange={(v) => { setAllocFilter(v); setCurrentPage(1); }} allLabel="All Allocations" noun="Types" triggerClassName="w-44 h-9 text-sm rounded-input" />
      </div>

      {/* Table */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-0">
          {filteredRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <FileText className="h-8 w-8 opacity-40" />
              No other payments match the current filters.
            </div>
          ) : (
            <ScrollableTable>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs cursor-pointer" onClick={() => toggleSort("date")}>Date <SortIcon k="date" /></TableHead>
                    <TableHead className="text-xs cursor-pointer" onClick={() => toggleSort("customer")}>Customer <SortIcon k="customer" /></TableHead>
                    <TableHead className="text-xs cursor-pointer" onClick={() => toggleSort("salesPerson")}>Sales Person <SortIcon k="salesPerson" /></TableHead>
                    <TableHead className="text-xs">Company</TableHead>
                    <TableHead className="text-xs">Location</TableHead>
                    <TableHead className="text-xs cursor-pointer" onClick={() => toggleSort("alloc")}>Allocation <SortIcon k="alloc" /></TableHead>
                    <TableHead className="text-xs">Ref Invoice</TableHead>
                    <TableHead className="text-xs">Pmt Ref</TableHead>
                    <TableHead className="text-xs text-right cursor-pointer" onClick={() => toggleSort("amount")}>Amount <SortIcon k="amount" /></TableHead>
                    <TableHead className="text-xs">Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRows.map((r, i) => (
                    <TableRow key={`${r.customer}-${r.date}-${r.refInvoice}-${i}`} className="hover:bg-muted/20">
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDateDMY(r.date)}</TableCell>
                      <TableCell className="text-xs font-medium">{r.customer}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.salesPerson}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.company}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.location}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${r.alloc === "Against Invoice" ? "bg-indigo-100 text-indigo-700 border-indigo-200" : "bg-amber-100 text-amber-700 border-amber-200"}`}>
                          {r.alloc}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground max-w-[180px] truncate" title={r.refInvoice}>{r.refInvoice || "—"}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{r.paymentRef || "—"}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-semibold text-indigo-700">{fmt(r.amount)}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground max-w-[320px]" title={r.remark}>{r.remark || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {/* Grand total */}
                  <TableRow className="bg-muted/50 font-semibold border-t border-border">
                    <TableCell className="text-xs font-bold" colSpan={8}>Total ({filteredRows.length} entr{filteredRows.length === 1 ? "y" : "ies"})</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold text-indigo-700">{fmt(totalAmt)}</TableCell>
                    <TableCell />
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
