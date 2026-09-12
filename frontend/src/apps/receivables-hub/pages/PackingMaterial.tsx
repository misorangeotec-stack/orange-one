/**
 * Bushra-Dashboard → Production - Batch Costing → Packing Material.
 *
 * Every outward entry of packing material — caps, cans, stickers, cartons — for Enterprise — Surat:
 * what left stock, on which voucher, and what of it was really consumed.
 *
 * ─── OUTWARD vs CONSUMED ────────────────────────────────────────────────────────────────────────
 *
 * Tally's Stock Group Summary prints every outward, and so does the table here. But a
 * "STOCK TRANSFER TO PRODUCTION" voucher carries an equal inward of the same item — the cap is
 * being moved from the warehouse to the floor, not used — so it is shown, flagged "Transfer", and
 * NOT costed. What survives the netting is consumption, and that is what a kilogram is charged.
 * The reasoning, and the figures it was checked against, are in lib/packingMaterial.ts.
 *
 * ─── WHAT EACH CAP PACKED ───────────────────────────────────────────────────────────────────────
 *
 * The voucher that issues the packing also brings the packed goods back in, so every consumption
 * line is tied to the finished good on its own voucher — its item, colour and sub-group. That is
 * why this page can filter by colour, and why the dashboard charges a cap to the colour it went on
 * rather than spreading it over everything. A voucher that produced nothing (a purchase return)
 * belongs to no product and is counted only in the totals.
 *
 * Production tonnes come from the same loader the dashboard uses, so "per KG" means the same thing
 * on every screen.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowDown, ArrowLeft, ArrowUp, Boxes, Droplet, IndianRupee, Layers, Package, RotateCcw, Scale,
  Tag, Truck,
} from "lucide-react";
import { cn } from "@hub/lib/utils";
import { Button } from "@hub/components/ui/button";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { fmtSales, salesFyOptions, tickSales } from "@hub/lib/salesReport";
import { tallyDate } from "@hub/lib/stockSummary";
import {
  PRODUCTION_COMPANY_LABEL, fmtTonnes, loadBatchCostingYears, productionFyOptions,
} from "@hub/lib/batchCosting";
import {
  fmtInt, fmtPerKg, kpis, monthLabel, monthsSpanning, summariseBatches,
} from "@hub/lib/batchCostingDashboard";
import {
  loadPackingMaterial, packingBy, packingByMonth, packingByPacked, packingPerKg, packingTotals,
  type PackingMonth, type PackingRow,
} from "@hub/lib/packingMaterial";

const BASE = "/outstanding-dashboard";
const CHART_GRID = "hsl(220 15% 92%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 45%)" };
const LABEL_FILL = "hsl(220 20% 30%)";
const TOOLTIP_BOX = "rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-md";
/** Consumed keeps one colour everywhere on the page; a netted-off transfer keeps the other. */
const CONSUMED = "#0d9488";
const TRANSFER = "hsl(220 12% 72%)";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const opts = (vals: Iterable<string>): MultiSelectOption[] =>
  [...new Set(vals)].filter(Boolean).sort(collator.compare).map((v) => ({ value: v, label: v }));
const nf0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

type SortKey = "vch_date" | "voucher_no" | "voucher_type" | "item" | "group" | "fgItem" | "fgColour"
  | "qty" | "rate" | "value" | "consumedValue";

export default function PackingMaterial() {
  const fyOptions = useMemo(() => productionFyOptions(salesFyOptions()), []);

  const { data: packRows, isLoading: packLoading, error } = useQuery({
    queryKey: ["packingMaterial", fyOptions.join(",")],
    queryFn: () => loadPackingMaterial(fyOptions),
    staleTime: 5 * 60 * 1000,
  });
  const { data: batchRows, isLoading: prodLoading } = useQuery({
    queryKey: ["batchCostingAllYears", fyOptions.join(",")],
    queryFn: () => loadBatchCostingYears(fyOptions),
    staleTime: 5 * 60 * 1000,
  });
  const rows = useMemo(() => packRows ?? [], [packRows]);
  const batches = useMemo(() => summariseBatches(batchRows ?? []), [batchRows]);

  /* -------- filters -------- */
  const [years, setYears] = useState<string[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [items, setItems] = useState<string[]>([]);
  const [fgColours, setFgColours] = useState<string[]>([]);
  const [fgCats, setFgCats] = useState<string[]>([]);
  const [showTransfers, setShowTransfers] = useState(true);

  const pick = (sel: string[], v: string) => !sel.length || sel.includes(v);
  const inPeriod = useMemo(
    () => rows.filter((r) => pick(years, `FY ${r.fy}`) && pick(months, r.month)),
    [rows, years, months],
  );
  /**
   * A line is kept when ANY of the goods it packed matches the colour and sub-group asked for. A
   * line that packed nothing drops out the moment either of those is narrowed — it belongs to no
   * product, so it cannot honestly answer for one.
   */
  const packedMatch = (r: PackingRow) =>
    (!fgColours.length && !fgCats.length) ||
    r.packed.some((pk) => pick(fgColours, pk.colour || "(No colour)") &&
                          pick(fgCats, pk.category || "(None)"));
  const shown = useMemo(
    () => inPeriod.filter((r) =>
      pick(types, r.voucher_type) && pick(groups, r.group) && pick(items, r.item) && packedMatch(r) &&
      (showTransfers || !r.isTransfer)),
    [inPeriod, types, groups, items, fgColours, fgCats, showTransfers],
  );

  const yearOptions = useMemo(() => opts(rows.map((r) => `FY ${r.fy}`)), [rows]);
  const monthOptions = useMemo(
    () => opts(rows.filter((r) => pick(years, `FY ${r.fy}`)).map((r) => r.month)), [rows, years]);
  const typeOptions = useMemo(() => opts(inPeriod.map((r) => r.voucher_type)), [inPeriod]);
  const groupOptions = useMemo(() => opts(inPeriod.map((r) => r.group)), [inPeriod]);
  const itemOptions = useMemo(
    () => opts(inPeriod.filter((r) => pick(groups, r.group)).map((r) => r.item)), [inPeriod, groups]);
  const colourOptions = useMemo(
    () => opts(inPeriod.flatMap((r) => r.packed.map((pk) => pk.colour || "(No colour)"))), [inPeriod]);
  const fgCatOptions = useMemo(
    () => opts(inPeriod.flatMap((r) => r.packed
      .filter((pk) => pick(fgColours, pk.colour || "(No colour)"))
      .map((pk) => pk.category || "(None)"))), [inPeriod, fgColours]);
  const filterCount = years.length + months.length + types.length + groups.length + items.length +
    fgColours.length + fgCats.length + (showTransfers ? 0 : 1);
  const resetAll = () => {
    setYears([]); setMonths([]); setTypes([]); setGroups([]); setItems([]);
    setFgColours([]); setFgCats([]); setShowTransfers(true);
  };

  /* -------- figures -------- */
  const periodBatches = useMemo(
    () => batches.filter((b) => pick(years, `FY ${b.fy}`) && pick(months, monthLabel(b.month))),
    [batches, years, months],
  );
  const production = useMemo(() => kpis(periodBatches), [periodBatches]);
  const totals = useMemo(() => packingTotals(inPeriod), [inPeriod]);
  const shownTotals = useMemo(() => packingTotals(shown), [shown]);
  const perKg = packingPerKg(totals, production.fgKgs);

  const byGroup = useMemo(() => packingBy(shown, (r) => r.group).slice(0, 12), [shown]);
  const byItem = useMemo(() => packingBy(shown, (r) => r.item).slice(0, 12), [shown]);
  const byType = useMemo(() => packingBy(inPeriod, (r) => r.voucher_type), [inPeriod]);
  const byColour = useMemo(
    () => packingByPacked(shown, (pk) => pk.colour || "(No colour)").slice(0, 12), [shown]);
  const byFgCat = useMemo(
    () => packingByPacked(shown, (pk) => pk.category || "(None)").slice(0, 12), [shown]);
  const monthly: PackingMonth[] = useMemo(() => {
    const ms = monthsSpanning(periodBatches.length ? periodBatches : batches);
    const kgs = new Map<string, number>();
    for (const m of ms) kgs.set(m, kpis(periodBatches.filter((b) => b.month === m)).fgKgs);
    return packingByMonth(inPeriod, ms, kgs);
  }, [inPeriod, periodBatches, batches]);

  const loading = (packLoading || prodLoading) && !packRows;
  const errText = error ? (error as Error).message : null;
  const empty = !loading && !errText && !shown.length;

  return (
    <div className="p-4 lg:p-6 max-w-[1700px] mx-auto space-y-3">
      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="min-w-0">
          <Link to={`${BASE}/bushra-dashboard?group=production-batch-costing`}
                className="mb-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Production - Batch Costing
          </Link>
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <h1 className="text-[19px] font-bold tracking-tight text-foreground">Packing Material</h1>
            <span className="text-[12px] text-muted-foreground">· {PRODUCTION_COMPANY_LABEL}</span>
          </div>
        </div>
        <Link to={`${BASE}/bushra-dashboard/production-batch-costing`} className="text-[11px] text-primary hover:underline">
          Back to the dashboard
        </Link>
      </div>

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-surface px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Filter label="Year" options={yearOptions} value={years} onChange={setYears} all="All Years" unit="Years" />
          <Filter label="Month" options={monthOptions} value={months} onChange={setMonths} all="All Months" unit="Months" searchable />
          <Filter label="Voucher type" options={typeOptions} value={types} onChange={setTypes} all="All Vouchers" unit="Types" searchable />
          <Filter label="Sub-group" options={groupOptions} value={groups} onChange={setGroups} all="All Sub-Groups" unit="Sub-Groups" searchable />
          <Filter label="Item" options={itemOptions} value={items} onChange={setItems} all="All Items" unit="Items" searchable />
          <Filter label="Colour" options={colourOptions} value={fgColours} onChange={setFgColours} all="All Colours" unit="Colours" searchable />
          <Filter label="Packed into" options={fgCatOptions} value={fgCats} onChange={setFgCats} all="All Goods" unit="Sub-Groups" searchable />
          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <input type="checkbox" checked={showTransfers} onChange={(e) => setShowTransfers(e.target.checked)}
                   className="h-3.5 w-3.5 accent-current" />
            Show godown transfers
          </label>
          <Button onClick={resetAll} disabled={!filterCount}
                  className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5" /> Reset All
          </Button>
          <span className="ml-auto rounded-pill bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {fmtInt(shown.length)} entries · {fmtSales(shownTotals.consumedValue)} consumed
          </span>
        </div>
      </div>

      {errText && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">{errText}</div>
      )}

      {/* ── KPI row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Kpi accent={CONSUMED} icon={Package} label="Packing consumed" loading={loading}
             value={fmtSales(totals.consumedValue)} exact={`${nf0.format(totals.consumedQty)} pcs`}
             sub="what really left stock" />
        <Kpi accent="#2563eb" icon={Scale} label="Packing / KG" loading={loading}
             value={fmtPerKg(perKg)} exact={fmtTonnes(production.fgKgs)} sub="over the period's output" />
        <Kpi accent={TRANSFER} icon={Truck} label="Godown transfers" loading={loading}
             value={fmtSales(totals.transferValue)} exact="netted off, not costed"
             sub="warehouse → production moves" />
        <Kpi accent="#a16207" icon={IndianRupee} label="Total outwards" loading={loading}
             value={fmtSales(totals.outwardValue)} exact={`${nf0.format(totals.outwardQty)} pcs`}
             sub="as Tally's Stock Group Summary prints it" />
        <Kpi accent="#7c3aed" icon={Tag} label="Tied to a product" loading={loading}
             value={fmtSales(totals.consumedValue - totals.unattributedValue)}
             exact={totals.unattributedValue > 0.5 ? `${fmtSales(totals.unattributedValue)} could not be` : "all of it"}
             sub="charged to the goods it packed" />
        <Kpi accent="#e77e23" icon={Boxes} label="Entries" loading={loading}
             value={fmtInt(totals.lines)} exact={`${fmtInt(inPeriod.filter((r) => r.isTransfer).length)} transfers`}
             sub="outward voucher lines" />
      </div>

      {/* ── Analysis ──────────────────────────────────────────────────────── */}
      <SectionHeading>Packing analysis</SectionHeading>
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel title="Consumed by month" icon={IndianRupee} loading={loading} empty={empty}
                    emptyMessage="No packing entries in this period."
                    subtitle="what was used each month, with the godown moves that were netted off">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthly} margin={{ top: 18, right: 8, left: 4, bottom: 14 }} barGap={2}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false}
                     axisLine={{ stroke: CHART_GRID }} interval={0} angle={-40} textAnchor="end" height={44} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickSales} width={54} />
              <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<MonthTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="consumedValue" name="Consumed" fill={CONSUMED} maxBarSize={18} radius={[4, 4, 0, 0]} />
              <Bar dataKey="transferValue" name="Transferred" fill={TRANSFER} maxBarSize={18} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>

        <SalesPanel title="Packing per KG by month" icon={Scale} loading={loading} empty={empty}
                    emptyMessage="No production in this period."
                    subtitle="the month's packing consumption over the month's output">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthly} margin={{ top: 18, right: 8, left: 4, bottom: 14 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false}
                     axisLine={{ stroke: CHART_GRID }} interval={0} angle={-40} textAnchor="end" height={44} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={54}
                     tickFormatter={(v: number) => `₹${Math.round(v)}`} />
              <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<PerKgTooltip />} />
              <Bar dataKey="perKg" name="₹ / KG" fill={CONSUMED} maxBarSize={26} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="perKg" position="top" formatter={(v: number) => (v ? `₹${v.toFixed(1)}` : "")}
                           style={{ fontSize: 9.5, fill: LABEL_FILL, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <HBarPanel title="Consumed by colour" icon={Droplet} loading={loading} rows={byColour} empty={empty}
                   note="the colour of the goods each voucher packed" />
        <HBarPanel title="Consumed by finished good" icon={Tag} loading={loading} rows={byFgCat} empty={empty}
                   note="the sub-group the packing went on, not the packing's own" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <HBarPanel title="Consumed by sub-group" icon={Layers} loading={loading} rows={byGroup} empty={empty} />
        <HBarPanel title="Consumed by item" icon={Package} loading={loading} rows={byItem} empty={empty} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <SalesPanel title="By voucher type" icon={Truck} loading={loading} empty={empty} emptyMessage="Nothing here."
                    subtitle="where packing leaves stock — and what of it is a move, not a use">
          <ul className="space-y-2 text-[12px]">
            {byType.map((t) => {
              const moved = t.outwardValue - t.consumedValue;
              return (
                <li key={t.name}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-foreground" title={t.name}>{t.name}</span>
                    <span className="shrink-0 tabular-nums text-foreground">{fmtSales(t.consumedValue)}</span>
                  </div>
                  <div className="mt-0.5 flex h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
                    <div style={{ width: `${pct(t.consumedValue, t.outwardValue)}%`, background: CONSUMED }} />
                    <div style={{ width: `${pct(moved, t.outwardValue)}%`, background: TRANSFER }} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[10.5px] text-muted-foreground tabular-nums">
                    <span>{t.lines} entries</span>
                    <span>{moved > 0.5 ? `${fmtSales(moved)} moved, not used` : "all consumed"}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </SalesPanel>

        <SalesPanel className="lg:col-span-2" title="Every outward entry" icon={Boxes} loading={loading} empty={empty}
                    emptyMessage="No packing entries in this period." bodyClassName="p-0"
                    subtitle="production, repacking, warehouse — every line, with what of it was consumed">
          <EntryTable rows={shown} />
        </SalesPanel>
      </div>
    </div>
  );
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);

/* ------------------------------------------------------------------ pieces */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function Filter({ label, options, value, onChange, all, unit, searchable }: {
  label: string; options: MultiSelectOption[]; value: string[]; onChange: (v: string[]) => void;
  all: string; unit: string; searchable?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">{label}</span>
      <MultiSelectFilter
        options={options} value={value} onChange={onChange} allLabel={all} unit={unit} searchable={searchable}
        triggerClassName="h-8 min-w-[140px] text-[12.5px] rounded-input border-border"
      />
    </div>
  );
}

function Kpi({ accent, icon: Icon, label, value, exact, sub, loading }: {
  accent: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string; value: string; exact?: string; sub?: string; loading?: boolean;
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-3 py-2 shadow-sm" title={exact ? `${value} · ${exact}` : value}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <div className="mt-1 h-5 w-2/3 animate-pulse rounded bg-muted/60" />
      ) : (
        <div className="text-[19px] font-bold leading-tight text-foreground truncate">{value}</div>
      )}
      {exact && <div className="text-[11px] font-medium leading-snug tabular-nums text-foreground/70 truncate">{exact}</div>}
      {sub && <div className="text-[10px] leading-snug text-muted-foreground truncate">{sub}</div>}
      <div className="mt-1.5 h-[3px] w-full rounded-full" style={{ background: `${accent}33` }}>
        <div className="h-full w-1/3 rounded-full" style={{ background: accent }} />
      </div>
    </div>
  );
}

/** A ranked horizontal bar chart of consumption — the top rows, biggest first. */
function HBarPanel({ title, icon, rows, loading, empty, note }: {
  title: string; icon: React.ComponentType<{ className?: string }>; loading?: boolean; empty?: boolean;
  note?: string;
  rows: Array<{ name: string; consumedValue: number; consumedQty: number; lines: number; uom: string | null }>;
}) {
  return (
    <SalesPanel title={title} icon={icon as never} loading={loading} empty={empty || !rows.length}
                emptyMessage="Nothing consumed here."
                subtitle={note ?? "by value consumed, biggest first"}>
      <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 26 + 30)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 86, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={CHART_GRID} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickSales} />
          <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false}
                 axisLine={false} width={190} interval={0} />
          <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<SliceTooltip />} />
          <Bar dataKey="consumedValue" maxBarSize={14} radius={[0, 4, 4, 0]}>
            {rows.map((r) => <Cell key={r.name} fill={CONSUMED} />)}
            <LabelList dataKey="consumedValue" position="right" formatter={(v: number) => fmtSales(v)}
                       style={{ fontSize: 10, fill: LABEL_FILL, fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </SalesPanel>
  );
}

/* ------------------------------------------------------------------ tooltips */

function MonthTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PackingMonth }> }) {
  const m = active && payload?.[0]?.payload;
  if (!m) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{m.label}</div>
      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Consumed</span><span className="tabular-nums">{fmtSales(m.consumedValue)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Transferred</span><span className="tabular-nums">{fmtSales(m.transferValue)}</span></div>
      {m.perKg != null && <div className="mt-1 border-t border-border pt-1 text-muted-foreground">{fmtPerKg(m.perKg)} / KG</div>}
    </div>
  );
}

function PerKgTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PackingMonth }> }) {
  const m = active && payload?.[0]?.payload;
  if (!m) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{m.label}</div>
      <div className="text-foreground">{fmtPerKg(m.perKg)} / KG</div>
      <div className="text-muted-foreground">{fmtSales(m.consumedValue)} consumed</div>
    </div>
  );
}

function SliceTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; consumedValue: number; consumedQty: number; lines: number; uom: string | null } }>;
}) {
  const s = active && payload?.[0]?.payload;
  if (!s) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{s.name}</div>
      <div className="text-foreground">{fmtSales(s.consumedValue)}</div>
      <div className="text-muted-foreground">
        {nf0.format(s.consumedQty)} {s.uom ?? "pcs"} · {s.lines} entr{s.lines === 1 ? "y" : "ies"}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ table */

const COLS: Array<{ key: SortKey; label: string; right?: boolean; w: number }> = [
  { key: "vch_date", label: "Date", w: 84 },
  { key: "voucher_type", label: "Voucher type", w: 200 },
  { key: "voucher_no", label: "Vch no.", w: 130 },
  { key: "item", label: "Item", w: 250 },
  { key: "group", label: "Sub-group", w: 160 },
  { key: "fgItem", label: "Packed into", w: 240 },
  { key: "fgColour", label: "Colour", w: 96 },
  { key: "qty", label: "Out qty", right: true, w: 100 },
  { key: "rate", label: "Rate", right: true, w: 80 },
  { key: "value", label: "Out value", right: true, w: 110 },
  { key: "consumedValue", label: "Consumed", right: true, w: 120 },
];

function EntryTable({ rows }: { rows: PackingRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "vch_date", dir: "desc" });
  const sorted = useMemo(() => {
    const s = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      const r = typeof x === "number" || typeof y === "number"
        ? (Number(x) || 0) - (Number(y) || 0)
        : collator.compare(String(x ?? ""), String(y ?? ""));
      return r * s || collator.compare(a.item, b.item);
    });
  }, [rows, sort]);
  const page = usePagination(sorted, { pageSize: 12, resetKey: `${rows.length}|${sort.key}|${sort.dir}` });

  return (
    <div>
      <ScrollableTable className="border-b border-border" maxHeight="max-h-[460px]">
        <table className="w-full min-w-[1500px] border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-muted/70">
            <tr>
              {COLS.map((c) => (
                <th key={c.key} style={{ width: c.w }}
                    onClick={() => setSort((p) => ({ key: c.key, dir: p.key === c.key && p.dir === "desc" ? "asc" : "desc" }))}
                    className={cn("cursor-pointer select-none whitespace-nowrap px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-foreground/70",
                                  c.right ? "text-right" : "text-left")}>
                  <span className={cn("inline-flex items-center gap-1", c.right && "w-full justify-end")}>
                    {c.label}
                    {sort.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.pageItems.map((r, i) => (
              <tr key={`${r.voucher_guid}|${r.item}|${i}`}
                  className={cn("border-t border-border/50 hover:bg-muted/40", r.isTransfer && "text-muted-foreground")}>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{tallyDate(r.vch_date)}</td>
                <td className="max-w-0 truncate px-3 py-1.5" title={r.voucher_type}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.isTransfer ? TRANSFER : CONSUMED }} />
                    {r.voucher_type}
                  </span>
                </td>
                <td className="max-w-0 truncate px-3 py-1.5 text-muted-foreground" title={r.voucher_no}>{r.voucher_no}</td>
                <td className="max-w-0 truncate px-3 py-1.5 text-foreground" title={r.item}>{r.item}</td>
                <td className="max-w-0 truncate px-3 py-1.5 text-muted-foreground" title={r.group}>{r.group}</td>
                <td className="max-w-0 truncate px-3 py-1.5 text-foreground"
                    title={r.packed.length > 1
                      ? `${r.packed.length} goods: ${r.packed.map((pk) => pk.item).join(", ")}`
                      : r.fgItem}>
                  {r.fgItem || <span className="text-[11px] text-muted-foreground">—</span>}
                  {r.packed.length > 1 && (
                    <span className="ml-1 text-[10.5px] text-muted-foreground">+{r.packed.length - 1}</span>
                  )}
                </td>
                <td className="max-w-0 truncate px-3 py-1.5 text-muted-foreground" title={r.fgColour}>{r.fgColour}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{nf0.format(r.qty)} {r.uom ?? ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums italic text-muted-foreground">{r.rate == null ? "" : r.rate.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtSales(r.value)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                  {r.isTransfer ? <span className="text-[11px] font-normal text-muted-foreground">transfer</span> : fmtSales(r.consumedValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      <div className="px-3 py-2">
        <Pagination state={page} rowsLabel="entries" />
      </div>
    </div>
  );
}
