/**
 * The module's list table: search, sort, 25/page, optional Excel export.
 *
 * Hub-native by design. shared/components/ui/QueueTable has richer per-column
 * filters, but it is styled with Orange One's portal tokens which .hub-root does
 * not remap — it would render orange-and-navy inside a shadcn card. This ports
 * the useful behaviour and keeps the hub's visual contract.
 *
 * Pagination is 25/page, the house rule across Orange One.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpDown, ArrowUp, ArrowDown, Download, Search } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationPrevious, PaginationNext,
} from "@hub/components/ui/pagination";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { cn } from "@hub/lib/utils";

export interface RequestColumn<T> {
  key: string;
  header: string;
  /** What renders in the cell. */
  cell: (row: T) => ReactNode;
  /** Sort/search/export value. Omit to make the column non-sortable. */
  value?: (row: T) => string | number | null;
  className?: string;
  align?: "left" | "right";
}

const PAGE_SIZE = 25;

export default function RequestTable<T extends { id: string }>({
  rows, columns, rowHref, empty, exportName, searchPlaceholder = "Search…", toolbar,
}: {
  rows: T[];
  columns: RequestColumn<T>[];
  /** Clicking a row navigates here. Omit for a non-interactive table. */
  rowHref?: (row: T) => string;
  empty: ReactNode;
  /** Enables the Excel button; exports exactly what is on screen, filtered and sorted. */
  exportName?: string;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const valueOf = (row: T, key: string) => {
    const col = columns.find((c) => c.key === key);
    return col?.value ? col.value(row) : null;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      columns.some((c) => {
        const v = c.value ? c.value(r) : null;
        return v !== null && String(v).toLowerCase().includes(q);
      }),
    );
  }, [rows, columns, search]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = valueOf(a, sortKey);
      const bv = valueOf(b, sortKey);
      // Blanks always sink, whichever way the column is sorted — a column of
      // dashes floating to the top tells the reader nothing.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageRows = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  };

  /** Exports the CURRENT view — same rows, same order the reader is looking at. */
  const exportXlsx = () => {
    const head = columns.map((c) => c.header);
    const body = sorted.map((r) => columns.map((c) => (c.value ? (c.value(r) ?? "") : "")));
    const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
    ws["!cols"] = head.map((h, i) => ({
      wch: Math.min(46, Math.max(12, h.length + 2,
        ...body.slice(0, 200).map((row) => String(row[i] ?? "").length + 2))),
    }));
    for (let i = 0; i < head.length; i += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: i })];
      if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: "FFF1F5F9" } } };
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    XLSX.writeFile(wb, `${exportName}.xlsx`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={searchPlaceholder}
            className="pl-8"
          />
        </div>
        {toolbar}
        {exportName && sorted.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportXlsx} className="gap-2">
            <Download className="h-4 w-4" /> Excel
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      ) : (
        <>
          <ScrollableTable>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead
                      key={c.key}
                      className={cn(c.align === "right" && "text-right", c.className)}
                    >
                      {c.value ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {c.header}
                          {sortKey === c.key
                            ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                            : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      ) : c.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow
                    key={r.id}
                    className={rowHref ? "cursor-pointer" : undefined}
                    onClick={rowHref ? () => navigate(rowHref(r)) : undefined}
                  >
                    {columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={cn(c.align === "right" && "text-right tabular-nums", c.className)}
                      >
                        {c.cell(r)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollableTable>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {sorted.length} request{sorted.length === 1 ? "" : "s"}
              {search.trim() && ` matching “${search.trim()}”`}
            </p>
            {totalPages > 1 && (
              <Pagination className="mx-0 w-auto">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => { e.preventDefault(); setPage((p) => Math.max(1, p - 1)); }}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - current) <= 1)
                    .map((p, i, arr) => (
                      <PaginationItem key={p}>
                        {i > 0 && arr[i - 1] !== p - 1 && <span className="px-1 text-muted-foreground">…</span>}
                        <PaginationLink
                          href="#"
                          isActive={p === current}
                          onClick={(e) => { e.preventDefault(); setPage(p); }}
                        >
                          {p}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => { e.preventDefault(); setPage((p) => Math.min(totalPages, p + 1)); }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        </>
      )}
    </div>
  );
}
