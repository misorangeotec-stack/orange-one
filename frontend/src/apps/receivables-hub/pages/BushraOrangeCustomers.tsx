/**
 * Orange vs Non-Orange Customers — Bushra-Dashboard → Sales (the dashboard) and Bushra-Report (the
 * same list on its own).
 *
 *   Orange       bought a machine from us in the last two FYs (most also buy our ink)
 *   Non-Orange   bought our ink in the last two FYs, but no machine from us
 *
 * One customer = one hub Customer Group, so the machine-order ledger and the ink ledger count as one.
 * The rules, and why, are in lib/bushraOrangeCustomers.ts. Every figure is summed from the Bushra
 * Sales Register's own rows — the same load, cache key and pure-sale rule as the Sales dashboards.
 *
 * Filters narrow the FIGURES; the bucket is always decided on the customer's whole window. Clicking a
 * bucket card, a month or a customer's bar filters every panel; click it again to let it go.
 *
 * AN ADMIN CAN MOVE ANY CUSTOMER (asked 09-10-2026: the rule cannot see a machine sold before the
 * window, so it under-counts Orange). Click a customer's bucket in the list, or tick several and set
 * them together; the choice is shared (lib/bushraOrangeOverrides.ts) and every card, chart and the
 * export follow it. "Auto" hands a customer back to the rule.
 */
import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, CircleDot, Download, Droplet, Hand,
  IndianRupee, Loader2, RotateCcw, Search, Table2, Users,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Checkbox } from "@hub/components/ui/checkbox";
import { useSession } from "@/core/platform/session";
import { cn } from "@hub/lib/utils";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { PanelFill } from "@hub/components/ResizeKit";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { ColumnPicker, type ColumnOption } from "@hub/components/ColumnPicker";
import { fmtSales } from "@hub/lib/salesReport";
import { currentFy, ymd } from "@hub/lib/salesRegister";
import { loadBushraSalesRegister, loadItemLookup, type BushraRegisterRow } from "@hub/lib/bushraSalesRegister";
import { SALES_DASHBOARDS, isPureSale } from "@hub/lib/bushraSalesDashboards";
import { DIMS, fmtInt, makeQtyFmt, monthName, productOf } from "@hub/lib/bushraSalesFigures";
import {
  BUCKETS, UNCLASSIFIED, classify, customerFigures, loadGroupLink, type Bucket, type CustomerFigures, type Placement,
} from "@hub/lib/bushraOrangeCustomers";
import { loadBucketOverrides, saveBucketOverrides } from "@hub/lib/bushraOrangeOverrides";
import { useScopedParties } from "@hub/lib/scopeParties";
import { useReportAccess } from "@hub/lib/reportAccess";
import { appBasePath } from "@/apps/appInfo";

const BASE = appBasePath("reports");
export const ORANGE_DASHBOARD_ID = "bushra-sales-orange-customers";
export const ORANGE_DASHBOARD_PATH = "bushra-dashboard/sales-orange-customers";
export const ORANGE_REPORT_ID = "bushra-orange-customers";
export const ORANGE_REPORT_PATH = "reports/bushra-orange-customers";

/** Orange is the company's own colour; Non-Orange a blue that is told apart from it at a glance. */
const COLOR: Record<Placement, string> = { Orange: "#ea580c", "Non-Orange": "#2563eb", [UNCLASSIFIED]: "#6b7280" };
const CHART_GRID = "hsl(220 15% 92%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 45%)" };
const LABEL_FILL = "hsl(220 20% 30%)";
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const fmtKg = makeQtyFmt("kg", []);
const fmtNos = makeQtyFmt("nos", []);
/** "20260918" → "18-09-2026" */
const dmy = (d: string) => (d ? `${d.slice(6)}-${d.slice(4, 6)}-${d.slice(0, 4)}` : "");
const pct = (v: number, total: number) => (total ? `${((v / total) * 100).toFixed(1)}%` : "—");

type Row = BushraRegisterRow;

/** The filter bar. Bucket and Customer are read off the customer; Company and Location off the line. */
const FILTERS = {
  bucket: { label: "Bucket", all: "All buckets", unit: "Buckets" },
  company: { label: "Company", all: "All Companies", unit: "Companies" },
  location: { label: "Location", all: "All Locations", unit: "Locations" },
  group: { label: "Customer", all: "All Customers", unit: "Customers" },
  month: { label: "Month", all: "All Months", unit: "Months" },
} as const;
type FilterKey = keyof typeof FILTERS;
const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];
const NO_FILTERS: Record<FilterKey, string[]> = { bucket: [], company: [], location: [], group: [], month: [] };

/** A line with the customer it belongs to and that customer's bucket. */
interface Tagged { r: Row; group: string; bucket: Placement; month: string }

export default function BushraOrangeCustomers({ mode }: { mode: "dashboard" | "report" }) {
  const { canSee } = useReportAccess();
  /** Two financial years to today — this FY and the one before. */
  const thisFyStart = Number(currentFy().slice(0, 4));
  const from = `${thisFyStart - 1}0401`;
  const to = ymd(new Date());

  const { scope, loading: scopeLoading } = useScopedParties();
  const scopeKey = scope.kind === "all" ? "all" : scope.parties.join("|");
  // The Sales dashboards' own cache keys, so a reader coming from them waits for nothing.
  const { data: lookup, error: lookupError } = useQuery({
    queryKey: ["bushraSalesRegister", "itemLookup", "v4"],
    queryFn: loadItemLookup,
    staleTime: 30 * 60 * 1000,
  });
  const { data, isLoading, error: rowsError } = useQuery<Row[]>({
    queryKey: ["bushraSalesRegister", "v8", from, to, scopeKey],
    queryFn: () => loadBushraSalesRegister(from, to, scope, lookup),
    enabled: !scopeLoading && !!lookup,
    staleTime: 5 * 60 * 1000,
  });
  const { data: link, error: linkError } = useQuery({
    queryKey: ["bushraOrangeCustomers", "groupLink", "v1"],
    queryFn: loadGroupLink,
    staleTime: 30 * 60 * 1000,
  });
  // The buckets set by hand. Not ready = the table is not in the database yet; the rule alone decides.
  const { data: overrides, error: overridesError } = useQuery({
    queryKey: ["bushraOrangeCustomers", "overrides"],
    queryFn: loadBucketOverrides,
    staleTime: 60 * 1000,
  });
  const err = lookupError ?? rowsError ?? linkError ?? overridesError;
  const errText = err ? (err as Error).message : null;
  const loading = (isLoading || !lookup || !link || !overrides) && !errText;
  const { isAdmin, user } = useSession();
  const qc = useQueryClient();
  /** Put customers in a bucket by hand, or (null) back to the rule — then everything recomputes. */
  const saveBuckets = async (groups: string[], bucket: Bucket | null) => {
    await saveBucketOverrides(groups, bucket, user.id);
    await qc.invalidateQueries({ queryKey: ["bushraOrangeCustomers", "overrides"] });
  };

  /* -------- who is in which bucket: the WHOLE window, every company, no filter -------- */
  const pure = useMemo(() => (data ?? []).filter(isPureSale), [data]);
  const buckets = useMemo(
    () => (link ? classify(pure, link, overrides?.byGroup) : new Map()),
    [pure, link, overrides],
  );
  const tagged = useMemo<Tagged[]>(() => {
    if (!link) return [];
    const out: Tagged[] = [];
    for (const r of pure) {
      const group = link.of(r.tenant_id, r.party).group;
      const c = buckets.get(group);
      if (c) out.push({ r, group, bucket: c.bucket, month: r.vch_date.slice(0, 6) });
    }
    return out;
  }, [pure, link, buckets]);

  /* -------- filters -------- */
  const [sel, setSel] = useState<Record<FilterKey, string[]>>(NO_FILTERS);
  const getOf: Record<FilterKey, (t: Tagged) => string> = {
    bucket: (t) => t.bucket,
    company: (t) => DIMS.company(t.r),
    location: (t) => DIMS.location(t.r),
    group: (t) => t.group,
    month: (t) => monthName(t.month),
  };
  const keep = (t: Tagged, except?: FilterKey) =>
    FILTER_KEYS.every((k) => k === except || !sel[k].length || sel[k].includes(getOf[k](t)));
  const shown = useMemo(() => tagged.filter((t) => keep(t)), [tagged, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Each dropdown lists what the OTHER filters leave — the house cascade. */
  const options = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => {
    const vals = new Set<string>();
    for (const t of tagged) if (keep(t, k)) vals.add(getOf[k](t));
    const list = [...vals];
    if (k === "month") {
      const byLabel = new Map(tagged.map((t) => [monthName(t.month), t.month]));
      list.sort((a, b) => (byLabel.get(a) ?? "").localeCompare(byLabel.get(b) ?? ""));
    } else list.sort(collator.compare);
    return [k, list.map((v) => ({ value: v, label: v }))];
  })) as Record<FilterKey, MultiSelectOption[]>, [tagged, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFilter = (k: FilterKey) => (v: string[]) => setSel((s) => ({ ...s, [k]: v }));
  /** From a card or a bar: that one value, or let it go if it already is the pick. */
  const toggle = (k: FilterKey, v: string) =>
    setSel((s) => ({ ...s, [k]: s[k].length === 1 && s[k][0] === v ? [] : [v] }));
  const filterCount = FILTER_KEYS.reduce((n, k) => n + sel[k].length, 0);

  /* -------- figures -------- */
  const customers = useMemo(
    () => (link ? customerFigures(shown.map((t) => t.r), link, buckets) : []),
    [shown, link, buckets],
  );
  const kpi = useMemo(() => {
    const k = Object.fromEntries(BUCKETS.map((b) => [b, { customers: 0, noInk: 0, inkVal: 0, inkQty: 0, machineQty: 0, machineVal: 0, total: 0 }])) as
      Record<Bucket, { customers: number; noInk: number; inkVal: number; inkQty: number; machineQty: number; machineVal: number; total: number }>;
    for (const c of customers) {
      if (c.bucket === UNCLASSIFIED) continue;
      const x = k[c.bucket];
      x.customers++; if (c.noInk) x.noInk++;
      x.inkVal += c.inkVal; x.inkQty += c.inkQty; x.machineQty += c.machineQty; x.machineVal += c.machineVal; x.total += c.total;
    }
    return k;
  }, [customers]);
  const inkTotal = kpi.Orange.inkVal + kpi["Non-Orange"].inkVal;
  const ungrouped = customers.filter((c) => !c.grouped).length;
  const unclassified = customers.filter((c) => c.bucket === UNCLASSIFIED).length;
  const byHand = customers.filter((c) => c.manual).length;

  /** Ink revenue per month, one stacked bar per month: Orange under Non-Orange. */
  const byMonth = useMemo(() => {
    const m = new Map<string, { key: string; label: string; Orange: number; "Non-Orange": number }>();
    // Every month of the window, so a quiet month shows as a gap and not as a missing bar.
    let y = thisFyStart - 1, mo = 4;
    const end = Number(to.slice(0, 6));
    while (y * 100 + mo <= end) {
      const key = `${y}${String(mo).padStart(2, "0")}`;
      m.set(key, { key, label: monthName(key), Orange: 0, "Non-Orange": 0 });
      if (++mo > 12) { mo = 1; y++; }
    }
    for (const t of shown) {
      if (productOf(t.r.sales_type) !== "Ink") continue;
      const p = m.get(t.month);
      if (p && t.bucket !== UNCLASSIFIED) p[t.bucket] += t.r.revenue;
    }
    return [...m.values()];
  }, [shown, thisFyStart, to]);

  const topOf = (b: Bucket) => customers.filter((c) => c.bucket === b && c.inkVal > 0)
    .sort((x, y) => y.inkVal - x.inkVal).slice(0, 15)
    .map((c) => ({ name: c.group, value: c.inkVal }));

  const salesTabs = SALES_DASHBOARDS.filter((p) => canSee(p.id));
  const windowLabel = `${dmy(from)} → ${dmy(to)}`;

  return (
    <div className="p-4 lg:p-6 max-w-[1700px] mx-auto space-y-3">
      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="min-w-0">
          <Link to={mode === "dashboard" ? `${BASE}/bushra-dashboard?group=sales` : BASE}
                className="mb-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> {mode === "dashboard" ? "Sales" : "Reports"}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h1 className="text-[19px] font-bold tracking-tight text-foreground">Orange vs Non-Orange Customers</h1>
            <span className="text-[12px] text-muted-foreground">
              · Orange = bought our machine · Non-Orange = only our ink · last two FYs, by Customer Group
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {mode === "dashboard" && canSee(ORANGE_REPORT_ID) && (
            <Link to={`${BASE}/bushra-orange-customers`} className="text-primary hover:underline">Customer list report</Link>
          )}
          {mode === "report" && canSee(ORANGE_DASHBOARD_ID) && (
            <Link to={`${BASE}/${ORANGE_DASHBOARD_PATH}`} className="text-primary hover:underline">Dashboard</Link>
          )}
        </div>
      </div>

      {/* ── The Sales dashboards' tabs, this one among them ───────────────── */}
      {mode === "dashboard" && salesTabs.length > 0 && (
        <nav className="flex flex-wrap gap-1.5">
          {salesTabs.map((p) => (
            <Link key={p.id} to={`${BASE}/${p.path}`}
                  className="rounded-pill border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
              {p.id === "bushra-sales-dashboard" ? "Sales" : p.title}
            </Link>
          ))}
          <span className="rounded-pill border border-primary bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground">
            Orange vs Non-Orange
          </span>
        </nav>
      )}

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-surface px-3 py-2">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          {FILTER_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{FILTERS[k].label}</span>
              <MultiSelectFilter
                options={options[k]} value={sel[k]} onChange={setFilter(k)}
                allLabel={FILTERS[k].all} unit={FILTERS[k].unit} searchable
                triggerClassName={cn("h-8 text-[12px] rounded-input border-border", k === "group" ? "w-[220px]" : "w-[150px]")}
                contentClassName={k === "group" ? "w-80" : undefined}
              />
            </label>
          ))}
          <Button onClick={() => setSel(NO_FILTERS)} disabled={!filterCount}
                  className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5" /> Reset All
          </Button>
          <span className="ml-auto rounded-pill bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {fmtInt(customers.length)} customers · {windowLabel}
          </span>
        </div>
      </div>

      {errText && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">{errText}</div>
      )}

      {/* ── The two buckets ───────────────────────────────────────────────── */}
      <div className="grid gap-3 md:grid-cols-2">
        {BUCKETS.map((b) => {
          const k = kpi[b];
          const on = sel.bucket.length === 1 && sel.bucket[0] === b;
          return (
            <button key={b} type="button" onClick={() => toggle("bucket", b)}
                    title={on ? "Click again to show both buckets" : `Filter every panel to ${b} customers`}
                    className={cn("rounded-card border bg-surface p-3 text-left shadow-sm transition-colors hover:bg-muted/30",
                                  on ? "border-2" : "border-border",
                                  sel.bucket.length && !on && "opacity-50")}
                    style={on ? { borderColor: COLOR[b] } : undefined}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[14px] font-bold text-foreground">
                  <CircleDot className="h-4 w-4" style={{ color: COLOR[b] }} /> {b} customers
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {b === "Orange" ? "bought our machine" : "our ink, no machine from us"}
                </span>
              </div>
              {loading ? (
                <div className="mt-2 h-14 animate-pulse rounded bg-muted/60" />
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                  <Fig label="Customers" value={fmtInt(k.customers)}
                       sub={b === "Orange" && k.noInk ? `${fmtInt(k.noInk)} with no ink yet` : undefined} />
                  <Fig label="Ink revenue" value={fmtSales(k.inkVal)} sub={`${pct(k.inkVal, inkTotal)} of ink`} />
                  <Fig label="Ink quantity" value={fmtKg(k.inkQty)} />
                  {b === "Orange"
                    ? <Fig label="Machines" value={fmtNos(k.machineQty)} sub={fmtSales(k.machineVal)} />
                    : <Fig label="Total revenue" value={fmtSales(k.total)} sub="all products" />}
                </div>
              )}
              <div className="mt-2 h-[3px] w-full rounded-full" style={{ background: `${COLOR[b]}33` }}>
                <div className="h-full rounded-full" style={{ background: COLOR[b], width: inkTotal ? `${Math.max(2, (k.inkVal / inkTotal) * 100)}%` : "0%" }} />
              </div>
            </button>
          );
        })}
      </div>
      {!loading && (byHand > 0 || unclassified > 0) && (
        <p className="text-[11px] text-muted-foreground">
          {byHand > 0 && <>{fmtInt(byHand)} customer{byHand === 1 ? " is" : "s are"} in a bucket set by hand (tagged "set by hand"). </>}
          {unclassified > 0 && <>{fmtInt(unclassified)} bought neither a machine nor ink in the window — "Unclassified" in the list, in neither card{isAdmin ? "; set them by hand there" : ""}.</>}
        </p>
      )}
      {isAdmin && overrides && !overrides.ready && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          Setting a customer's bucket by hand needs the database table first: run migration
          <code className="mx-1 rounded bg-black/5 px-1">20270115120000_bushra_orange_customer_overrides.sql</code>
          in the Supabase SQL editor. Until then the rule alone decides.
        </div>
      )}
      {ungrouped > 0 && !loading && (
        <p className="text-[11px] text-muted-foreground">
          {fmtInt(ungrouped)} customer{ungrouped === 1 ? " is" : "s are"} a ledger with no Customer Group, counted on its own
          (tagged "not grouped"). Map them in Masters → Customer Group, so a machine ledger and an ink ledger join up.
        </p>
      )}

      {mode === "dashboard" && (
        <>
          {/* ── Ink by month ──────────────────────────────────────────────── */}
          <SalesPanel title="Ink revenue by month — Orange vs Non-Orange" icon={IndianRupee} loading={loading}
                      empty={!loading && !customers.length} emptyMessage="No customers match those filters."
                      subtitle={sel.month.length ? `filtered to ${sel.month.join(", ")} — click the month again to clear`
                        : "click a month to filter every panel"}
                      sizeKey="orange-ink-month">
            <PanelFill base={300}>{(bar) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonth} margin={{ top: 8, right: 8, left: 4, bottom: 14 }}>
                  <CartesianGrid stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false}
                         axisLine={{ stroke: CHART_GRID }} interval={0} angle={-40} textAnchor="end" height={44} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={64}
                         tickFormatter={(v: number) => fmtSales(v).replace("₹ ", "")} />
                  <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }}
                           formatter={(v: number, n: string) => [fmtSales(v), n]} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  {BUCKETS.map((b) => (
                    <Bar key={b} dataKey={b} stackId="m" fill={COLOR[b]} maxBarSize={bar(34)} className="cursor-pointer"
                         onClick={(d: { label?: string }) => d?.label && toggle("month", d.label)}>
                      {byMonth.map((p) => (
                        <Cell key={p.key} fillOpacity={!sel.month.length || sel.month.includes(p.label) ? 1 : 0.3} />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}</PanelFill>
          </SalesPanel>

          {/* ── Top customers, each bucket ────────────────────────────────── */}
          <div className="grid gap-3 lg:grid-cols-2">
            {BUCKETS.map((b) => {
              const top = topOf(b);
              return (
                <SalesPanel key={b} title={`Top ${b} customers by ink revenue`} icon={Droplet} loading={loading}
                            empty={!loading && !top.length} emptyMessage="No ink sold to these customers."
                            subtitle={sel.group.length ? `filtered to ${sel.group.join(", ")} — click it again to clear`
                              : "the 15 biggest — click one to filter every panel"}
                            sizeKey={`orange-top-${b}`} bodyHeight={444}>
                  <PanelFill base={420} min={(bar) => top.length * bar(26) + 30}>{(bar) => (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={top} layout="vertical" margin={{ top: 4, right: 90, left: 4, bottom: 4 }}>
                        <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false}
                               tickFormatter={(v: number) => fmtSales(v).replace("₹ ", "")} />
                        <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false}
                               axisLine={false} width={210} interval={0} />
                        <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} formatter={(v: number) => [fmtSales(v), "Ink revenue"]} />
                        <Bar dataKey="value" maxBarSize={bar(16)} radius={[0, 4, 4, 0]} className="cursor-pointer"
                             onClick={(d: { name?: string }) => d?.name && toggle("group", d.name)}>
                          {top.map((t) => (
                            <Cell key={t.name} fill={COLOR[b]}
                                  fillOpacity={!sel.group.length || sel.group.includes(t.name) ? 1 : 0.3} />
                          ))}
                          <LabelList dataKey="value" position="right" formatter={(v: number) => fmtSales(v)}
                                     style={{ fontSize: 10, fill: LABEL_FILL, fontWeight: 600 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}</PanelFill>
                </SalesPanel>
              );
            })}
          </div>
        </>
      )}

      {/* ── The customer list ─────────────────────────────────────────────── */}
      <CustomerTable customers={customers} loading={loading} windowLabel={windowLabel} from={from} to={to}
                     canEdit={isAdmin} ready={!!overrides?.ready} onSetBucket={saveBuckets} />
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-[17px] font-bold leading-tight text-foreground" title={value}>{value}</div>
      {sub && <div className="truncate text-[10.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ================================================================ the customer list */

interface Col {
  key: string; header: string; right?: boolean;
  sort: (c: CustomerFigures) => string | number;
  cell: (c: CustomerFigures) => React.ReactNode;
  /** The value written to Excel. */
  xl: (c: CustomerFigures) => string | number;
}

const td = "whitespace-nowrap px-3 py-1.5";
const COLS: Col[] = [
  { key: "bucket", header: "Bucket", sort: (c) => c.bucket,
    cell: (c) => (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span className="rounded-pill px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: COLOR[c.bucket] }}>{c.bucket}</span>
        {c.manual && (
          <span className="inline-flex items-center gap-0.5 rounded-pill border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary"
                title={`Set by hand — the rule says ${c.auto}`}>
            <Hand className="h-2.5 w-2.5" /> set by hand
          </span>
        )}
        {c.noInk && <span className="rounded-pill border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">no ink yet</span>}
        {!c.grouped && <span className="rounded-pill border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">not grouped</span>}
      </span>
    ),
    xl: (c) => c.bucket },
  { key: "auto", header: "By Rule", sort: (c) => c.auto,
    cell: (c) => <span className={cn(c.manual && c.auto !== c.bucket ? "text-muted-foreground line-through decoration-1" : "text-muted-foreground")}>{c.auto}</span>,
    xl: (c) => c.auto },
  { key: "group", header: "Customer Group", sort: (c) => c.group, cell: (c) => <span className="font-medium">{c.group}</span>, xl: (c) => c.group },
  { key: "ledgers", header: "Ledgers", right: true, sort: (c) => c.ledgers.length, cell: (c) => fmtInt(c.ledgers.length), xl: (c) => c.ledgers.length },
  { key: "company", header: "Company", sort: (c) => c.companies.join(", "), cell: (c) => c.companies.join(", "), xl: (c) => c.companies.join(", ") },
  { key: "location", header: "Location", sort: (c) => c.locations.join(", "), cell: (c) => c.locations.join(", "), xl: (c) => c.locations.join(", ") },
  { key: "machineQty", header: "Machines", right: true, sort: (c) => c.machineQty, cell: (c) => (c.machineQty ? fmtNos(c.machineQty) : "—"), xl: (c) => c.machineQty },
  { key: "machineVal", header: "Machine Value", right: true, sort: (c) => c.machineVal, cell: (c) => (c.machineVal ? fmtSales(c.machineVal) : "—"), xl: (c) => Math.round(c.machineVal) },
  { key: "inkQty", header: "Ink Qty", right: true, sort: (c) => c.inkQty, cell: (c) => (c.inkQty ? fmtKg(c.inkQty) : "—"), xl: (c) => Math.round(c.inkQty * 100) / 100 },
  { key: "inkVal", header: "Ink Value", right: true, sort: (c) => c.inkVal, cell: (c) => (c.inkVal ? fmtSales(c.inkVal) : "—"), xl: (c) => Math.round(c.inkVal) },
  { key: "headsSparesVal", header: "Heads & Spares", right: true, sort: (c) => c.headsSparesVal, cell: (c) => (c.headsSparesVal ? fmtSales(c.headsSparesVal) : "—"), xl: (c) => Math.round(c.headsSparesVal) },
  { key: "otherVal", header: "Other", right: true, sort: (c) => c.otherVal, cell: (c) => (c.otherVal ? fmtSales(c.otherVal) : "—"), xl: (c) => Math.round(c.otherVal) },
  { key: "total", header: "Total Revenue", right: true, sort: (c) => c.total, cell: (c) => <span className="font-semibold">{fmtSales(c.total)}</span>, xl: (c) => Math.round(c.total) },
  { key: "firstMachine", header: "First Machine", sort: (c) => c.firstMachine, cell: (c) => dmy(c.firstMachine) || "—", xl: (c) => dmy(c.firstMachine) },
  { key: "lastInk", header: "Last Ink", sort: (c) => c.lastInk, cell: (c) => dmy(c.lastInk) || "—", xl: (c) => dmy(c.lastInk) },
  { key: "lastSale", header: "Last Sale", sort: (c) => c.lastSale, cell: (c) => dmy(c.lastSale) || "—", xl: (c) => dmy(c.lastSale) },
];
const COLUMN_OPTIONS: ColumnOption[] = COLS.map((c) => ({ key: c.key, label: c.header }));
const COLS_KEY = "orangeone.cols.bushra-orange-customers";
const readCols = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "null");
    const kept = Array.isArray(v) ? COLS.map((c) => c.key).filter((k) => v.includes(k)) : [];
    return kept.length ? kept : COLS.map((c) => c.key);
  } catch { return COLS.map((c) => c.key); }
};

function CustomerTable({ customers, loading, windowLabel, from, to, canEdit, ready, onSetBucket }: {
  customers: CustomerFigures[]; loading: boolean; windowLabel: string; from: string; to: string;
  /** An admin — sees the controls. */
  canEdit: boolean;
  /** The overrides table is in the database, so a choice can actually be saved. */
  ready: boolean;
  onSetBucket: (groups: string[], bucket: Bucket | null) => Promise<void>;
}) {
  /** Ticked for a bulk change — by Customer Group. */
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const apply = async (groups: string[], bucket: Bucket | null) => {
    if (!groups.length) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await onSetBucket(groups, bucket);
      setTicked(new Set());
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const tick = (g: string) => setTicked((t) => {
    const n = new Set(t);
    if (n.has(g)) n.delete(g); else n.add(g);
    return n;
  });
  const [q, setQ] = useState("");
  const [visible, setVisible] = useState<string[]>(readCols);
  const pickCols = (v: string[]) => {
    setVisible(v);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(v)); } catch { /* private window: just not kept */ }
  };
  const cols = useMemo(() => COLS.filter((c) => visible.includes(c.key)), [visible]);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "total", dir: -1 });
  const [open, setOpen] = useState<string | null>(null);

  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers;
    return customers.filter((c) => c.group.toLowerCase().includes(s) || c.ledgers.some((l) => l.ledger.toLowerCase().includes(s)));
  }, [customers, q]);
  const sorted = useMemo(() => {
    const get = COLS.find((c) => c.key === sort.key)?.sort ?? ((c: CustomerFigures) => c.total);
    return [...searched].sort((a, b) => {
      const x = get(a), y = get(b);
      return sort.dir * (typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y)));
    });
  }, [searched, sort]);
  const toggleSort = (key: string, right?: boolean) => setSort((s) =>
    s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: right ? -1 : 1 });
  const page = usePagination(sorted, { resetKey: `${customers.length}|${q}|${sort.key}|${sort.dir}` });

  const exportXlsx = () => {
    const head = cols.map((c) => c.header);
    const ws = XLSX.utils.aoa_to_sheet([head, ...sorted.map((c) => cols.map((col) => col.xl(c)))]);
    ws["!cols"] = cols.map((c) => ({ wch: c.key === "group" ? 36 : c.key === "company" ? 28 : 14 }));
    head.forEach((_, i) => {
      const a = XLSX.utils.encode_cell({ r: 0, c: i });
      if (ws[a]) ws[a].s = { font: { bold: true } };
    });
    // Every ledger on its own line too, so the joins can be checked.
    const ledgerHead = ["Bucket", "Customer Group", "Ledger", "Company", "Location", "Machines", "Machine Value", "Ink Qty (KG)", "Ink Value", "Heads & Spares", "Other", "Total"];
    const wsL = XLSX.utils.aoa_to_sheet([ledgerHead, ...sorted.flatMap((c) => c.ledgers.map((l) => [
      c.bucket, c.group, l.ledger, l.company, l.location, l.machineQty, Math.round(l.machineVal),
      Math.round(l.inkQty * 100) / 100, Math.round(l.inkVal), Math.round(l.headsSparesVal), Math.round(l.otherVal), Math.round(l.total),
    ]))]);
    wsL["!cols"] = ledgerHead.map((h) => ({ wch: h === "Customer Group" || h === "Ledger" ? 36 : 14 }));
    const info = XLSX.utils.aoa_to_sheet([
      ["Orange vs Non-Orange Customers"],
      ["Window", windowLabel],
      ["Orange", "bought a machine from us in the window (net quantity above zero)"],
      ["Non-Orange", "bought our ink in the window, but no machine from us"],
      ["Customer", "the hub Customer Group; an unmapped ledger stands on its own"],
      ["Lines", "pure sales only — no FOC, branch or related-party lines"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    XLSX.utils.book_append_sheet(wb, wsL, "Ledgers");
    XLSX.utils.book_append_sheet(wb, info, "Report Info");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Orange_vs_NonOrange_Customers_${from}_to_${to}.xlsx`);
  };

  return (
    <SalesPanel title="Customer list" icon={Table2} loading={loading}
                subtitle={`${fmtInt(searched.length)} customers · click a row for its ledgers${canEdit ? " · click a bucket to change it" : ""}`}
                actions={
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer or ledger…"
                             className="h-8 w-56 rounded-input pl-7 text-[12px]" />
                    </div>
                    <ColumnPicker columns={COLUMN_OPTIONS} visible={visible} onChange={pickCols} triggerClassName="h-8 text-[12px]" />
                    <Button onClick={exportXlsx} disabled={!sorted.length}
                            className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90">
                      <Download className="h-3.5 w-3.5" /> Export
                    </Button>
                  </div>
                }>
      {canEdit && !ready && ticked.size > 0 && (
        <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {fmtInt(ticked.size)} ticked — but nothing can be saved until migration 20270115120000 is run in Supabase.
        </div>
      )}
      {canEdit && ready && (ticked.size > 0 || saving || saveErr) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[12px]">
          <span className="font-semibold text-foreground">{fmtInt(ticked.size)} ticked</span>
          <span className="text-muted-foreground">— set them as</span>
          {BUCKETS.map((b) => (
            <Button key={b} size="sm" disabled={saving || !ticked.size} onClick={() => apply([...ticked], b)}
                    className="h-7 rounded-button px-2.5 text-[12px] text-white hover:opacity-90" style={{ background: COLOR[b] }}>
              {b}
            </Button>
          ))}
          <Button size="sm" variant="outline" disabled={saving || !ticked.size} onClick={() => apply([...ticked], null)}
                  className="h-7 rounded-button px-2.5 text-[12px]" title="Hand them back to the rule">
            Auto (rule)
          </Button>
          <button type="button" onClick={() => setTicked(new Set())} disabled={saving}
                  className="text-[11.5px] text-muted-foreground hover:text-foreground hover:underline">Clear ticks</button>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          {saveErr && <span className="text-destructive">Couldn’t save: {saveErr}</span>}
        </div>
      )}
      <ScrollableTable className="rounded-md border border-border" maxHeight="max-h-[62vh]" resizeKey="bushra-orange-customers">
        <table className="w-full border-collapse text-[12.5px]" style={{ minWidth: Math.max(900, cols.length * 110) }}>
          <thead className="sticky top-0 z-10 bg-muted/80">
            <tr className="border-b border-border">
              {canEdit && (
                <th className="w-8 px-2 py-2">
                  <Checkbox aria-label="Tick every customer on this page"
                            checked={page.pageItems.length > 0 && page.pageItems.every((c) => ticked.has(c.group))}
                            onCheckedChange={(on) => setTicked((t) => {
                              const n = new Set(t);
                              for (const c of page.pageItems) { if (on) n.add(c.group); else n.delete(c.group); }
                              return n;
                            })} />
                </th>
              )}
              {cols.map((c) => (
                <th key={c.key} className={cn("whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", c.right ? "text-right" : "text-left")}>
                  <button type="button" onClick={() => toggleSort(c.key, c.right)} title={`Sort by ${c.header}`}
                          className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", sort.key === c.key && "text-foreground")}>
                    {c.header}
                    {sort.key !== c.key ? <ArrowUpDown className="h-3 w-3 opacity-40" />
                      : sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.pageItems.length === 0 ? (
              <tr><td colSpan={cols.length + (canEdit ? 1 : 0)} className="py-8 text-center text-[12px] text-muted-foreground">
                {customers.length ? "No customer matches that search." : "No customers match those filters."}
              </td></tr>
            ) : page.pageItems.map((c) => (
              <Fragment key={c.group}>
                <tr onClick={() => setOpen((o) => (o === c.group ? null : c.group))}
                    className={cn("cursor-pointer border-b border-border/40 hover:bg-muted/40", open === c.group && "bg-muted/30",
                                  ticked.has(c.group) && "bg-primary/5")}>
                  {canEdit && (
                    <td className="w-8 px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label={`Tick ${c.group}`} checked={ticked.has(c.group)} onCheckedChange={() => tick(c.group)} />
                    </td>
                  )}
                  {cols.map((col, i) => (
                    <td key={col.key} className={cn(td, col.right && "text-right tabular-nums")}>
                      {i === 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open === c.group && "rotate-90")} />
                          {col.key === "bucket" && canEdit
                            ? <BucketPicker c={c} disabled={saving} ready={ready} onPick={(b) => apply([c.group], b)} />
                            : col.cell(c)}
                        </span>
                      ) : col.key === "bucket" && canEdit
                        ? <BucketPicker c={c} disabled={saving} ready={ready} onPick={(b) => apply([c.group], b)} />
                        : col.cell(c)}
                    </td>
                  ))}
                </tr>
                {open === c.group && (
                  <tr className="border-b border-border/60 bg-muted/20">
                    <td colSpan={cols.length + (canEdit ? 1 : 0)} className="px-6 py-2">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                            <th className="py-1 pr-3 text-left font-semibold">Ledger</th>
                            <th className="px-3 py-1 text-left font-semibold">Company</th>
                            <th className="px-3 py-1 text-left font-semibold">Location</th>
                            <th className="px-3 py-1 text-right font-semibold">Machines</th>
                            <th className="px-3 py-1 text-right font-semibold">Machine Value</th>
                            <th className="px-3 py-1 text-right font-semibold">Ink Qty</th>
                            <th className="px-3 py-1 text-right font-semibold">Ink Value</th>
                            <th className="px-3 py-1 text-right font-semibold">Heads & Spares</th>
                            <th className="px-3 py-1 text-right font-semibold">Other</th>
                            <th className="pl-3 py-1 text-right font-semibold">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.ledgers.map((l) => (
                            <tr key={`${l.ledger}|${l.company}|${l.location}`} className="border-t border-border/40">
                              <td className="py-1 pr-3">{l.ledger}</td>
                              <td className="px-3 py-1">{l.company}</td>
                              <td className="px-3 py-1">{l.location}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{l.machineQty ? fmtNos(l.machineQty) : "—"}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{l.machineVal ? fmtSales(l.machineVal) : "—"}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{l.inkQty ? fmtKg(l.inkQty) : "—"}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{l.inkVal ? fmtSales(l.inkVal) : "—"}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{l.headsSparesVal ? fmtSales(l.headsSparesVal) : "—"}</td>
                              <td className="px-3 py-1 text-right tabular-nums">{l.otherVal ? fmtSales(l.otherVal) : "—"}</td>
                              <td className="pl-3 py-1 text-right font-medium tabular-nums">{fmtSales(l.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      <Pagination state={page} rowsLabel="customers" />
    </SalesPanel>
  );
}

/** An admin's bucket control: the badge (as everyone sees it) opens Orange / Non-Orange / Auto. */
function BucketPicker({ c, disabled, ready, onPick }: {
  c: CustomerFigures; disabled: boolean; ready: boolean; onPick: (b: Bucket | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (b: Bucket | null) => { setOpen(false); onPick(b); };
  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex flex-wrap items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled} title="Change this customer's bucket"
                  className="inline-flex items-center gap-0.5 rounded-pill px-2 py-0.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  style={{ background: COLOR[c.bucket] }}>
            {c.bucket} <ChevronDown className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1.5">
          <div className="px-2 pb-1 pt-0.5 text-[10.5px] text-muted-foreground">
            {c.group} · the rule says <b>{c.auto}</b>
          </div>
          {!ready && (
            <div className="mx-1 mb-1 rounded bg-amber-50 px-2 py-1 text-[10.5px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Can't save yet — migration 20270115120000 has to be run in Supabase first.
            </div>
          )}
          {BUCKETS.map((b) => (
            <button key={b} type="button" onClick={() => pick(b)} disabled={!ready}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted/60 disabled:opacity-40",
                                  c.manual && c.bucket === b && "font-semibold")}>
              <CircleDot className="h-3.5 w-3.5" style={{ color: COLOR[b] }} /> {b}
              {c.manual && c.bucket === b && <span className="ml-auto text-[10px] text-muted-foreground">set by hand</span>}
            </button>
          ))}
          <button type="button" onClick={() => pick(null)} disabled={!c.manual || !ready}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-md border-t border-border/60 px-2 py-1.5 text-left text-[12.5px] hover:bg-muted/60 disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" /> Auto — follow the rule ({c.auto})
          </button>
        </PopoverContent>
      </Popover>
      {c.manual && (
        <span className="inline-flex items-center gap-0.5 rounded-pill border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary"
              title={`Set by hand — the rule says ${c.auto}`}>
          <Hand className="h-2.5 w-2.5" /> set by hand
        </span>
      )}
      {c.noInk && <span className="rounded-pill border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">no ink yet</span>}
      {!c.grouped && <span className="rounded-pill border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">not grouped</span>}
    </span>
  );
}
