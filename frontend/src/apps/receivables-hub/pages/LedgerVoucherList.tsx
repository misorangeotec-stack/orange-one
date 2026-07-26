/**
 * Ledger Vouchers — the ledger list (screen 1). Every ledger across the loaded companies, with a
 * company filter, a Tally-group filter, and search. Click a ledger to open its full voucher
 * statement, exactly as Tally's "Ledger Vouchers" drill works.
 *
 * Live (Tally) only: the underlying voucher data exists only in the ConnectWave mirror, so on the
 * default pipeline this shows a "Not applicable" panel (same pattern as TopExposureReport). Mirrors
 * Ledger Outstandings' list scaffolding (filter bar + FilterChips + hand-rolled 25/page pagination).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Download, Lock, ScrollText, Search } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@hub/components/ui/pagination";
import { MultiSelectFilter } from "@hub/components/MultiSelectFilter";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { fmtAmount } from "@hub/components/StatementTree";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { useReceivablesSource } from "@hub/lib/sourceContext";
import { loadLedgerList, loadLedgerMeta, type LedgerListRow } from "@hub/lib/ledgerOutstanding";
import { loadLedgerVouchers, buildLedgerStatement, periodLabelFor } from "@hub/lib/ledgerVouchers";
import { exportLedgerVouchersMultiXlsx, type LedgerBlock } from "@hub/lib/exportFinancialStatements";

const BASE = "/outstanding-dashboard";
const PAGE_SIZE = 25;

/** Dr-positive amount → "<n> Dr"/"<n> Cr", blank at zero. */
function drcr(n: number): string {
  if (Math.abs(n) < 0.5) return "";
  return `${fmtAmount(Math.abs(n))} ${n >= 0 ? "Dr" : "Cr"}`;
}

function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const lo = Math.max(2, current - 1);
  const hi = Math.min(total - 1, current + 1);
  if (lo > 2) out.push("…");
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < total - 1) out.push("…");
  out.push(total);
  return out;
}

export default function LedgerVoucherList() {
  const source = useReceivablesSource();
  const live = source === "connectwave";

  const { companies } = useFinancialStatements();
  const guids = useMemo(() => companies.map((c) => c.companyGuid).sort(), [companies]);

  const { data: ledgers, isLoading, error } = useQuery<LedgerListRow[]>({
    queryKey: ["ledgerList", "v1", guids],
    queryFn: () => loadLedgerList(guids),
    enabled: live && guids.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const all = ledgers ?? [];

  // Friendly company name per guid, for display and the company filter.
  const companyName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies) m.set(c.companyGuid, companyLabel(c));
    return (guid: string) => m.get(guid) ?? guid;
  }, [companies]);

  const [search, setSearch] = useState("");
  const [companyFilters, setCompanyFilters] = useState<string[]>([]);
  const [groupFilters, setGroupFilters] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: c.companyGuid, label: companyLabel(c) })),
    [companies],
  );
  // Every group a ledger sits under — top-level AND sub-groups — so you can filter by "Sundry Debtors"
  // (a sub-group) not just "Current Assets" (its primary group).
  const groupOptions = useMemo(() => {
    const topOf = new Map<string, string>();
    for (const l of all) {
      const top = l.groupChain[l.groupChain.length - 1];
      for (const g of l.groupChain) if (!topOf.has(g)) topOf.set(g, top ?? g);
    }
    return [...topOf.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((g) => ({ value: g, label: g === topOf.get(g) ? g : `${g} · ${topOf.get(g)}` }));
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((l) => companyFilters.length === 0 || companyFilters.includes(l.companyGuid))
      .filter((l) => groupFilters.length === 0 || l.groupChain.some((g) => groupFilters.includes(g)))
      .filter((l) => !q || l.ledger.toLowerCase().includes(q))
      .sort((a, b) => a.ledger.localeCompare(b.ledger));
  }, [all, search, companyFilters, groupFilters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const chips: FilterChip[] = [
    ...companyFilters.map((g) => ({ label: companyName(g), onRemove: () => setCompanyFilters((v) => v.filter((x) => x !== g)) })),
    ...groupFilters.map((g) => ({ label: g, onRemove: () => setGroupFilters((v) => v.filter((x) => x !== g)) })),
  ];
  const clearAll = () => { setCompanyFilters([]); setGroupFilters([]); setSearch(""); setPage(1); };
  const onFilterChange = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };

  // ── Multi-ledger selection + bulk export ──────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set()); // by ledger guid
  const [from, setFrom] = useState(""); // yyyy-mm-dd, export window (blank = full history)
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);

  const byGuid = useMemo(() => {
    const m = new Map<string, LedgerListRow>();
    for (const l of all) m.set(l.guid, l);
    return m;
  }, [all]);
  const companyOf = (companyGuid: string) => companies.find((c) => c.companyGuid === companyGuid);

  // Select all operates on the FULL filtered set (every page), not just the visible slice.
  const filteredGuids = useMemo(() => filtered.map((l) => l.guid), [filtered]);
  const selectedInFiltered = useMemo(
    () => filteredGuids.reduce((n, g) => n + (selected.has(g) ? 1 : 0), 0),
    [filteredGuids, selected],
  );
  const allFilteredSelected = filteredGuids.length > 0 && selectedInFiltered === filteredGuids.length;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedInFiltered > 0 && !allFilteredSelected;
  }, [selectedInFiltered, allFilteredSelected]);

  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allFilteredSelected) filteredGuids.forEach((g) => next.delete(g));
    else filteredGuids.forEach((g) => next.add(g));
    return next;
  });
  const toggleOne = (g: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(g)) next.delete(g); else next.add(g);
    return next;
  });
  const clearSelection = () => setSelected(new Set());

  async function handleExport() {
    const guids = [...selected].filter((g) => byGuid.has(g));
    if (!guids.length || exporting) return;
    if (guids.length > 50 &&
      !window.confirm(`Export ${guids.length} ledgers? Each is fetched from Tally one at a time, so this can take a minute or two.`)) return;

    const fromYmd = from ? from.replace(/-/g, "") : "";
    const toYmd = to ? to.replace(/-/g, "") : "";
    const blocks: LedgerBlock[] = [];
    const skipped: string[] = [];
    setExporting({ done: 0, total: guids.length });
    // Strictly sequential: each ledger is a per-book RPC under a 3s anon timeout, and fetchQuery
    // shares/warms the same cache the single-ledger statement screen uses.
    for (let i = 0; i < guids.length; i++) {
      const row = byGuid.get(guids[i])!;
      try {
        const meta = await queryClient.fetchQuery({
          queryKey: ["ledgerMeta", row.tenantId, row.guid],
          queryFn: () => loadLedgerMeta(row.tenantId, row.guid),
          staleTime: 5 * 60 * 1000,
        });
        const rows = await queryClient.fetchQuery({
          queryKey: ["ledgerVouchers", row.tenantId, row.guid],
          queryFn: () => loadLedgerVouchers(row.tenantId, row.guid),
          staleTime: 5 * 60 * 1000,
        });
        const company = companyOf(row.companyGuid);
        const st = buildLedgerStatement(meta?.opening ?? 0, rows, fromYmd, toYmd);
        blocks.push({
          ledgerName: row.ledger,
          company,
          periodLabel: periodLabelFor(fromYmd, toYmd, company),
          opening: st.openingAsOf,
          closing: st.closingComputed,
          rows: st.withBalance,
        });
      } catch (e) {
        console.warn("[LedgerVoucherList] export skipped:", row.ledger, e);
        skipped.push(row.ledger);
      }
      setExporting({ done: i + 1, total: guids.length });
    }
    setExporting(null);
    if (blocks.length) exportLedgerVouchersMultiXlsx(blocks);
    if (skipped.length) {
      window.alert(`Exported ${blocks.length} of ${guids.length} ledgers.\nSkipped (Tally fetch failed): ${skipped.join(", ")}`);
    }
  }

  // Live (Tally) only — the default pipeline has no voucher-level data.
  if (!live) {
    return (
      <div className="p-6 max-w-[900px] mx-auto space-y-4">
        <Link to={`${BASE}/reports?cat=tally`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Tally Reports
        </Link>
        <Card className="rounded-card border-border bg-surface">
          <CardContent className="p-10 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-primary" /> Ledger Vouchers
            </h1>
            <p className="text-sm text-muted-foreground max-w-md">
              This report reads each ledger's live Tally vouchers, so it is only available on the{" "}
              <strong>Live (Tally)</strong> view. Switch on <strong>Live (Tally)</strong> in the top bar to use it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div>
        <Link to={`${BASE}/reports?cat=tally`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
          Tally Reports
        </Link>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-primary" /> Ledger Vouchers
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick a ledger to see its full voucher statement with a running balance, exactly as Tally shows it.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search ledgers…"
            className="pl-9 h-9 w-64 rounded-input"
          />
        </div>
        {companyOptions.length > 1 && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Company</span>
            <MultiSelectFilter
              options={companyOptions}
              value={companyFilters}
              onChange={onFilterChange(setCompanyFilters)}
              allLabel="All Companies"
              unit="Companies"
              triggerClassName="w-[190px] h-9 text-sm rounded-input border-border"
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Group</span>
          <MultiSelectFilter
            options={groupOptions}
            value={groupFilters}
            onChange={onFilterChange(setGroupFilters)}
            allLabel="All Groups"
            unit="Groups"
            triggerClassName="w-[190px] h-9 text-sm rounded-input border-border"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Export period</span>
          <div className="flex items-center gap-1">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[150px] rounded-input text-sm" />
            <span className="text-muted-foreground text-xs">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px] rounded-input text-sm" />
          </div>
        </div>
      </div>
      {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearAll} />}

      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading ledgers…</div>
      ) : error ? (
        <div className="py-16 text-center text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {filtered.length.toLocaleString("en-IN")} ledger{filtered.length === 1 ? "" : "s"}
              {selected.size > 0 && (
                <span className="ml-2 text-foreground font-medium">· {selected.size} selected</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selected.size > 0 && !exporting && (
                <button onClick={clearSelection} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
                  Clear selection
                </button>
              )}
              {exporting && (
                <span className="text-xs text-muted-foreground tabular-nums">Fetching {exporting.done} / {exporting.total}…</span>
              )}
              <Button
                onClick={handleExport}
                disabled={selected.size === 0 || !!exporting}
                className="h-9 gap-1.5 rounded-button bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Download className="h-4 w-4" /> Export {selected.size > 0 ? `${selected.size} ledger${selected.size === 1 ? "" : "s"}` : "ledgers"}
              </Button>
            </div>
          </div>
          <ScrollableTable className="rounded-lg border border-border" maxHeight="max-h-[64vh]">
            <table className="w-full border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b-2 border-border bg-muted/50">
                  <th className="w-8 py-2 px-3 text-left">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                      aria-label="Select all ledgers"
                      className="h-4 w-4 cursor-pointer align-middle"
                    />
                  </th>
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ledger</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Group</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Closing</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No ledgers match those filters.</td></tr>
                ) : (
                  shown.map((l) => (
                    <tr key={`${l.companyGuid}-${l.guid}`} className="border-b border-border/40 hover:bg-muted/40">
                      <td className="py-1.5 px-3">
                        <input
                          type="checkbox"
                          checked={selected.has(l.guid)}
                          onChange={() => toggleOne(l.guid)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${l.ledger}`}
                          className="h-4 w-4 cursor-pointer align-middle"
                        />
                      </td>
                      <td className="py-1.5 px-3 text-sm">
                        <Link to={`${BASE}/reports/ledger-voucher/${l.guid}`} className="text-foreground hover:text-primary font-medium">
                          {l.ledger}
                        </Link>
                      </td>
                      <td className="py-1.5 px-3 text-sm text-muted-foreground whitespace-nowrap">{l.subGroup ?? l.grouping ?? "—"}</td>
                      <td className="py-1.5 px-3 text-sm text-muted-foreground whitespace-nowrap">{companyName(l.companyGuid)}</td>
                      <td className="py-1.5 px-3 text-right text-sm tabular-nums whitespace-nowrap">{drcr(l.closing)}</td>
                      <td className="py-1.5 px-2 text-right">
                        <Link to={`${BASE}/reports/ledger-voucher/${l.guid}`}>
                          <ChevronRight className="h-4 w-4 text-muted-foreground inline" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>

          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className={current === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {pageWindow(current, totalPages).map((p, i) => (
                  <PaginationItem key={i}>
                    {p === "…" ? (
                      <span className="px-2 text-muted-foreground">…</span>
                    ) : (
                      <PaginationLink isActive={p === current} onClick={() => setPage(p)} className="cursor-pointer">
                        {p}
                      </PaginationLink>
                    )}
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className={current === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}
    </div>
  );
}
