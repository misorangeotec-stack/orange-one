import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { appBasePath, appName } from "../../appInfo";
import { fmtDate, STATE_LABEL, type StockLot } from "../lib/expiry";
import { useExpiryStatus } from "../lib/useExpiryStatus";
import FreshnessBar from "../components/FreshnessBar";
import {
  ActiveFilters, DAYS_LEFT_BANDS, daysLeftBand, QTY_BANDS, qtyBand,
  SortFilterBody, SortFilterHead, useSortFilter, type Col,
} from "../components/SortFilterHead";
import {
  fmtKg, fmtMeasure, fmtMoney, MEASURE_LABEL, STATE_SERIES, Tile, zero, type Measure, type StateKey, type Totals,
} from "../components/StockCharts";
import { ChartPanel, HBarChart, StateKeyRow, type BarPoint } from "../components/ExpiryCharts";
import { classify, NOT_IN_MASTER, useItemLookup } from "../lib/masters";
import ConsumeFirst, { type PlanRow } from "../components/ConsumeFirst";

/**
 * INK EXPIRY — dashboard, laid out as asked on 30-09-2026:
 *   Filters   expiry month · category · company · group (+ quantity / value / lots)
 *   Charts    company-wise · category-wise · group-wise, side by side — horizontal bars,
 *             reader-sized (drag strip for height, Bars − / + for thickness)
 *   Summary   tiles, a per-company table and the lot list
 *
 * NAMES. "Category" and "Group" come from CENTRAL MASTERS with the Bushra Central Master
 * corrections on top (lib/masters.ts) — the same values the Bushra Sales / Purchase reports show.
 * Tally's own stock category is NOT used: it is 'Not Applicable' for about half the ink items.
 *
 * CLICKS. A column click is a cross-filter: every OTHER chart and the summary narrow to it, and the
 * clicked chart keeps all its columns with the picked one highlighted. A click anywhere else on the
 * page clears it (the filter bar, the tables and the chart headers stop their own clicks, so using
 * them does not). The top filters are separate and stay until changed.
 *
 * ⚠ KGS ONLY — Tally's ink groups also hold ~1.2 lakh MTR of foil paper and a few PCS items.
 * ⚠ VALUE = qty × the item's Tally closing rate, so company totals match Tally's closing value.
 */

const APP = appName("ink-expiry");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Dim = "company" | "category" | "group";

interface Row {
  company: string;
  /** Ink type (Tally stock category). */
  category: string;
  /** Tally stock group. */
  group: string;
  item: string;
  state: StateKey;
  qty: number;
  value: number;
  lots: number;
  /** 'expired' · 'YYYY-MM' · 'none' (no expiry in Tally) · 'nolot'. */
  month: string;
  lot?: StockLot;
}

const add = (t: Totals, r: { qty: number; value: number; lots: number }) => { t.qty += r.qty; t.value += r.value; t.lots += r.lots; };
const emptyParts = (): Record<StateKey, Totals> => ({ updated: zero(), expired: zero(), missing: zero(), nolot: zero() });
const STATE_NAME = Object.fromEntries(STATE_SERIES.map((s) => [s.key, s.label])) as Record<StateKey, string>;
const DIM_NAME: Record<Dim, string> = { company: "Company", category: "Category", group: "Group" };

/** A chart box's starting height: just enough for its bars, between 150 and 320 px; the reader drags from there. */
const fitHeight = (n: number) => Math.min(320, Math.max(150, n * 32 + 48));

/** A borderless, 32px dropdown trigger — the wrapper around it draws the box and holds the field name. */
const FILTER_TRIGGER = "h-8 w-full min-w-0 rounded-lg border-0 bg-transparent px-2 py-0 text-[12.5px] text-ink shadow-none ring-0 focus:ring-0";

const pickCG = (c: { category: string; group: string }) => ({ category: c.category, group: c.group });

const monthLabel = (m: string) =>
  m === "expired" ? "Already expired" : m === "none" ? "No expiry in Tally" : m === "nolot" ? "No lot" : `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const monthOrder = (m: string) => (m === "expired" ? "0" : m === "none" ? "8" : m === "nolot" ? "9" : `1${m}`);

function points(rows: Row[], dim: Dim, measure: Measure): BarPoint[] {
  const m = new Map<string, BarPoint>();
  for (const r of rows) {
    const k = r[dim] || "(none)";
    let p = m.get(k);
    if (!p) m.set(k, (p = { key: k, label: k, parts: emptyParts() }));
    add(p.parts[r.state], r);
  }
  const tot = (p: BarPoint) => STATE_SERIES.reduce((n, s) => n + p.parts[s.key][measure], 0);
  return [...m.values()].filter((p) => tot(p) > 0).sort((a, b) => tot(b) - tot(a));
}

/** The lots in the current view, sortable and filterable per column. */
function LotTable({ rows, today, scope }: { rows: Row[]; today: string; scope?: string }) {
  const status = (r: Row) => (r.lot ? STATE_LABEL[r.lot.state] : "No lot");
  const cols: Col<Row>[] = useMemo(() => [
    { key: "company", label: "Company", text: (r) => r.company, sort: (r) => r.company },
    { key: "item", label: "Stock item", text: (r) => r.item, sort: (r) => r.item,
      render: (r) => <div className="font-medium text-ink">{r.item}</div> },
    { key: "category", label: "Category", text: (r) => r.category, sort: (r) => r.category },
    { key: "group", label: "Group", text: (r) => r.group || "(none)", sort: (r) => r.group,
      render: (r) => <span className="text-grey">{r.group}</span> },
    { key: "lot", label: "Lot no.", text: (r) => r.lot?.lot ?? "(no lot)", sort: (r) => r.lot?.lot ?? null, className: "font-mono",
      render: (r) => r.lot?.lot ?? <span className="font-sans text-grey-2">no lot</span> },
    { key: "qty", label: "Qty", align: "right", text: (r) => fmtKg(r.qty), sort: (r) => r.qty,
      bucket: (r) => qtyBand(r.qty), bucketOrder: QTY_BANDS },
    { key: "value", label: "Value", align: "right", text: (r) => fmtMoney(r.value), sort: (r) => r.value, filter: false },
    // The date the stock now on hand came in — its production (or purchase) voucher. Shown beside the
    // expiry so a date that falls BEFORE it (a typing slip in Tally) is visible at a glance.
    { key: "inward", label: "Prod. / purchase date", text: (r) => (r.lot?.inward ? fmtDate(r.lot.inward) : "—"), sort: (r) => r.lot?.inward ?? null,
      bucket: (r) => (r.lot?.inward ? monthLabel(r.lot.inward.slice(0, 7)) : "Unknown") },
    { key: "expiry", label: "Expiry", text: (r) => (r.lot?.expiry ? fmtDate(r.lot.expiry) : "—"), sort: (r) => r.lot?.expiry ?? null,
      bucket: (r) => monthLabel(r.month),
      render: (r) => r.lot?.expiry ? fmtDate(r.lot.expiry) : <span className="text-grey-2">{r.lot?.expiryRaw ? `“${r.lot.expiryRaw}”` : "—"}</span> },
    { key: "days", label: "Days left", align: "right", text: (r) => String(r.lot?.days ?? "—"), sort: (r) => r.lot?.days ?? null,
      bucket: (r) => daysLeftBand(r.lot?.days ?? null), bucketOrder: DAYS_LEFT_BANDS,
      render: (r) => <span className={r.lot?.days != null && r.lot.days < 0 ? "font-semibold text-ryg-red" : ""}>{r.lot?.days ?? "—"}</span> },
    { key: "status", label: "Status", text: status, sort: status },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => [...rows].sort((a, b) => b.qty - a.qty), [rows]);
  const ctl = useSortFilter(base, cols);
  const pg = usePagination(ctl.view, { pageSize: 25, resetKey: `${rows.length}|${ctl.stamp}` });

  const exportIt = () => exportRowsToXlsx({
    fileName: "Ink_Expiry_Dashboard_Lots",
    sheetName: "Lots",
    title: `${APP} — lots in the dashboard view`,
    rows: ctl.view,
    notes: ["KGS stock only. Value = quantity × the item's Tally closing rate.", `As at ${fmtDate(today)}.`],
    columns: [
      { header: "Company", width: 18, value: (r) => r.company },
      { header: "Category", width: 18, value: (r) => r.category },
      { header: "Group (stock group)", width: 30, value: (r) => r.group },
      { header: "Stock item", width: 40, value: (r) => r.item },
      { header: "Lot no.", width: 22, value: (r) => r.lot?.lot ?? "(no lot)" },
      { header: "Qty (KGS)", width: 12, value: (r) => r.qty },
      { header: "Value (₹)", width: 14, value: (r) => Math.round(r.value) },
      { header: "Godown", width: 18, value: (r) => r.lot?.godown ?? "" },
      { header: "Prod. / purchase date", width: 14, value: (r) => (r.lot?.inward ? fmtDate(r.lot.inward) : "") },
      { header: "Expiry date", width: 13, value: (r) => (r.lot?.expiry ? fmtDate(r.lot.expiry) : r.lot?.expiryRaw ?? "") },
      { header: "Days left", width: 9, value: (r) => r.lot?.days ?? "" },
      { header: "Status", width: 18, value: status },
    ],
  });

  return (
    <div className="rounded-xl border border-line bg-white shadow-sm" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2.5">
        <div className="flex-1">
          <h3 className="text-[15px] font-bold text-navy">
            Lots in this view {scope && <span className="ml-1 rounded-full bg-orange/10 px-2.5 py-0.5 text-[12px] font-semibold text-orange">{scope}</span>}
          </h3>
          <div className="text-[11.5px] text-grey">Click a heading to sort, pick under it to filter.</div>
        </div>
        <Button variant="outline" size="sm" onClick={exportIt}>Export Excel</Button>
      </div>
      <ActiveFilters ctl={ctl} shown={ctl.view.length} total={base.length} />
      <div className="overflow-x-auto">
        <table className="w-full">
          <SortFilterHead cols={cols} ctl={ctl} />
          <SortFilterBody cols={cols} rows={pg.pageItems} rowKey={(r) => `${r.company}|${r.item}|${r.lot?.lot ?? "-"}`} empty="Nothing in this view." />
        </table>
      </div>
      <Pagination state={pg} rowsLabel="rows" pageSizeOptions={[25, 50, 100]} />
    </div>
  );
}

export default function Dashboard() {
  const { q, today, progress, asOf, refreshing } = useExpiryStatus();
  const [measure, setMeasure] = useState<Measure>("qty");
  const [months, setMonths] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [states, setStates] = useState<StateKey[]>([]);
  const [pick, setPick] = useState<{ dim: Dim; key: string } | null>(null);
  const lookupQ = useItemLookup();
  const lookup = lookupQ.data;

  const all: Row[] = useMemo(() => {
    const d = q.data;
    if (!d) return [];
    const cls = (company: string, item: string) => classify(lookup, company, item);
    const thisMonth = `${today.slice(0, 7)}-01`;
    return [
      ...d.lots.filter((l) => l.uom === "KGS").map((l): Row => ({
        company: l.company, ...pickCG(cls(l.company, l.item)), item: l.item,
        qty: l.qty, value: l.value, lots: 1, lot: l,
        state: (l.state === "invalid" ? "missing" : l.state) as StateKey,
        month: !l.expiry ? "none" : l.expiry < thisMonth ? "expired" : l.expiry.slice(0, 7),
      })),
      ...d.noLot.filter((n) => n.uom === "KGS").map((n): Row => ({
        company: n.company, ...pickCG(cls(n.company, n.item)), item: n.item,
        qty: n.qty, value: n.value, lots: 0, state: "nolot", month: "nolot",
      })),
    ];
  }, [q.data, today, lookup]);

  // Top filters — each dropdown lists what the OTHER filters leave, with counts.
  const passes = (r: Row, skip?: string) =>
    (skip === "month" || !months.length || months.includes(r.month)) &&
    (skip === "category" || !categories.length || categories.includes(r.category)) &&
    (skip === "company" || !companies.length || companies.includes(r.company)) &&
    (skip === "group" || !groups.length || groups.includes(r.group)) &&
    (skip === "state" || !states.length || states.includes(r.state));
  const options = (field: "month" | "category" | "company" | "group") => {
    const m = new Map<string, number>();
    for (const r of all) if (passes(r, field)) m.set(r[field], (m.get(r[field]) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => field === "month" ? monthOrder(a[0]).localeCompare(monthOrder(b[0])) : a[0].localeCompare(b[0]))
      .map(([v, n]) => ({ value: v, label: `${field === "month" ? monthLabel(v) : v || "(none)"} (${n})` }));
  };
  const filtered = useMemo(() => all.filter((r) => passes(r)), [all, months, categories, companies, groups, states]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-filter from a clicked column: applies to every chart but its own, and to the summary.
  const byPick = (rows: Row[], except?: Dim) =>
    !pick || pick.dim === except ? rows : rows.filter((r) => (r[pick.dim] || "(none)") === pick.key);
  const companyPts = useMemo(() => points(byPick(filtered, "company"), "company", measure), [filtered, pick, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const categoryPts = useMemo(() => points(byPick(filtered, "category"), "category", measure), [filtered, pick, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupPts = useMemo(() => points(byPick(filtered, "group"), "group", measure), [filtered, pick, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(() => byPick(filtered), [filtered, pick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Consume-first planning: every lot with an expiry, under the page filters but NOT the state chips.
  const planBase = useMemo(() => byPick(all.filter((r) => passes(r, "state"))), [all, months, categories, companies, groups, pick]); // eslint-disable-line react-hooks/exhaustive-deps
  const planRows: PlanRow[] = useMemo(() => planBase.flatMap((r) => (r.lot?.expiry
    ? [{ company: r.company, category: r.category, group: r.group, item: r.item, qty: r.qty, value: r.value, lot: r.lot }] : [])), [planBase]);
  const notDated = useMemo(() => planBase.filter((r) => r.lot && !r.lot.expiry).length, [planBase]);
  const next3 = useMemo(() => {
    const [y, m] = today.slice(0, 7).split("-").map(Number);
    const i = m - 1 + 2;
    const endYm = `${y + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
    const list = planRows.filter((r) => r.lot.expiry! >= today && r.lot.expiry!.slice(0, 7) <= endYm);
    return { lots: list.length, qty: list.reduce((n, r) => n + r.qty, 0), value: list.reduce((n, r) => n + r.value, 0) };
  }, [planRows, today]);

  // Summary figures for the view.
  const st = useMemo(() => {
    const t = emptyParts();
    for (const r of view) add(t[r.state], r);
    return t;
  }, [view]);
  const total = STATE_SERIES.reduce((t, s) => (add(t, st[s.key]), t), zero());
  const lotQty = st.updated.qty + st.expired.qty + st.missing.qty;
  const coverage = lotQty ? (100 * (st.updated.qty + st.expired.qty)) / lotQty : 0;
  const perCompany = useMemo(() => {
    const m = new Map<string, Record<StateKey, Totals>>();
    for (const r of view) {
      if (!m.has(r.company)) m.set(r.company, emptyParts());
      add(m.get(r.company)![r.state], r);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [view]);
  const notInMaster = useMemo(() => new Set(view.filter((r) => r.category === NOT_IN_MASTER).map((r) => `${r.company}|${r.item}`)).size, [view]);

  const onPick = (dim: Dim) => (key: string) => setPick((p) => (p && p.dim === dim && p.key === key ? null : { dim, key }));
  const selectedFor = (dim: Dim) => (pick?.dim === dim ? pick.key : null);
  const anyTop = months.length + categories.length + companies.length + groups.length + states.length > 0;
  const clearAll = () => { setMonths([]); setCategories([]); setCompanies([]); setGroups([]); setStates([]); setPick(null); };

  // Cards and summary-table cells: show just those lots, and bring the lot table into view.
  const toLots = () => setTimeout(() => document.getElementById("ink-expiry-lots")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  const sameStates = (want: StateKey[]) => want.length === states.length && want.every((x) => states.includes(x));
  const showStates = (want: StateKey[]) => { setStates(sameStates(want) ? [] : want); if (!sameStates(want)) toLots(); };
  const showCompany = (company: string | null, state: StateKey | null) => {
    const samePick = company === null ? !pick : pick?.dim === "company" && pick.key === company;
    const want = state ? [state] : [];
    if (samePick && sameStates(want)) { setPick(null); setStates([]); return; }
    setPick(company === null ? null : { dim: "company", key: company });
    setStates(want);
    toLots();
  };
  const [done, totalReq] = progress;

  return (
    // A click that reaches the page (not a column, not a control) clears the chart filter.
    <div className="min-h-full w-full space-y-3 px-4 py-4" onClick={() => setPick(null)}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-orange">{APP}</div>
          <h1 className="text-[21px] font-bold leading-tight text-navy">Ink Stock &amp; Expiry Dashboard</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FreshnessBar asOf={asOf} refreshing={refreshing} progress={progress} />
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? "Loading…" : "Refresh"}
          </Button>
          <Link to={`${appBasePath("ink-expiry")}/status`}
            className="inline-flex h-9 items-center rounded-lg border border-orange/40 px-3 text-[12.5px] font-semibold text-orange hover:bg-orange/5">
            Lot list &amp; accountant export →
          </Link>
        </div>
      </div>

      {q.isError && (
        <Card className="border-ryg-red/40 p-4 text-[13px] text-ryg-red">Could not read stock from ConnectWave: {(q.error as Error).message}</Card>
      )}

      {q.isLoading ? (
        <Card className="p-12 text-center text-[13px] text-grey">
          <div className="text-[14px] font-semibold text-navy">Reading every ink lot from Tally…</div>
          <div className="mt-1">The first load takes about a minute; after that the page opens instantly.</div>
          {totalReq > 0 && (
            <div className="mx-auto mt-4 h-2 w-72 overflow-hidden rounded-full bg-page">
              <div className="h-full bg-orange transition-all" style={{ width: `${(done / totalReq) * 100}%` }} />
            </div>
          )}
        </Card>
      ) : q.data && (
        <>
          {/* ── Filters ─────────────────────────────────────────────── */}
          <div className="rounded-xl border border-line bg-white px-3 py-2 shadow-sm" onClick={(e) => e.stopPropagation()}>
            {/* One slim row: the field name sits inside each dropdown, so there is no label line above it. */}
            <div className="flex flex-wrap items-center gap-2">
              {([
                ["Month", months, setMonths, options("month"), "All months"],
                ["Category", categories, setCategories, options("category"), "All categories"],
                ["Company", companies, setCompanies, options("company"), "All companies"],
                ["Group", groups, setGroups, options("group"), "All groups"],
              ] as const).map(([label, value, set, opts, ph]) => (
                <div key={label} className="flex min-w-[170px] flex-1 items-center rounded-lg border border-line bg-white pl-2.5 focus-within:border-orange/50">
                  <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-grey">{label}</span>
                  <MultiSelect values={value as string[]} onChange={set as (v: string[]) => void} options={opts} placeholder={ph} searchable
                    className="min-w-0 flex-1" triggerClassName={FILTER_TRIGGER} />
                </div>
              ))}
              <div className="flex h-8 shrink-0 overflow-hidden rounded-lg border border-line text-[11.5px] font-semibold">
                {(["qty", "value", "lots"] as Measure[]).map((m) => (
                  <button key={m} onClick={() => setMeasure(m)} aria-pressed={measure === m}
                    className={"px-2.5 " + (measure === m ? "bg-navy text-white" : "bg-white text-grey hover:bg-page")}>
                    {MEASURE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            {(anyTop || pick) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[12px]">
                {pick && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-orange/10 px-3 py-1 font-medium text-orange">
                    Chart filter · {DIM_NAME[pick.dim]}: {pick.key}
                    <button onClick={() => setPick(null)} aria-label="Clear chart filter" className="ml-1 font-bold">✕</button>
                  </span>
                )}
                {states.length > 0 && (
                  <span className="rounded-full bg-page px-3 py-1 text-navy">Expiry state: {states.map((s) => STATE_NAME[s]).join(", ")}</span>
                )}
                <button onClick={clearAll} className="font-semibold text-orange hover:underline">Clear all filters</button>
                <span className="ml-auto text-grey">Tip: click a column to filter · click anywhere else to clear it</span>
              </div>
            )}
          </div>

          {/* Colour key — also filters by expiry state */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <StateKeyRow totals={st} measure={measure} selected={states}
              onPick={(s) => setStates((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))} />
            <span className="text-[12px] text-grey">
              In view: <b className="text-navy">{fmtKg(total.qty)}</b> · <b className="text-navy">{fmtMoney(total.value)}</b> · {total.lots.toLocaleString("en-IN")} lots
            </span>
          </div>

          {/* ── Charts: company · category · group, side by side ──── */}
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            <ChartPanel title="Company-wise" subtitle={`${MEASURE_LABEL[measure]} · ${companyPts.length} companies`} sizeKey="ink-expiry-company" bodyHeight={fitHeight(companyPts.length)}>
              {(size) => <HBarChart points={companyPts} measure={measure} size={size} color="#1F4E8C" labelWidth={120}
                selected={selectedFor("company")} onPick={onPick("company")} />}
            </ChartPanel>
            <ChartPanel title="Category-wise" subtitle={`${MEASURE_LABEL[measure]} · ${categoryPts.length} categories · Central Master`} sizeKey="ink-expiry-category" bodyHeight={fitHeight(categoryPts.length)}>
              {(size) => <HBarChart points={categoryPts} measure={measure} size={size} color="#2a78d6" labelWidth={150}
                selected={selectedFor("category")} onPick={onPick("category")} />}
            </ChartPanel>
            <ChartPanel title="Group-wise" subtitle={`${MEASURE_LABEL[measure]} · ${groupPts.length} groups · Central Master`} sizeKey="ink-expiry-group" bodyHeight={fitHeight(groupPts.length)}>
              {(size) => <HBarChart points={groupPts} measure={measure} size={size} color="#eb6834" labelWidth={170}
                selected={selectedFor("group")} onPick={onPick("group")} />}
            </ChartPanel>
          </div>

          {/* ── 4 · Summary ─────────────────────────────────────────── */}
          <div className="flex items-center gap-3 pt-1">
            <h2 className="text-[16px] font-bold text-navy">Summary</h2>
            <span className="text-[12.5px] text-grey">for everything in the current filters</span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5" onClick={(e) => e.stopPropagation()}>
            <Tile label="Ink in stock" accent="#0B1F3A" icon={<span className="text-[15px]">◆</span>} value={fmtKg(total.qty)}
              sub={<>{fmtMoney(total.value)} · {total.lots.toLocaleString("en-IN")} lots</>}
              hint="Click to show all lots" onClick={() => { setStates([]); toLots(); }} />
            <Tile label="Expiry updated" accent="#2a78d6" icon={<span className="text-[15px]">✓</span>} value={`${Math.round(coverage)}%`}
              sub={<>{(st.updated.lots + st.expired.lots).toLocaleString("en-IN")} lots · {fmtKg(st.updated.qty + st.expired.qty)}</>}
              hint="Click to list these lots" active={sameStates(["updated", "expired"])} onClick={() => showStates(["updated", "expired"])}>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-page">
                <div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${coverage}%` }} />
              </div>
            </Tile>
            <Tile label="Expiry not updated" accent="#eda100" icon={<span className="text-[15px]">✎</span>} value={st.missing.lots.toLocaleString("en-IN")}
              sub={<>lots · {fmtKg(st.missing.qty)} · {fmtMoney(st.missing.value)}</>}
              hint="Click to list these lots" active={sameStates(["missing"])} onClick={() => showStates(["missing"])} />
            <Tile label="Expired, still in stock" accent="#e34948" icon={<span className="text-[15px]">!</span>} value={st.expired.lots.toLocaleString("en-IN")}
              sub={<>lots · {fmtKg(st.expired.qty)} · {fmtMoney(st.expired.value)}</>}
              hint="Click to list these lots" active={sameStates(["expired"])} onClick={() => showStates(["expired"])} />
            <Tile label="Expiring in next 3 months" accent="#eb6834" icon={<span className="text-[15px]">⏳</span>} value={next3.lots.toLocaleString("en-IN")}
              sub={<>lots · {fmtKg(next3.qty)} · {fmtMoney(next3.value)}</>}
              hint="Consume first — see the plan" onClick={() => document.getElementById("ink-expiry-consume-first")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
          </div>

          <ConsumeFirst rows={planRows} today={today} notDated={notDated} />

          <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-line/70 px-4 py-2.5">
              <h3 className="text-[15px] font-bold text-navy">Summary by company</h3>
              <div className="text-[11.5px] text-grey">{MEASURE_LABEL[measure]} in each expiry state · click a company or a figure to list those lots</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="bg-page">
                  <tr className="text-[11px] uppercase tracking-wide text-grey">
                    <th className="px-4 py-2 text-left">Company</th>
                    {STATE_SERIES.map((s) => (
                      <th key={s.key} className="px-3 py-2 text-right">
                        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-4 py-2 text-right">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {[...perCompany, ["Total", st] as const].map(([co, p]) => {
                    const t = STATE_SERIES.reduce((a, s) => (add(a, p[s.key]), a), zero());
                    const lq = p.updated.qty + p.expired.qty + p.missing.qty;
                    const cov = lq ? Math.round((100 * (p.updated.qty + p.expired.qty)) / lq) : 0;
                    const isTotal = co === "Total";
                    return (
                      <tr key={co} className={"border-t border-line " + (isTotal ? "bg-page/60 font-bold" : "")}>
                        <td className="px-4 py-2">
                          <button onClick={() => showCompany(isTotal ? null : co, null)}
                            className={"font-semibold hover:text-orange hover:underline " + (pick?.dim === "company" && pick.key === co && !states.length ? "text-orange" : "text-navy")}>
                            {co}
                          </button>
                        </td>
                        {STATE_SERIES.map((s) => {
                          const on = (isTotal ? !pick : pick?.dim === "company" && pick.key === co) && sameStates([s.key]);
                          return (
                            <td key={s.key} className="px-1.5 py-1 text-right tabular-nums">
                              {p[s.key][measure] ? (
                                <button onClick={() => showCompany(isTotal ? null : co, s.key)}
                                  title={`List ${isTotal ? "all" : co} — ${s.label}`}
                                  className={"rounded-md px-1.5 py-1 hover:bg-orange/10 hover:text-orange " + (on ? "bg-orange/15 font-bold text-orange" : "")}>
                                  {fmtMeasure(measure, p[s.key][measure])}
                                </button>
                              ) : <span className="px-1.5 text-grey-2">—</span>}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-navy">{fmtMeasure(measure, t[measure])}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(t.value)}</td>
                        <td className="px-4 py-2 text-right">
                          <span className="inline-flex items-center gap-2">
                            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-page"><span className="block h-full bg-[#2a78d6]" style={{ width: `${cov}%` }} /></span>
                            <span className="w-9 tabular-nums">{cov}%</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div id="ink-expiry-lots" className="scroll-mt-4">
            <LotTable rows={view} today={today}
              scope={[pick ? `${DIM_NAME[pick.dim]}: ${pick.key}` : "", states.length ? states.map((x) => STATE_NAME[x]).join(" + ") : ""].filter(Boolean).join(" · ")} />
          </div>

          <p className="text-[11.5px] text-grey">
            KGS stock only — Tally's ink groups also hold ~1.2 lakh MTR of foil paper and a few PCS items, left out here. Provision ink,
            dead stock, diff stock and loose ink are excluded everywhere in this app.
            Value = quantity × each item's Tally closing rate. Category and Group come from Central Masters with your Bushra Central
            Master corrections{lookupQ.isLoading ? " (loading…)" : ""}{notInMaster ? ` — ${notInMaster.toLocaleString("en-IN")} items in view are not in Central Master` : ""}.
            Coverage = share of lot stock whose expiry is entered in Tally.
          </p>
        </>
      )}
    </div>
  );
}
