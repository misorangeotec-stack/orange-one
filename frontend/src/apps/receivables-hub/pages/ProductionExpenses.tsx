/**
 * Bushra-Dashboard → Production Expenses.
 *
 * The overhead half of batch costing. The Production Dashboard prices a kilogram at what the batch
 * consumed (₹207.51 across FY 2026-27); this page adds what that figure leaves out — freight,
 * labour, electricity, salaries, commission, finance cost — and states the full cost of a kilogram.
 *
 * Data: lib/productionExpenses.ts (ConnectWave `rpt_expense_line`, Enterprise — Surat only, rolled
 * up to the group Tally's own P&L prints). Production tonnes come from the same loader the
 * dashboard uses, so the two screens cannot disagree about what was made.
 *
 * ─── HOW THE FULL COST IS BUILT ─────────────────────────────────────────────────────────────────
 *
 *   material / KG   Tally's own cost of what each batch consumed, weighted by batch size
 *   + direct / KG   the period's Direct Expenses ÷ the period's output
 *   + indirect / KG the period's Indirect Expenses ÷ the period's output
 *
 * Straight absorption, and deliberately so: nothing in Tally ties an expense to a batch, an item or
 * a colour, so any split by product would be an assumption dressed as a number. Every panel here is
 * therefore cut by YEAR and MONTH only. Purchase Accounts are excluded — that is the material
 * itself, already counted on the batch.
 *
 * CHART RULES (dataviz skill): rupees and ₹/KG never share an axis; Direct keeps one colour and
 * Indirect another wherever they appear; every bar carries its value.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowDown, ArrowLeft, ArrowUp, IndianRupee, Layers, Package, Receipt, RotateCcw, Scale, Wallet,
} from "lucide-react";
import { cn } from "@hub/lib/utils";
import { Button } from "@hub/components/ui/button";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { fmtSales, salesFyOptions, tickSales } from "@hub/lib/salesReport";
import {
  PRODUCTION_COMPANY_LABEL, fmtTonnes, loadBatchCostingYears, productionFyOptions,
} from "@hub/lib/batchCosting";
import {
  fmtInt, fmtPct, fmtPerKg, kpis, monthLabel, monthsSpanning, summariseBatches,
} from "@hub/lib/batchCostingDashboard";
import {
  EXPENSE_BLOCKS, costPerKg, expenseTotals, expensesByLedger, expensesByMonth,
  loadProductionExpenses, type ExpenseBlock, type ExpenseMonth,
} from "@hub/lib/productionExpenses";
import { loadPackingMaterial, packingPerKg, packingTotals } from "@hub/lib/packingMaterial";

const BASE = "/outstanding-dashboard";
const CHART_GRID = "hsl(220 15% 92%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 45%)" };
const LABEL_FILL = "hsl(220 20% 30%)";
const TOOLTIP_BOX = "rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-md";

/** One colour per block, everywhere on the page — and a third for the material it sits on top of. */
const BLOCK_COLOR: Record<ExpenseBlock, string> = {
  "Direct Expenses": "#a16207",
  "Indirect Expenses": "#7c3aed",
};
const MATERIAL_COLOR = "#e77e23";
/** Packing keeps the same teal it has on its own page. */
const PACKING_COLOR = "#0d9488";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const opts = (vals: Iterable<string>): MultiSelectOption[] =>
  [...new Set(vals)].filter(Boolean).sort(collator.compare).map((v) => ({ value: v, label: v }));

type SortKey = "block" | "group" | "ledger" | "amount" | "share" | "lines";

export default function ProductionExpenses() {
  const fyOptions = useMemo(() => productionFyOptions(salesFyOptions()), []);

  const { data: expenseRows, isLoading: expLoading, error } = useQuery({
    queryKey: ["productionExpenses", fyOptions.join(",")],
    queryFn: () => loadProductionExpenses(fyOptions),
    staleTime: 5 * 60 * 1000,
  });
  // The same rows the dashboard reads, so "what was produced" is one number across both screens.
  const { data: batchRows, isLoading: prodLoading } = useQuery({
    queryKey: ["batchCostingAllYears", fyOptions.join(",")],
    queryFn: () => loadBatchCostingYears(fyOptions),
    staleTime: 5 * 60 * 1000,
  });
  // Packing material is neither in the batch nor in the P&L expense groups, but it is part of what
  // a kilogram costs — see lib/packingMaterial.ts.
  const { data: packingRows } = useQuery({
    queryKey: ["packingMaterial", fyOptions.join(",")],
    queryFn: () => loadPackingMaterial(fyOptions),
    staleTime: 5 * 60 * 1000,
  });

  const rows = useMemo(() => expenseRows ?? [], [expenseRows]);
  const batches = useMemo(() => summariseBatches(batchRows ?? []), [batchRows]);

  /* -------- filters: year and month only (see the file header) -------- */
  const [years, setYears] = useState<string[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);

  const pick = (sel: string[], v: string) => !sel.length || sel.includes(v);
  const inPeriod = useMemo(
    () => rows.filter((r) => pick(years, `FY ${r.fy}`) && pick(months, r.month)),
    [rows, years, months],
  );
  const shown = useMemo(
    () => inPeriod.filter((r) => pick(blocks, r.block) && pick(groups, r.group)),
    [inPeriod, blocks, groups],
  );

  const yearOptions = useMemo(() => opts(rows.map((r) => `FY ${r.fy}`)), [rows]);
  const monthOptions = useMemo(
    () => opts(rows.filter((r) => pick(years, `FY ${r.fy}`)).map((r) => r.month)),
    [rows, years],
  );
  const blockOptions = useMemo(() => opts(inPeriod.map((r) => r.block)), [inPeriod]);
  const groupOptions = useMemo(
    () => opts(inPeriod.filter((r) => pick(blocks, r.block)).map((r) => r.group)),
    [inPeriod, blocks],
  );
  const filterCount = years.length + months.length + blocks.length + groups.length;
  const resetAll = () => { setYears([]); setMonths([]); setBlocks([]); setGroups([]); };

  /* -------- figures -------- */
  // Production for the SAME year/month slice: the denominator of every per-KG figure.
  const periodBatches = useMemo(
    () => batches.filter((b) => pick(years, `FY ${b.fy}`) && pick(months, monthLabel(b.month))),
    [batches, years, months],
  );
  const production = useMemo(() => kpis(periodBatches), [periodBatches]);
  const totals = useMemo(() => expenseTotals(inPeriod), [inPeriod]);
  const shownTotals = useMemo(() => expenseTotals(shown), [shown]);
  const perKg = useMemo(
    () => costPerKg(production.costPerKg, totals, production.fgKgs),
    [production, totals],
  );
  const packing = useMemo(() => packingTotals(
    (packingRows ?? []).filter((r) => pick(years, `FY ${r.fy}`) && pick(months, r.month))),
    [packingRows, years, months]);
  const packPerKg = packingPerKg(packing, production.fgKgs) ?? 0;
  const fullPerKg = perKg.materialPerKg == null
    ? null
    : perKg.materialPerKg + packPerKg + (perKg.directPerKg ?? 0) + (perKg.indirectPerKg ?? 0);

  /** Packing consumed per month, to sit in the per-KG stack beside material and overhead. */
  const packByMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of (packingRows ?? [])) {
      if (!pick(years, `FY ${r.fy}`) || !pick(months, r.month)) continue;
      const ym = r.vch_date.slice(0, 6);
      m.set(ym, (m.get(ym) ?? 0) + r.consumedValue);
    }
    return m;
  }, [packingRows, years, months]);

  const monthly: Array<ExpenseMonth & { packingPerKg: number | null }> = useMemo(() => {
    const ms = monthsSpanning(periodBatches.length ? periodBatches : batches);
    const prod = new Map<string, { kgs: number; costPerKg: number | null }>();
    for (const m of ms) {
      const k = kpis(periodBatches.filter((b) => b.month === m));
      prod.set(m, { kgs: k.fgKgs, costPerKg: k.costPerKg });
    }
    return expensesByMonth(inPeriod, ms, prod).map((m) => {
      const packValue = packByMonth.get(m.month) ?? 0;
      const packPer = m.kgs > 0 ? packValue / m.kgs : null;
      return {
        ...m,
        packingPerKg: packPer,
        fullPerKg: m.materialPerKg == null ? null : (m.fullPerKg ?? 0) + (packPer ?? 0),
      };
    });
  }, [inPeriod, periodBatches, batches, packByMonth]);

  const ledgers = useMemo(() => expensesByLedger(shown), [shown]);

  const loading = (expLoading || prodLoading) && !expenseRows;
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
            <Receipt className="h-5 w-5 text-primary" />
            <h1 className="text-[19px] font-bold tracking-tight text-foreground">Expenses</h1>
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
          <Filter label="Type" options={blockOptions} value={blocks} onChange={setBlocks} all="Direct + Indirect" unit="Types" />
          <Filter label="Group" options={groupOptions} value={groups} onChange={setGroups} all="All Groups" unit="Groups" searchable />
          <Button onClick={resetAll} disabled={!filterCount}
                  className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5" /> Reset All
          </Button>
          <span className="ml-auto rounded-pill bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {fmtSales(shownTotals.total)} · {fmtInt(shown.length)} lines
          </span>
        </div>
      </div>

      {errText && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">{errText}</div>
      )}

      {/* ── KPI row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Kpi accent={BLOCK_COLOR["Direct Expenses"]} icon={Receipt} label="Direct expenses" loading={loading}
             value={fmtSales(totals.direct)} exact={`${fmtPerKg(perKg.directPerKg)} / KG`} sub="freight, duty, labour, packing" />
        <Kpi accent={BLOCK_COLOR["Indirect Expenses"]} icon={Wallet} label="Indirect expenses" loading={loading}
             value={fmtSales(totals.indirect)} exact={`${fmtPerKg(perKg.indirectPerKg)} / KG`} sub="salaries, power, selling, finance" />
        <Kpi accent="#0d9488" icon={IndianRupee} label="Total expenses" loading={loading}
             value={fmtSales(totals.total)} exact={`${fmtPerKg((perKg.directPerKg ?? 0) + (perKg.indirectPerKg ?? 0))} / KG`}
             sub="the overhead on top of material" />
        <Kpi accent={MATERIAL_COLOR} icon={Layers} label="Material / KG" loading={loading}
             value={fmtPerKg(perKg.materialPerKg)} exact={fmtTonnes(production.fgKgs)} sub="what the batches consumed" />
        <Kpi accent="#2563eb" icon={Scale} label="Full cost / KG" loading={loading}
             value={fmtPerKg(fullPerKg)} exact="material + packing + direct + indirect"
             sub="absorbed over the period's output" />
        <Kpi accent="#0d9488" icon={Package} label="Packing / KG" loading={loading}
             value={fmtPerKg(packPerKg)} exact={fmtSales(packing.consumedValue)} sub="caps, cans and stickers consumed" />
      </div>

      {/* ── Expense analysis ──────────────────────────────────────────────── */}
      <SectionHeading>Expense analysis</SectionHeading>
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel title="Direct vs Indirect by month" icon={IndianRupee} loading={loading} empty={empty}
                    emptyMessage="No expense lines in this period."
                    subtitle="what the company spent each month, in rupees">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthly} margin={{ top: 18, right: 8, left: 4, bottom: 14 }} barGap={2}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false}
                     axisLine={{ stroke: CHART_GRID }} interval={0} angle={-40} textAnchor="end" height={44} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickSales} width={54} />
              <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<MonthTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="direct" name="Direct" fill={BLOCK_COLOR["Direct Expenses"]} maxBarSize={18} radius={[4, 4, 0, 0]} />
              <Bar dataKey="indirect" name="Indirect" fill={BLOCK_COLOR["Indirect Expenses"]} maxBarSize={18} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>

        <SalesPanel title="What a kilogram cost, month by month" icon={Scale} loading={loading} empty={empty}
                    emptyMessage="No production in this period."
                    subtitle="material on the batch, then the month's overhead spread over the month's output">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthly} margin={{ top: 18, right: 8, left: 4, bottom: 14 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false}
                     axisLine={{ stroke: CHART_GRID }} interval={0} angle={-40} textAnchor="end" height={44} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={54}
                     tickFormatter={(v: number) => `₹${Math.round(v)}`} />
              <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<PerKgTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="materialPerKg" name="Material" stackId="k" fill={MATERIAL_COLOR} maxBarSize={26} />
              <Bar dataKey="packingPerKg" name="Packing" stackId="k" fill={PACKING_COLOR} maxBarSize={26} />
              <Bar dataKey="directPerKg" name="Direct" stackId="k" fill={BLOCK_COLOR["Direct Expenses"]} maxBarSize={26} />
              <Bar dataKey="indirectPerKg" name="Indirect" stackId="k" fill={BLOCK_COLOR["Indirect Expenses"]} maxBarSize={26}
                   radius={[4, 4, 0, 0]}>
                <LabelList dataKey="fullPerKg" position="top"
                           formatter={(v: number) => (v ? `₹${Math.round(v)}` : "")}
                           style={{ fontSize: 9.5, fill: LABEL_FILL, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {EXPENSE_BLOCKS.map((block) => {
          const data = totals.groups
            .filter((g) => g.block === block && (!groups.length || groups.includes(g.group)))
            .map((g) => ({ ...g, value: Math.abs(g.amount) }));
          const blockTotal = block === "Direct Expenses" ? totals.direct : totals.indirect;
          return (
            <SalesPanel
              key={block}
              title={`${block} by group`}
              icon={block === "Direct Expenses" ? Receipt : Wallet}
              loading={loading}
              empty={!data.length}
              emptyMessage="Nothing booked in this period."
              subtitle={`${fmtSales(blockTotal)} · ${fmtPerKg(block === "Direct Expenses" ? perKg.directPerKg : perKg.indirectPerKg)} / KG · as Tally's P&L groups them`}
            >
              <ResponsiveContainer width="100%" height={Math.max(200, data.length * 26 + 30)}>
                <BarChart data={data} layout="vertical" margin={{ top: 4, right: 96, left: 4, bottom: 4 }}>
                  <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickSales} />
                  <YAxis type="category" dataKey="group" tick={{ ...AXIS_TICK, fontSize: 10.5 }} tickLine={false}
                         axisLine={false} width={170} interval={0} />
                  <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }}
                           content={<GroupTooltip kgs={production.fgKgs} />} />
                  <Bar dataKey="value" maxBarSize={16} radius={[0, 4, 4, 0]}>
                    {data.map((g) => (
                      <Cell key={g.group} fill={BLOCK_COLOR[block]} fillOpacity={g.amount < 0 ? 0.45 : 1} />
                    ))}
                    <LabelList dataKey="amount" position="right" formatter={(v: number) => fmtSales(v)}
                               style={{ fontSize: 10, fill: LABEL_FILL, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SalesPanel>
          );
        })}
      </div>

      {/* ── The build-up, in words and figures ────────────────────────────── */}
      <SectionHeading>Full cost of a kilogram</SectionHeading>
      <div className="grid gap-3 lg:grid-cols-3">
        <SalesPanel title="The build-up" icon={Scale} loading={loading}
                    subtitle={`${fmtTonnes(production.fgKgs)} produced in this period`}>
          <div className="space-y-2">
            <CostLine label="Material (on the batch)" value={fmtPerKg(perKg.materialPerKg)} accent={MATERIAL_COLOR}
                      note="Tally's own cost of what each batch consumed, weighted by batch size" />
            <CostLine label="+ Packing material" value={fmtPerKg(packPerKg)} accent={PACKING_COLOR}
                      note={`${fmtSales(packing.consumedValue)} consumed ÷ ${fmtTonnes(production.fgKgs)}`} />
            <CostLine label="+ Direct expenses" value={fmtPerKg(perKg.directPerKg)} accent={BLOCK_COLOR["Direct Expenses"]}
                      note={`${fmtSales(totals.direct)} ÷ ${fmtTonnes(production.fgKgs)}`} />
            <CostLine label="+ Indirect expenses" value={fmtPerKg(perKg.indirectPerKg)} accent={BLOCK_COLOR["Indirect Expenses"]}
                      note={`${fmtSales(totals.indirect)} ÷ ${fmtTonnes(production.fgKgs)}`} />
            <div className="flex items-baseline justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-2">
              <span className="text-[12px] font-semibold text-foreground">Full cost per KG</span>
              <span className="text-[19px] font-bold tabular-nums text-foreground">{fmtPerKg(fullPerKg)}</span>
            </div>
            <p className="text-[10.5px] leading-snug text-muted-foreground">
              Straight absorption: nothing in Tally ties an expense or a cap to a batch, an item or a
              colour, so the period's packing and overhead are spread evenly over the period's output.
              Splitting them by product would be an assumption dressed as a number. Purchase Accounts
              are excluded — that is the material, already counted on the batch — and packing counts
              what was consumed, not warehouse → production moves.{" "}
              <Link to={`${BASE}/bushra-dashboard/packing-material`} className="text-primary hover:underline">
                Packing material
              </Link>.
            </p>
          </div>
        </SalesPanel>

        <SalesPanel className="lg:col-span-2" title="Every expense ledger" icon={IndianRupee} loading={loading}
                    empty={empty} emptyMessage="No expense lines in this period." bodyClassName="p-0"
                    subtitle="the ledgers behind each group, with what they add to a kilogram">
          <LedgerTable rows={ledgers} kgs={production.fgKgs} />
        </SalesPanel>
      </div>
    </div>
  );
}

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
        triggerClassName="h-8 min-w-[150px] text-[12.5px] rounded-input border-border"
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

/** One line of the cost build-up: a coloured tick, what it is, and what it adds per KG. */
function CostLine({ label, value, note, accent }: { label: string; value: string; note?: string; accent: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-1.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[12px] text-foreground">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
          <span className="truncate">{label}</span>
        </div>
        {note && <div className="pl-3.5 text-[10.5px] text-muted-foreground truncate" title={note}>{note}</div>}
      </div>
      <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ tooltips */

function MonthTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ExpenseMonth & { packingPerKg?: number | null } }> }) {
  const m = active && payload?.[0]?.payload;
  if (!m) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{m.label}</div>
      <Row label="Direct" value={fmtSales(m.direct)} colour={BLOCK_COLOR["Direct Expenses"]} />
      <Row label="Indirect" value={fmtSales(m.indirect)} colour={BLOCK_COLOR["Indirect Expenses"]} />
      <div className="mt-1 flex justify-between gap-4 border-t border-border pt-1 font-medium">
        <span>Total</span><span className="tabular-nums">{fmtSales(m.total)}</span>
      </div>
      <div className="text-muted-foreground">{fmtTonnes(m.kgs)} produced</div>
    </div>
  );
}

function PerKgTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ExpenseMonth & { packingPerKg?: number | null } }> }) {
  const m = active && payload?.[0]?.payload;
  if (!m) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{m.label}</div>
      <Row label="Material" value={fmtPerKg(m.materialPerKg)} colour={MATERIAL_COLOR} />
      <Row label="Packing" value={fmtPerKg(m.packingPerKg ?? null)} colour={PACKING_COLOR} />
      <Row label="Direct" value={fmtPerKg(m.directPerKg)} colour={BLOCK_COLOR["Direct Expenses"]} />
      <Row label="Indirect" value={fmtPerKg(m.indirectPerKg)} colour={BLOCK_COLOR["Indirect Expenses"]} />
      <div className="mt-1 flex justify-between gap-4 border-t border-border pt-1 font-medium">
        <span>Full cost / KG</span><span className="tabular-nums">{fmtPerKg(m.fullPerKg)}</span>
      </div>
      <div className="text-muted-foreground">{fmtTonnes(m.kgs)} produced</div>
    </div>
  );
}

function GroupTooltip({ active, payload, kgs }: {
  active?: boolean; kgs: number;
  payload?: Array<{ payload: { group: string; block: ExpenseBlock; amount: number; share: number; lines: number } }>;
}) {
  const g = active && payload?.[0]?.payload;
  if (!g) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{g.group}</div>
      <div className="text-foreground">{fmtSales(g.amount)}</div>
      <div className="text-muted-foreground">
        {fmtPct(g.share)} of {g.block.toLowerCase()} · {g.lines} line{g.lines === 1 ? "" : "s"}
        {kgs > 0 ? ` · ${fmtPerKg(g.amount / kgs)} / KG` : ""}
      </div>
    </div>
  );
}

function Row({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span className="h-2 w-2 rounded-full" style={{ background: colour }} />{label}
      </span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ ledger table */

const COLS: Array<{ key: SortKey; label: string; right?: boolean; w: number }> = [
  { key: "block", label: "Type", w: 130 },
  { key: "group", label: "P&L group", w: 200 },
  { key: "ledger", label: "Ledger", w: 260 },
  { key: "amount", label: "Amount", right: true, w: 130 },
  { key: "share", label: "Share", right: true, w: 90 },
  { key: "lines", label: "Lines", right: true, w: 80 },
];

function LedgerTable({ rows, kgs }: { rows: ReturnType<typeof expensesByLedger>; kgs: number }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "amount", dir: "desc" });
  const sorted = useMemo(() => {
    const s = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      const r = typeof x === "number" || typeof y === "number"
        ? (Number(x) || 0) - (Number(y) || 0)
        : collator.compare(String(x ?? ""), String(y ?? ""));
      return r * s || collator.compare(a.ledger, b.ledger);
    });
  }, [rows, sort]);
  const page = usePagination(sorted, { pageSize: 12, resetKey: `${rows.length}|${sort.key}|${sort.dir}` });

  return (
    <div>
      <ScrollableTable className="border-b border-border" maxHeight="max-h-[460px]">
        <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
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
              <th className="w-[100px] px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-wide text-foreground/70">₹ / KG</th>
            </tr>
          </thead>
          <tbody>
            {page.pageItems.map((l) => (
              <tr key={`${l.block}|${l.group}|${l.ledger}`} className="border-t border-border/50 hover:bg-muted/40">
                <td className="px-3 py-1.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="h-2 w-2 rounded-full" style={{ background: BLOCK_COLOR[l.block] }} />
                    {l.block.replace(" Expenses", "")}
                  </span>
                </td>
                <td className="max-w-0 truncate px-3 py-1.5 text-muted-foreground" title={l.group}>{l.group}</td>
                <td className="max-w-0 truncate px-3 py-1.5 text-foreground" title={l.ledger}>{l.ledger}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmtSales(l.amount)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtPct(l.share)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{l.lines}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{kgs > 0 ? fmtPerKg(l.amount / kgs) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      <div className="px-3 py-2">
        <Pagination state={page} rowsLabel="ledgers" />
      </div>
    </div>
  );
}
