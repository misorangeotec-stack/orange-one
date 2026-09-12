/**
 * Sales Register — Tally Reports → Books & Registers.
 *
 * A flat, all-companies voucher-line register in the finance team's "Append1" layout. Reads the
 * precomputed ConnectWave `rpt_sales_register` snapshot (rebuilt within ~5 min of each book's Tally
 * sync, a 20:00 IST nightly as backstop, + on-demand per company), so it is source-agnostic
 * (available regardless of the Live-Tally toggle), exactly like the Master Reports → Sales Report.
 *
 * Data lives in lib/salesRegister.ts; the whole [from,to] window is loaded, then filtered and
 * paginated client-side (project rule: usePagination + <Pagination/>, 25/page). Export in
 * lib/exportSalesRegister.ts reproduces the source workbook.
 *
 * COMPANY / LOCATION come from ext_company_map (resolved in lib/salesRegister.ts), not from the
 * table's own `company_label` — that column is the counterparty class behind TYPE, not a company.
 * The one exception is a Related / Branch line, where COMPANY shows that class ('ORANGE O TEC
 * RELATED', 'ORANGE ENT BRANCH', …) at finance's request; see the note in lib/salesRegister.ts.
 *
 * DESPATCH COLUMNS (Delivery Note No. & Date, Despatch Doc No., Despatch Through, Destination,
 * Vehicle No.) sit immediately after Voucher No., the position Tally's own Voucher Register puts
 * them in, so this screen reads in the same order as the report finance reconcile against. They
 * come from the `rpt_sales_despatch` sidecar merged in lib/salesRegister.ts; a voucher with an
 * empty despatch block renders them blank, which is the honest reading — Tally holds nothing there.
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
import { useScopedParties } from "@hub/lib/scopeParties";

const BASE = "/outstanding-dashboard";

const nf = (max: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: max });
const fmtQty = (n: number) => (n === 0 ? "—" : nf(3).format(n));
const fmtRate = (n: number) => (n === 0 ? "—" : nf(2).format(n));
const fmtRev = (n: number) => nf(2).format(n);

/**
 * A despatch field Tally holds nothing in. It is a real, pickable filter value — "which invoices
 * went out with no destination recorded?" is the question this screen is most likely to be opened
 * for — so it gets a label rather than being dropped from the options list.
 */
const BLANK = "(blank)";
const orBlank = (v: string | null) => v ?? BLANK;

/** The filtered columns: a label for the chip, and how to read the value off a row. */
const FILTERS = {
  // One entry per book — 'O-tec — Surat', 'Enterprise — Noida' — the same labels the company
  // picker on every other Tally report offers, and the same ones the Refresh selector lists.
  company: { label: "Company", get: (r: RegisterRow) => r.company_display },
  type: { label: "Type", get: (r: RegisterRow) => r.type },
  through: { label: "Despatch through", get: (r: RegisterRow) => orBlank(r.despatch_through) },
  destination: { label: "Destination", get: (r: RegisterRow) => orBlank(r.destination) },
} as const;

type FilterKey = keyof typeof FILTERS;
const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];
const NO_FILTERS: Record<FilterKey, string[]> = { company: [], type: [], through: [], destination: [] };

export default function SalesRegister() {
  const qc = useQueryClient();
  const init = useMemo(() => defaultRange(), []);
  const [fromIso, setFromIso] = useState(ymdToIso(init.from));
  const [toIso, setToIso] = useState(ymdToIso(init.to));
  const from = isoToYmd(fromIso);
  const to = isoToYmd(toIso);
  const validRange = !!from && !!to && from <= to;

  // Per-salesperson scope. This table is read straight through PostgREST, so the narrowing is a
  // .in("party", …) on the query itself — out-of-scope lines never leave the server. Waiting for
  // `scopeLoading` matters: firing on the first render would read the whole register unfiltered.
  const { scope, loading: scopeLoading } = useScopedParties();
  const scopeKey = scope.kind === "all" ? "all" : scope.parties.join("|");

  const { data: rows, isLoading, error } = useQuery<RegisterRow[]>({
    // v2: rows carry the despatch block. v3: COMPANY shows the Related / Branch class. v4: only
    // still-pending SOA lines are included. An older entry cached in this session would render under
    // the previous rules, so the key moves with each change.
    queryKey: ["salesRegister", "v4", from, to, scopeKey],
    queryFn: () => loadSalesRegister(from, to, scope),
    enabled: validRange && !scopeLoading,
    staleTime: 5 * 60 * 1000,
  });
  const all = useMemo(() => rows ?? [], [rows]);

  /* -------- filters -------- */
  // Four filtered columns, each read off the row by one accessor. Keeping them in a map rather than
  // four parallel useStates is what makes the cascade below a loop instead of four hand-written
  // special cases — the house rule is that a column's options come from the rows surviving every
  // OTHER filter, so adding a fifth column must not mean rewriting the other four.
  const [sel, setSel] = useState<Record<FilterKey, string[]>>(NO_FILTERS);
  const [search, setSearch] = useState("");

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) =>
      r.party.toLowerCase().includes(q) ||
      r.particulars.toLowerCase().includes(q) ||
      r.voucher_no.toLowerCase().includes(q) ||
      (r.gstin ?? "").toLowerCase().includes(q) ||
      (r.delivery_note_no ?? "").toLowerCase().includes(q) ||
      (r.despatch_doc_no ?? "").toLowerCase().includes(q) ||
      (r.despatch_through ?? "").toLowerCase().includes(q) ||
      (r.destination ?? "").toLowerCase().includes(q) ||
      (r.vehicle_no ?? "").toLowerCase().includes(q));
  }, [all, search]);

  const filtered = useMemo(
    () => searched.filter((r) =>
      FILTER_KEYS.every((k) => !sel[k].length || sel[k].includes(FILTERS[k].get(r)))),
    [searched, sel],
  );

  /**
   * Each column's options, read off the rows surviving every OTHER filter (the house cascade rule),
   * with the column excluded from its own options so narrowing to one value still leaves a way back.
   *
   * All four lists are built in ONE pass over the rows rather than one pass each. The window here
   * runs to ~25k lines, and the dropdowns are rebuilt on every render — four independent scans, each
   * re-testing all four predicates, was ~400k row-tests per keystroke in the search box.
   */
  const options = useMemo(() => {
    const active = FILTER_KEYS.filter((k) => sel[k].length);
    const found: Record<FilterKey, Set<string>> =
      { company: new Set(), type: new Set(), through: new Set(), destination: new Set() };
    for (const r of searched) {
      // How many active filters this row fails. 0 → it feeds every column's options; exactly 1 → it
      // feeds only the column it failed, which is precisely that column's "every other filter" set.
      let missedKey: FilterKey | null = null;
      let missed = 0;
      for (const k of active) {
        if (!sel[k].includes(FILTERS[k].get(r))) { missed++; missedKey = k; if (missed > 1) break; }
      }
      if (missed > 1) continue;
      for (const k of FILTER_KEYS) if (missed === 0 || k === missedKey) found[k].add(FILTERS[k].get(r));
    }
    return Object.fromEntries(
      FILTER_KEYS.map((k) => [k, [...found[k]].sort().map((v) => ({ value: v, label: v }))]),
    ) as Record<FilterKey, MultiSelectOption[]>;
  }, [searched, sel]);

  const setFilter = (key: FilterKey) => (v: string[]) => setSel((s) => ({ ...s, [key]: v }));

  const totalRevenue = useMemo(() => filtered.reduce((s, r) => s + r.revenue, 0), [filtered]);

  const page = usePagination(filtered, {
    resetKey: `${from}|${to}|${FILTER_KEYS.map((k) => sel[k].join(",")).join("|")}|${search}`,
  });

  const chips: FilterChip[] = FILTER_KEYS.flatMap((k) =>
    sel[k].map((v) => ({
      label: `${FILTERS[k].label}: ${v}`,
      onRemove: () => setSel((s) => ({ ...s, [k]: s[k].filter((x) => x !== v) })),
    })));
  const clearAll = () => { setSel(NO_FILTERS); setSearch(""); };

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
            Every sales &amp; daybook voucher line across all companies — location, party, particulars,
            delivery note, despatch details, qty, rate and revenue, as booked. Sales on approval
            appear only while still pending; the rest are in the SOA Sales Register.
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
            options={options.company}
            value={sel.company}
            onChange={setFilter("company")}
            allLabel="All Companies"
            unit="Companies"
            triggerClassName="w-[200px] h-9 text-sm rounded-input border-border"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Type</span>
          <MultiSelectFilter
            options={options.type}
            value={sel.type}
            onChange={setFilter("type")}
            allLabel="All Types"
            unit="Types"
            triggerClassName="w-[180px] h-9 text-sm rounded-input border-border"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Despatch through</span>
          <MultiSelectFilter
            options={options.through}
            value={sel.through}
            onChange={setFilter("through")}
            allLabel="All Despatch"
            unit="Despatchers"
            triggerClassName="w-[180px] h-9 text-sm rounded-input border-border"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Destination</span>
          <MultiSelectFilter
            options={options.destination}
            value={sel.destination}
            onChange={setFilter("destination")}
            allLabel="All Destinations"
            unit="Destinations"
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
              placeholder="Party, particulars, voucher / delivery note no…"
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
              <div>Last refreshed {new Date(lastRefresh.ran_at).toLocaleString("en-IN")} · auto-refreshes after each Tally sync</div>
            )}
          </div>

          <ScrollableTable className="rounded-lg border border-border" maxHeight="max-h-[64vh]">
            <table className="w-full border-collapse min-w-[1800px]">
              <thead>
                <tr className="border-b-2 border-border bg-muted/50">
                  {[
                    "Location", "Company", "Type", "Date", "Party Name", "Particulars",
                    "Voucher Type", "Voucher No.",
                    "Delivery Note No.", "Delivery Note Date", "Despatch Doc No.",
                    "Despatch Through", "Destination", "Vehicle No.",
                    "GSTIN/UIN",
                  ].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                  {["Quantity", "Rate", "Revenue"].map((h) => (
                    <th key={h} className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.pageItems.length === 0 ? (
                  <tr><td colSpan={18} className="py-10 text-center text-sm text-muted-foreground">No lines match those filters.</td></tr>
                ) : (
                  page.pageItems.map((r, i) => (
                    <tr key={`${r.tenant_id}-${r.voucher_no}-${r.line_no}-${i}`} className="border-b border-border/40 hover:bg-muted/40">
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.location_name}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.company}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.type}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap tabular-nums">{r.date_display}</td>
                      <td className="py-1.5 px-3 text-sm">{r.party}</td>
                      <td className="py-1.5 px-3 text-sm">{r.particulars}</td>
                      <td className="py-1.5 px-3 text-sm text-muted-foreground whitespace-nowrap">{r.voucher_type}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.voucher_no}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.delivery_note_no ?? ""}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap tabular-nums">{r.delivery_note_date_display ?? ""}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.despatch_doc_no ?? ""}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.despatch_through ?? ""}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.destination ?? ""}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.vehicle_no ?? ""}</td>
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
