/**
 * SOA Sales Register — Tally Reports → Books & Registers.
 *
 * Stock sent out on approval, followed until it closes. Four tabs over one set of rows: All,
 * Converted to invoice, Rejected, Pending. The tabs OVERLAP on purpose — a challan part billed,
 * part returned and part still out belongs to three of them — so the counts do not sum to the
 * total, and the Status column shows each row's split.
 *
 * Pending reproduces Tally's own "Sales Bills Pending" (Goods Delivered but Bills not Made);
 * verified to the rupee against it. Data layer and the reasoning behind the row key are in
 * lib/soaRegister.ts; the ledger itself is built in supabase/connectwave/soa_register.sql.
 *
 * RELATIONSHIP TO THE SALES REGISTER
 * The Sales Register carries the STILL-PENDING approval lines and nothing else of this report:
 * approval stock is not revenue until it is billed, and a billed one is already represented there
 * by its invoice line. So Pending appears in both reports and reconciles between them; Converted
 * and Rejected appear only here.
 */
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, PackageCheck, RefreshCw, Search } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { ymdToIso, isoToYmd, loadRegisterCompanies } from "@hub/lib/salesRegister";
import {
  loadSoaRegister, defaultSoaRange, soaTabPredicate, SOA_TABS,
  refreshSoaCompany, loadLastSoaRefresh, type SoaRow, type SoaTab,
} from "@hub/lib/soaRegister";
import { exportSoaRegisterXlsx } from "@hub/lib/exportSoaRegister";
import { useScopedParties } from "@hub/lib/scopeParties";

const BASE = "/outstanding-dashboard";

const nf = (max: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: max });
const fmtQty = (n: number) => (n === 0 ? "—" : nf(4).format(n));
const fmtMoney = (n: number) => (n === 0 ? "—" : nf(2).format(n));

/** The filtered columns: a chip label, and how to read the value off a row. */
const FILTERS = {
  company: { label: "Company", get: (r: SoaRow) => r.company_display },
  status: { label: "Status", get: (r: SoaRow) => r.status },
  party: { label: "Party", get: (r: SoaRow) => r.party ?? "(blank)" },
} as const;
type FilterKey = keyof typeof FILTERS;
const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];
const NO_FILTERS: Record<FilterKey, string[]> = { company: [], status: [], party: [] };

/** Pending rows read as the live exposure, so they get a colour; settled ones stay quiet. */
const statusTone = (s: string) =>
  s === "Pending" || s === "Part pending" ? "text-amber-600 dark:text-amber-500"
  : s === "Rejected" ? "text-destructive"
  : "text-muted-foreground";

export default function SOARegister() {
  const qc = useQueryClient();
  const init = useMemo(() => defaultSoaRange(), []);
  const [fromIso, setFromIso] = useState(ymdToIso(init.from));
  const [toIso, setToIso] = useState(ymdToIso(init.to));
  const from = isoToYmd(fromIso);
  const to = isoToYmd(toIso);
  const validRange = !!from && !!to && from <= to;

  const { scope, loading: scopeLoading } = useScopedParties();
  const scopeKey = scope.kind === "all" ? "all" : scope.parties.join("|");

  const { data: rows, isLoading, error } = useQuery<SoaRow[]>({
    queryKey: ["soaRegister", "v1", from, to, scopeKey],
    queryFn: () => loadSoaRegister(from, to, scope),
    enabled: validRange && !scopeLoading,
    staleTime: 5 * 60 * 1000,
  });
  const all = useMemo(() => rows ?? [], [rows]);

  /* -------- tab + filters -------- */
  const [tab, setTab] = useState<SoaTab>("all");
  const [sel, setSel] = useState<Record<FilterKey, string[]>>(NO_FILTERS);
  const [search, setSearch] = useState("");

  // Tab counts are of the WHOLE window, not of the current filters — they are a map of what is
  // there, and recomputing them under the filters would make them move as you narrow.
  const tabCounts = useMemo(() => {
    const out = {} as Record<SoaTab, number>;
    for (const t of SOA_TABS) out[t.key] = all.filter(soaTabPredicate(t.key)).length;
    return out;
  }, [all]);

  const inTab = useMemo(() => all.filter(soaTabPredicate(tab)), [all, tab]);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter((r) =>
      r.tracking_no.toLowerCase().includes(q) ||
      r.item.toLowerCase().includes(q) ||
      (r.party ?? "").toLowerCase().includes(q) ||
      (r.soa_voucher_no ?? "").toLowerCase().includes(q) ||
      (r.billed_voucher_no ?? "").toLowerCase().includes(q) ||
      (r.rejected_voucher_no ?? "").toLowerCase().includes(q));
  }, [inTab, search]);

  /** Rows passing every filter except `except` — the cascade source, and (with none) the result. */
  const survivors = (except: FilterKey | null) =>
    searched.filter((r) =>
      FILTER_KEYS.every((k) => k === except || !sel[k].length || sel[k].includes(FILTERS[k].get(r))));

  const options = (key: FilterKey): MultiSelectOption[] =>
    [...new Set(survivors(key).map(FILTERS[key].get))].sort().map((v) => ({ value: v, label: v }));

  const filtered = useMemo(
    () => searched.filter((r) =>
      FILTER_KEYS.every((k) => !sel[k].length || sel[k].includes(FILTERS[k].get(r)))),
    [searched, sel],
  );

  const setFilter = (key: FilterKey) => (v: string[]) => setSel((s) => ({ ...s, [key]: v }));

  const totals = useMemo(() => filtered.reduce(
    (a, r) => ({
      issued: a.issued + r.issued_value,
      pending: a.pending + r.pending_value,
      pendingQty: a.pendingQty + r.pending_qty,
    }),
    { issued: 0, pending: 0, pendingQty: 0 },
  ), [filtered]);

  const page = usePagination(filtered, {
    resetKey: `${from}|${to}|${tab}|${FILTER_KEYS.map((k) => sel[k].join(",")).join("|")}|${search}`,
  });

  const chips: FilterChip[] = FILTER_KEYS.flatMap((k) =>
    sel[k].map((v) => ({
      label: `${FILTERS[k].label}: ${v}`,
      onRemove: () => setSel((s) => ({ ...s, [k]: s[k].filter((x) => x !== v) })),
    })));
  const clearAll = () => { setSel(NO_FILTERS); setSearch(""); };

  const onExport = () => {
    if (!filtered.length) return;
    const tabLabel = SOA_TABS.find((t) => t.key === tab)?.label ?? "All SOA";
    exportSoaRegisterXlsx(filtered, { from, to, tabLabel });
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
    queryKey: ["soaRegisterLastRefresh", tenant],
    queryFn: () => loadLastSoaRefresh(tenant),
    enabled: !!tenant,
  });

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const eta = Math.max(5, lastRefresh?.seconds ?? 20);
  const progress = busy ? Math.min(95, (elapsed / eta) * 100) : 0;

  const onRefresh = async () => {
    if (!tenant || busy) return;
    setBusy(true); setNote(null); setElapsed(0);
    timer.current = setInterval(() => setElapsed((e) => e + 0.25), 250);
    try {
      const res = await refreshSoaCompany(tenant);
      if (res.status === "cooldown") setNote(`Just refreshed — try again in ${res.retry_after_seconds ?? 0}s.`);
      else if (res.status === "busy") setNote("A refresh is already running for this company.");
      else if (res.status === "error") setNote(res.message ?? "Refresh failed.");
      else {
        setNote(`Refreshed in ${res.seconds ?? 0}s — ${res.rows ?? 0} approval lines.`);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["soaRegister"] }),
          qc.invalidateQueries({ queryKey: ["soaRegisterLastRefresh", tenant] }),
        ]);
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
    }
  };

  const HEADERS_LEFT = ["Location", "Company", "Date", "Tracking Number", "Name of Item", "Party", "SOA Voucher No."];
  const HEADERS_RIGHT = ["Initial Qty", "Billed Qty", "Rejected Qty", "Pending Qty", "Rate", "Pending Value"];

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to={`${BASE}/reports?cat=tally`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-3 w-3" /> Tally Reports
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <PackageCheck className="h-6 w-6 text-primary" /> SOA Sales Register
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stock sent out on approval, followed until it closes — billed, returned, or still with the
            customer. Pending matches Tally&apos;s Sales Bills Pending.
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
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Period (SOA date)</span>
          <div className="flex items-center gap-1">
            <Input type="date" value={fromIso} onChange={(e) => setFromIso(e.target.value)} className="h-9 w-[150px] rounded-input text-sm" />
            <span className="text-muted-foreground text-xs">to</span>
            <Input type="date" value={toIso} onChange={(e) => setToIso(e.target.value)} className="h-9 w-[150px] rounded-input text-sm" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Company</span>
          <MultiSelectFilter
            options={options("company")} value={sel.company} onChange={setFilter("company")}
            allLabel="All Companies" unit="Companies"
            triggerClassName="w-[200px] h-9 text-sm rounded-input border-border"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Status</span>
          <MultiSelectFilter
            options={options("status")} value={sel.status} onChange={setFilter("status")}
            allLabel="All Statuses" unit="Statuses"
            triggerClassName="w-[170px] h-9 text-sm rounded-input border-border"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Party</span>
          <MultiSelectFilter
            options={options("party")} value={sel.party} onChange={setFilter("party")}
            allLabel="All Parties" unit="Parties"
            triggerClassName="w-[200px] h-9 text-sm rounded-input border-border"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Search</span>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Tracking no, item, party, voucher no…"
              className="pl-9 h-9 w-64 rounded-input"
            />
          </div>
        </div>

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

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {SOA_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm rounded-t-md border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
              {(tabCounts[t.key] ?? 0).toLocaleString("en-IN")}
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        One approval line can be part billed, part returned and part pending, so it appears under more
        than one tab and the counts do not add up to the total.
      </p>

      {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearAll} />}

      {/* Body */}
      {!validRange ? (
        <div className="py-16 text-center text-muted-foreground">Pick a valid date range (from must be on or before to).</div>
      ) : isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading the approval ledger…</div>
      ) : error ? (
        <div className="py-16 text-center text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div>
              {filtered.length.toLocaleString("en-IN")} line{filtered.length === 1 ? "" : "s"}
              {" · "}initial <b className="text-foreground font-semibold">₹ {fmtMoney(totals.issued)}</b>
              {" · "}pending <b className="text-foreground font-semibold">₹ {fmtMoney(totals.pending)}</b>
            </div>
            {lastRefresh?.ran_at && (
              <div>Last refreshed {new Date(lastRefresh.ran_at).toLocaleString("en-IN")} · auto-refreshes after each Tally sync</div>
            )}
          </div>

          <ScrollableTable className="rounded-lg border border-border" maxHeight="max-h-[64vh]">
            <table className="w-full border-collapse min-w-[1700px]">
              <thead>
                <tr className="border-b-2 border-border bg-muted/50">
                  {HEADERS_LEFT.map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                  {HEADERS_RIGHT.map((h) => (
                    <th key={h} className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Billed / Rejected Voucher</th>
                </tr>
              </thead>
              <tbody>
                {page.pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={HEADERS_LEFT.length + HEADERS_RIGHT.length + 2} className="py-10 text-center text-sm text-muted-foreground">
                      No approval lines match those filters.
                    </td>
                  </tr>
                ) : (
                  page.pageItems.map((r, i) => (
                    <tr key={`${r.tenant_id}-${r.tracking_no}-${r.item}-${i}`} className="border-b border-border/40 hover:bg-muted/40">
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.location_name}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.company}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap tabular-nums">{r.soa_date_display}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap font-medium">{r.tracking_no}</td>
                      <td className="py-1.5 px-3 text-sm">{r.item}</td>
                      <td className="py-1.5 px-3 text-sm">{r.party ?? ""}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.soa_voucher_no ?? ""}</td>
                      <td className="py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap">{fmtQty(r.issued_qty)}</td>
                      <td className="py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap">{fmtQty(r.billed_qty)}</td>
                      <td className="py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap">{fmtQty(r.rejected_qty)}</td>
                      <td className={`py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap ${r.pending_qty > 0 ? "font-semibold" : ""}`}>{fmtQty(r.pending_qty)}</td>
                      <td className="py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap">{fmtMoney(r.rate)}</td>
                      <td className={`py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap ${r.pending_value > 0 ? "font-semibold" : ""}`}>{fmtMoney(r.pending_value)}</td>
                      <td className={`py-1.5 px-3 text-sm whitespace-nowrap ${statusTone(r.status)}`}>{r.status}</td>
                      <td className="py-1.5 px-3 text-sm text-muted-foreground whitespace-nowrap">
                        {[r.billed_voucher_no, r.rejected_voucher_no].filter(Boolean).join(" · ")}
                      </td>
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
