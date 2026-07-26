/**
 * Sales Register — Tally Reports → Books & Registers.
 *
 * A flat, all-companies voucher-line register in the finance team's "Append1" layout. Reads the
 * precomputed ConnectWave `rpt_sales_register` snapshot (rebuilt nightly at 20:00 IST + on-demand
 * per company), so it is source-agnostic (available regardless of the Live-Tally toggle), exactly
 * like the Master Reports → Sales Report.
 *
 * Data lives in lib/salesRegister.ts; the whole [from,to] window is loaded, then filtered and
 * paginated client-side (project rule: usePagination + <Pagination/>, 25/page). Export in
 * lib/exportSalesRegister.ts reproduces the source workbook.
 */
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, NotebookText, RefreshCw, Search } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import {
  loadSalesRegister, loadRegisterCompanies, loadLastRegisterRefresh, refreshRegisterCompany,
  defaultRange, ymdToIso, isoToYmd, type RegisterRow,
} from "@hub/lib/salesRegister";
import { exportSalesRegisterXlsx } from "@hub/lib/exportSalesRegister";

const BASE = "/outstanding-dashboard";

const nf = (max: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: max });
const fmtQty = (n: number) => (n === 0 ? "—" : nf(3).format(n));
const fmtRate = (n: number) => (n === 0 ? "—" : nf(2).format(n));
const fmtRev = (n: number) => nf(2).format(n);

export default function SalesRegister() {
  const qc = useQueryClient();
  const init = useMemo(() => defaultRange(), []);
  const [fromIso, setFromIso] = useState(ymdToIso(init.from));
  const [toIso, setToIso] = useState(ymdToIso(init.to));
  const from = isoToYmd(fromIso);
  const to = isoToYmd(toIso);
  const validRange = !!from && !!to && from <= to;

  const { data: rows, isLoading, error } = useQuery<RegisterRow[]>({
    queryKey: ["salesRegister", "v1", from, to],
    queryFn: () => loadSalesRegister(from, to),
    enabled: validRange,
    staleTime: 5 * 60 * 1000,
  });
  const all = useMemo(() => rows ?? [], [rows]);

  /* -------- filters -------- */
  const [companyFilters, setCompanyFilters] = useState<string[]>([]);
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const companyOptions: MultiSelectOption[] = useMemo(
    () => [...new Set(all.map((r) => r.company_label))].sort().map((v) => ({ value: v, label: v })),
    [all],
  );
  const typeOptions: MultiSelectOption[] = useMemo(
    () => [...new Set(all.map((r) => r.type))].sort().map((v) => ({ value: v, label: v })),
    [all],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (companyFilters.length && !companyFilters.includes(r.company_label)) return false;
      if (typeFilters.length && !typeFilters.includes(r.type)) return false;
      if (q && !(
        r.party.toLowerCase().includes(q) ||
        r.particulars.toLowerCase().includes(q) ||
        r.voucher_no.toLowerCase().includes(q) ||
        (r.gstin ?? "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [all, companyFilters, typeFilters, search]);

  const totalRevenue = useMemo(() => filtered.reduce((s, r) => s + r.revenue, 0), [filtered]);

  const page = usePagination(filtered, {
    resetKey: `${from}|${to}|${companyFilters.join(",")}|${typeFilters.join(",")}|${search}`,
  });

  const chips: FilterChip[] = [
    ...companyFilters.map((v) => ({ label: v, onRemove: () => setCompanyFilters((s) => s.filter((x) => x !== v)) })),
    ...typeFilters.map((v) => ({ label: v, onRemove: () => setTypeFilters((s) => s.filter((x) => x !== v)) })),
  ];
  const clearAll = () => { setCompanyFilters([]); setTypeFilters([]); setSearch(""); };

  /* -------- export -------- */
  const onExport = () => {
    if (!filtered.length) return;
    exportSalesRegisterXlsx(filtered, { from, to });
  };

  /* -------- per-company refresh -------- */
  const { data: companies } = useQuery({
    queryKey: ["salesRegisterCompanies"],
    queryFn: loadRegisterCompanies,
    staleTime: 30 * 60 * 1000,
  });
  const [refreshTenant, setRefreshTenant] = useState<string>("");
  const tenant = refreshTenant || companies?.[0]?.tenantId || "";
  const { data: lastRefresh } = useQuery({
    queryKey: ["salesRegisterLastRefresh", tenant],
    queryFn: () => loadLastRegisterRefresh(tenant),
    enabled: !!tenant,
  });

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const eta = Math.max(3, lastRefresh?.seconds ?? 8);
  const progress = busy ? Math.min(95, (elapsed / eta) * 100) : 0;

  const onRefresh = async () => {
    if (!tenant || busy) return;
    setBusy(true); setNote(null); setElapsed(0);
    timer.current = setInterval(() => setElapsed((e) => e + 0.25), 250);
    try {
      const res = await refreshRegisterCompany(tenant);
      if (res.status === "cooldown") setNote(`Just refreshed — try again in ${res.retry_after_seconds ?? 0}s.`);
      else if (res.status === "busy") setNote("A refresh is already running for this company.");
      else if (res.status === "error") setNote(res.message ?? "Refresh failed.");
      else {
        setNote(`Refreshed in ${res.seconds ?? 0}s — ${res.rows ?? 0} lines.`);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["salesRegister"] }),
          qc.invalidateQueries({ queryKey: ["salesRegisterLastRefresh", tenant] }),
        ]);
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to={`${BASE}/reports?cat=tally`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-3 w-3" /> Tally Reports
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <NotebookText className="h-6 w-6 text-primary" /> Sales Register
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every sales &amp; daybook voucher line across all companies — location, party, particulars, qty, rate and revenue, as booked.
          </p>
        </div>
        <Button
          onClick={onExport}
          disabled={!filtered.length}
          className="h-9 gap-1.5 rounded-button bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Period</span>
          <div className="flex items-center gap-1">
            <Input type="date" value={fromIso} onChange={(e) => setFromIso(e.target.value)} className="h-9 w-[150px] rounded-input text-sm" />
            <span className="text-muted-foreground text-xs">to</span>
            <Input type="date" value={toIso} onChange={(e) => setToIso(e.target.value)} className="h-9 w-[150px] rounded-input text-sm" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Company</span>
          <MultiSelectFilter
            options={companyOptions}
            value={companyFilters}
            onChange={setCompanyFilters}
            allLabel="All Companies"
            unit="Companies"
            triggerClassName="w-[200px] h-9 text-sm rounded-input border-border"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Type</span>
          <MultiSelectFilter
            options={typeOptions}
            value={typeFilters}
            onChange={setTypeFilters}
            allLabel="All Types"
            unit="Types"
            triggerClassName="w-[180px] h-9 text-sm rounded-input border-border"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Search</span>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Party, particulars, voucher no…"
              className="pl-9 h-9 w-64 rounded-input"
            />
          </div>
        </div>

        {/* Per-company refresh */}
        <div className="flex flex-col gap-1 ml-auto">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Refresh company</span>
          <div className="flex items-center gap-1">
            <select
              value={tenant}
              onChange={(e) => setRefreshTenant(e.target.value)}
              className="h-9 rounded-input border border-border bg-surface px-2 text-sm max-w-[190px]"
            >
              {(companies ?? []).map((c) => (
                <option key={c.tenantId} value={c.tenantId}>{c.label}</option>
              ))}
            </select>
            <Button variant="outline" onClick={onRefresh} disabled={!tenant || busy} className="h-9 gap-1.5 rounded-button">
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {busy && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {note && <div className="text-xs text-muted-foreground">{note}</div>}

      {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearAll} />}

      {/* Body */}
      {!validRange ? (
        <div className="py-16 text-center text-muted-foreground">Pick a valid date range (from must be on or before to).</div>
      ) : isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading the sales register…</div>
      ) : error ? (
        <div className="py-16 text-center text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div>
              {filtered.length.toLocaleString("en-IN")} line{filtered.length === 1 ? "" : "s"}
              {" · "}revenue <b className="text-foreground font-semibold">₹ {fmtRev(totalRevenue)}</b>
            </div>
            {lastRefresh?.ran_at && (
              <div>Last refreshed {new Date(lastRefresh.ran_at).toLocaleString("en-IN")} · auto-refreshes daily at 8:00 PM</div>
            )}
          </div>

          <ScrollableTable className="rounded-lg border border-border" maxHeight="max-h-[64vh]">
            <table className="w-full border-collapse min-w-[1200px]">
              <thead>
                <tr className="border-b-2 border-border bg-muted/50">
                  {["Location", "Company", "Type", "Date", "Party Name", "Particulars", "Voucher Type", "Voucher No.", "GSTIN/UIN"].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                  {["Quantity", "Rate", "Revenue"].map((h) => (
                    <th key={h} className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.pageItems.length === 0 ? (
                  <tr><td colSpan={12} className="py-10 text-center text-sm text-muted-foreground">No lines match those filters.</td></tr>
                ) : (
                  page.pageItems.map((r, i) => (
                    <tr key={`${r.tenant_id}-${r.voucher_no}-${r.line_no}-${i}`} className="border-b border-border/40 hover:bg-muted/40">
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.location}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.company_label}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.type}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap tabular-nums">{r.date_display}</td>
                      <td className="py-1.5 px-3 text-sm">{r.party}</td>
                      <td className="py-1.5 px-3 text-sm">{r.particulars}</td>
                      <td className="py-1.5 px-3 text-sm text-muted-foreground whitespace-nowrap">{r.voucher_type}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.voucher_no}</td>
                      <td className="py-1.5 px-3 text-sm text-muted-foreground whitespace-nowrap tabular-nums">{r.gstin ?? ""}</td>
                      <td className="py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap">{fmtQty(r.quantity)}</td>
                      <td className="py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap">{fmtRate(r.rate)}</td>
                      <td className={`py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap ${r.revenue < 0 ? "text-destructive" : ""}`}>{fmtRev(r.revenue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>

          <Pagination state={page} rowsLabel="lines" />
        </>
      )}
    </div>
  );
}
