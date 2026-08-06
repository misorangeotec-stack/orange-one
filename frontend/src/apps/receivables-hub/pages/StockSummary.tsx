/**
 * Stock Summary — Tally Reports → Inventory Books.
 *
 * Tally's own "Stock Group Summary" print. Eight leading text columns + twelve numeric columns
 * under four grouped headers (Opening Balance | Inwards | Outwards | Closing Balance, each with
 * Quantity / Rate / Value), one flat row per stock item.
 *
 * Data lives in lib/stockSummary.ts (the precomputed ConnectWave rpt_stock_summary_* snapshot,
 * read through the rpt_stock_summary_window RPC); the whole selection is loaded, then filtered,
 * sorted and paginated client-side (project rule: usePagination + <Pagination/>, 25/page). Export
 * in lib/exportStockSummary.ts reproduces the finance team's supplied workbook.
 *
 * COLUMN ORDER IS THE WORKBOOK'S, and the screen and the export now share it exactly:
 *   Company | Primary Group | Sub Group 1..4 | Particulars | Item Code | 12 numeric
 * That puts Particulars 7th, so freezing it means freezing ~1,300 px of lead columns. Hence the
 * pin defaults OFF and freezes the whole visible lead block when you turn it on — a partial freeze
 * is not expressible, since `position: sticky` only works on a contiguous run from the left edge.
 *
 * SUB-GROUP COLUMNS AND FILTERS AUTO-HIDE. Only 9 items in the entire mirror reach depth 5, so
 * Sub Group 4 is empty on almost every book; rendering it would be a dead column and a dead
 * dropdown. Visibility is computed from the LOADED set, not the filtered one, so columns do not
 * appear and vanish while you refine.
 *
 * THE SUB-GROUP FILTERS ARE FOUR SEPARATE CONTROLS, but their OPTIONS cascade: level N is built
 * from the rows still standing after Primary Group and levels 1..N−1. That keeps them independent
 * to operate while making it impossible to pick a combination that returns nothing.
 *
 * TWO RULES THE SCREEN MUST NOT FUDGE (both spelled out in lib/stockSummary.ts):
 *   1. Opening + Inwards − Outwards ties on QUANTITY, not on VALUE. The four Value totals are four
 *      independent figures. VALUE_NOTE prints under the table; do not quietly drop it.
 *   2. Narrowing the period below the full FY flips value_basis to 'walked' — opening/closing VALUE
 *      is then derived, not Tally's own. The banner says so.
 *
 * Quantities are only totalled when the filtered set has ONE base unit. Summing KGS + MTR + PCS is
 * not a number anybody can use, which is what earns the Base Unit filter its slot.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown, ArrowLeft, ArrowUp, Boxes, Download, Info, Pin, RefreshCw, Search, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { salesFyOptions } from "@hub/lib/salesReport";
import {
  VALUE_NOTE, fmtQtyUnit, fmtRate2, fmtTotal2, fmtValue2, fyBounds, isoToYmd,
  loadLastStockSummaryRefresh, loadStockSummary, pathOf, periodBand, refreshStockSummaryCompanies,
  ymdToIso, type StockSummaryRow,
} from "@hub/lib/stockSummary";
import { exportStockSummaryXlsx } from "@hub/lib/exportStockSummary";

const BASE = "/outstanding-dashboard";

/* ------------------------------------------------------------------ columns */

const BLOCKS = [
  { key: "opening", label: "Opening Balance" },
  { key: "inward", label: "Inwards" },
  { key: "outward", label: "Outwards" },
  { key: "closing", label: "Closing Balance" },
] as const;

const MEASURES = [
  { key: "qty", label: "Quantity" },
  { key: "rate", label: "Rate" },
  { key: "value", label: "Value" },
] as const;

type LeadKey =
  | "company_display" | "primary_group"
  | "sub_group_1" | "sub_group_2" | "sub_group_3" | "sub_group_4"
  | "item" | "item_code";

interface LeadCol {
  key: LeadKey;
  label: string;
  /** Fixed px width — also what the freeze offsets are computed from. */
  w: number;
  /** Sub-group depth this column renders, when it is one. */
  level?: 1 | 2 | 3 | 4;
}

/** The finance workbook's order, verbatim. The export writes exactly these, in this order. */
const LEAD: LeadCol[] = [
  { key: "company_display", label: "Company", w: 150 },
  { key: "primary_group", label: "Primary Group", w: 165 },
  { key: "sub_group_1", label: "Sub Group 1", w: 150, level: 1 },
  { key: "sub_group_2", label: "Sub Group 2", w: 150, level: 2 },
  { key: "sub_group_3", label: "Sub Group 3", w: 140, level: 3 },
  { key: "sub_group_4", label: "Sub Group 4", w: 140, level: 4 },
  { key: "item", label: "Particulars", w: 300 },
  { key: "item_code", label: "Item Code", w: 120 },
];

const SG_LEVELS = [1, 2, 3, 4] as const;
type SgLevel = (typeof SG_LEVELS)[number];

type NumKey =
  | "opening_qty" | "opening_rate" | "opening_value"
  | "inward_qty" | "inward_rate" | "inward_value"
  | "outward_qty" | "outward_rate" | "outward_value"
  | "closing_qty" | "closing_rate" | "closing_value";
type SortKey = LeadKey | NumKey;

type ShowMode = "all" | "in_stock" | "moved" | "dead";
const SHOW_LABEL: Record<ShowMode, string> = {
  all: "All items",
  in_stock: "In stock",
  moved: "Moved in period",
  dead: "Nil balance & no movement",
};

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const CSV = (s: string[]) => s.join(",");

/* ------------------------------------------------------------------ page */

export default function StockSummary() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { companies, loading: companiesLoading } = useFinancialStatements();

  const fyOptions = useMemo(() => salesFyOptions(), []);
  const fy = params.get("fy") || fyOptions[0];
  const bounds = useMemo(() => fyBounds(fy), [fy]);

  const companyOptions: MultiSelectOption[] = useMemo(
    () => companies.map((c) => ({
      value: c.companyGuid,
      label: c.location ? `${c.company} — ${c.location}` : c.company,
    })),
    [companies],
  );

  // Multi-company. Defaults to the first book so the page is never blank on arrival.
  const companyParam = params.get("company");
  const companyGuids = useMemo(() => {
    const picked = (companyParam ?? "").split(",").filter(Boolean)
      .filter((g) => companies.some((c) => c.companyGuid === g));
    if (picked.length) return picked;
    return companies[0] ? [companies[0].companyGuid] : [];
  }, [companyParam, companies]);

  const fromYmd = params.get("from") || bounds.from;
  const toYmd = params.get("to") || bounds.to;
  const validRange = /^\d{8}$/.test(fromYmd) && /^\d{8}$/.test(toYmd) && fromYmd <= toYmd;
  const wholeFy = fromYmd === bounds.from && toYmd === bounds.to;

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  // Changing the FY re-defaults the period to that year's bounds — a period from the previous FY
  // would be clamped away server-side and read as an unexplained empty grid.
  const pickFy = (nextFy: string) => {
    const b = fyBounds(nextFy);
    setParam({ fy: nextFy, from: b.from, to: b.to });
  };

  const companyLabels = useMemo(
    () => companyGuids.map((g) => companyOptions.find((o) => o.value === g)?.label ?? g),
    [companyGuids, companyOptions],
  );

  const { data, isLoading, error } = useQuery<StockSummaryRow[]>({
    queryKey: ["stockSummary", "v2", CSV(companyGuids), fy, fromYmd, toYmd],
    queryFn: () => loadStockSummary(companyGuids, fy, fromYmd, toYmd),
    enabled: companyGuids.length > 0 && validRange,
    staleTime: 5 * 60 * 1000,
  });
  const all = useMemo(() => data ?? [], [data]);
  const periodScope: "full-year" | "window" =
    all[0]?.period_scope ?? (wholeFy ? "full-year" : "window");
  const builtAt = useMemo(
    () => (all.length ? all.reduce((m, r) => (r.built_at > m ? r.built_at : m), all[0].built_at) : null),
    [all],
  );

  /* -------- filters -------- */
  const [primaryGroups, setPrimaryGroups] = useState<string[]>([]);
  // Four independent selections, one per sub-group depth.
  const [subGroups, setSubGroups] = useState<string[][]>([[], [], [], []]);
  const [categories, setCategories] = useState<string[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [show, setShow] = useState<ShowMode>("all");
  const [searchRaw, setSearchRaw] = useState("");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);

  // 8,000 items × every keystroke is the one place this page can feel slow.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw), 200);
    return () => clearTimeout(t);
  }, [searchRaw]);

  const setSubGroup = (level: SgLevel, next: string[]) =>
    setSubGroups((s) => s.map((v, i) => (i === level - 1 ? next : v)));

  const primaryOptions: MultiSelectOption[] = useMemo(
    () => [...new Set(all.map((r) => r.primary_group ?? "(Ungrouped)"))]
      .sort(collator.compare).map((v) => ({ value: v, label: v })),
    [all],
  );

  /**
   * Which sub-group depths this selection actually uses. Computed from the LOADED rows, not the
   * filtered ones, so a column or a dropdown never appears and vanishes while you refine.
   */
  const activeLevels = useMemo(() => {
    const on = new Set<SgLevel>();
    for (const r of all) {
      for (const lv of SG_LEVELS) if (r[`sub_group_${lv}` as const]) on.add(lv);
      if (on.size === SG_LEVELS.length) break;
    }
    return on;
  }, [all]);

  /**
   * Options per depth. Four SEPARATE controls, but each level's options are built from the rows
   * still standing after Primary Group and the levels above it — so the four can be operated
   * independently without ever offering a combination that returns nothing.
   */
  const sgOptions: MultiSelectOption[][] = useMemo(() => {
    let rows = primaryGroups.length
      ? all.filter((r) => primaryGroups.includes(r.primary_group ?? "(Ungrouped)"))
      : all;
    const out: MultiSelectOption[][] = [];
    for (const lv of SG_LEVELS) {
      const key = `sub_group_${lv}` as const;
      const vals = [...new Set(rows.map((r) => r[key]).filter(Boolean) as string[])].sort(collator.compare);
      out.push(vals.map((v) => ({ value: v, label: v })));
      const sel = subGroups[lv - 1];
      if (sel.length) rows = rows.filter((r) => sel.includes(r[key] ?? ""));
    }
    return out;
  }, [all, primaryGroups, subGroups]);

  // Narrowing an upstream level can orphan a downstream selection; drop the orphans rather than
  // showing an empty grid the user cannot explain.
  useEffect(() => {
    setSubGroups((s) => {
      const next = s.map((sel, i) => sel.filter((v) => sgOptions[i]?.some((o) => o.value === v)));
      return next.every((v, i) => v.length === s[i].length) ? s : next;
    });
  }, [sgOptions]);

  // Every item in these books is CATEGORY 'Not Applicable' — never render a dead dropdown.
  const categoryOptions: MultiSelectOption[] = useMemo(
    () => [...new Set(all.map((r) => r.stock_category ?? "Not Applicable"))]
      .sort(collator.compare).map((v) => ({ value: v, label: v })),
    [all],
  );
  const unitOptions: MultiSelectOption[] = useMemo(
    () => [...new Set(all.map((r) => r.base_unit ?? ""))].filter(Boolean)
      .sort(collator.compare).map((v) => ({ value: v, label: v })),
    [all],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (primaryGroups.length && !primaryGroups.includes(r.primary_group ?? "(Ungrouped)")) return false;
      for (const lv of SG_LEVELS) {
        const sel = subGroups[lv - 1];
        if (sel.length && !sel.includes(r[`sub_group_${lv}` as const] ?? "")) return false;
      }
      if (categories.length && !categories.includes(r.stock_category ?? "Not Applicable")) return false;
      if (units.length && !units.includes(r.base_unit ?? "")) return false;
      const moved = r.inward_qty !== 0 || r.outward_qty !== 0;
      if (show === "in_stock" && r.closing_qty === 0) return false;
      if (show === "moved" && !moved) return false;
      if (show === "dead" && (moved || r.closing_qty !== 0 || r.opening_qty !== 0)) return false;
      if (q && !(
        r.item.toLowerCase().includes(q) ||
        (r.item_code ?? "").toLowerCase().includes(q) ||
        pathOf(r).toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [all, primaryGroups, subGroups, categories, units, show, search]);

  /* -------- sort: asc → desc → back to Tally's own order -------- */
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const toggleSort = (key: SortKey) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  const sortIcon = (key: SortKey) => {
    if (!sort || sort.key !== key) return null;
    return sort.dir === "asc"
      ? <ArrowUp className="h-3 w-3 shrink-0" />
      : <ArrowDown className="h-3 w-3 shrink-0" />;
  };

  const sorted = useMemo(() => {
    const out = [...filtered];
    if (!sort) return out.sort((a, b) => collator.compare(a.item, b.item));
    const { key, dir } = sort;
    const sign = dir === "asc" ? 1 : -1;
    const numeric = key.endsWith("_qty") || key.endsWith("_rate") || key.endsWith("_value");
    return out.sort((a, b) => {
      const r = numeric
        ? (Number(a[key as NumKey]) || 0) - (Number(b[key as NumKey]) || 0)
        : collator.compare(String(a[key as LeadKey] ?? ""), String(b[key as LeadKey] ?? ""));
      // ~75 % of rows carry a zero rate, so without a stable tiebreak a Rate sort produces one
      // large arbitrary block. Ties fall back to Tally's own order, unsigned.
      return r ? r * sign : collator.compare(a.item, b.item);
    });
  }, [filtered, sort]);

  const activeFilterCount =
    primaryGroups.length + subGroups.reduce((n, s) => n + s.length, 0) +
    categories.length + units.length + (show !== "all" ? 1 : 0);

  const page = usePagination(sorted, {
    resetKey: `${CSV(companyGuids)}|${fy}|${fromYmd}|${toYmd}|${primaryGroups.join(",")}|` +
      `${subGroups.map((s) => s.join("+")).join("|")}|${categories.join(",")}|${units.join(",")}|` +
      `${show}|${search}|${sort?.key ?? ""}${sort?.dir ?? ""}`,
  });

  /* -------- visible lead columns + freeze offsets -------- */
  const visibleLead = useMemo(
    () => LEAD.filter((c) => !c.level || activeLevels.has(c.level)),
    [activeLevels],
  );
  const COL_COUNT = visibleLead.length + BLOCKS.length * MEASURES.length;

  const [freeze, setFreeze] = useState(false);
  const stickLeft = useMemo(() => {
    const m = new Map<LeadKey, number>();
    let x = 0;
    for (const c of visibleLead) { m.set(c.key, x); x += c.w; }
    return m;
  }, [visibleLead]);
  const lastLeadKey = visibleLead[visibleLead.length - 1]?.key;

  type Stick = { className: string; style?: CSSProperties };
  const freezeStick = (c: LeadCol, opts?: { header?: boolean; bg?: string }): Stick => {
    if (!freeze) return { className: "" };
    const bg = opts?.bg ?? (opts?.header ? "bg-muted" : "bg-surface");
    const shadow = c.key === lastLeadKey ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.18)]" : "";
    return {
      className: `sticky ${opts?.header ? "z-40" : "z-10"} ${bg} ${shadow}`,
      style: { left: stickLeft.get(c.key) ?? 0 },
    };
  };

  /* -------- totals: over the FILTERED set, never the page -------- */
  const totals = useMemo(() => {
    const t: Record<string, number> = {
      opening_qty: 0, opening_value: 0, inward_qty: 0, inward_value: 0,
      outward_qty: 0, outward_value: 0, closing_qty: 0, closing_value: 0,
    };
    for (const r of filtered) {
      t.opening_qty += r.opening_qty; t.opening_value += r.opening_value;
      t.inward_qty += r.inward_qty; t.inward_value += r.inward_value;
      t.outward_qty += r.outward_qty; t.outward_value += r.outward_value;
      t.closing_qty += r.closing_qty; t.closing_value += r.closing_value;
    }
    return t;
  }, [filtered]);

  /** Quantities only total under ONE base unit — KGS + MTR + PCS is not a number anyone can use. */
  const oneUnit = useMemo(() => {
    const s = new Set(filtered.map((r) => r.base_unit ?? ""));
    return s.size === 1 ? [...s][0] : null;
  }, [filtered]);

  const inStock = useMemo(() => filtered.filter((r) => r.closing_qty !== 0).length, [filtered]);
  const movedCount = useMemo(
    () => filtered.filter((r) => r.inward_qty !== 0 || r.outward_qty !== 0).length, [filtered],
  );

  const chips: FilterChip[] = [
    ...primaryGroups.map((v) => ({ label: v, onRemove: () => setPrimaryGroups((s) => s.filter((x) => x !== v)) })),
    ...SG_LEVELS.flatMap((lv) =>
      subGroups[lv - 1].map((v) => ({
        label: v,
        onRemove: () => setSubGroup(lv, subGroups[lv - 1].filter((x) => x !== v)),
      })),
    ),
    ...categories.map((v) => ({ label: v, onRemove: () => setCategories((s) => s.filter((x) => x !== v)) })),
    ...units.map((v) => ({ label: v, onRemove: () => setUnits((s) => s.filter((x) => x !== v)) })),
    ...(show !== "all" ? [{ label: SHOW_LABEL[show], onRemove: () => setShow("all") }] : []),
  ];
  const clearAll = () => {
    setPrimaryGroups([]); setSubGroups([[], [], [], []]); setCategories([]); setUnits([]);
    setShow("all"); setSearchRaw(""); setSearch("");
  };

  /* -------- export -------- */
  const onExport = () => {
    if (!sorted.length) return;
    const filterSummary: string[] = [];
    if (primaryGroups.length) filterSummary.push(`Primary group: ${primaryGroups.join(", ")}`);
    for (const lv of SG_LEVELS) {
      if (subGroups[lv - 1].length) filterSummary.push(`Sub group ${lv}: ${subGroups[lv - 1].join(", ")}`);
    }
    if (categories.length) filterSummary.push(`Category: ${categories.join(", ")}`);
    if (units.length) filterSummary.push(`Base unit: ${units.join(", ")}`);
    if (show !== "all") filterSummary.push(`Show: ${SHOW_LABEL[show]}`);
    if (search.trim()) filterSummary.push(`Search: ${search.trim()}`);
    exportStockSummaryXlsx(sorted, {
      companyLabel: companyLabels.join(", ") || "All companies",
      fy, from: fromYmd, to: toYmd, periodScope, builtAt, filterSummary,
    });
  };

  /* -------- refresh (every selected book) -------- */
  const { data: lastRefresh } = useQuery({
    queryKey: ["stockSummaryLastRefresh", CSV(companyGuids), fy],
    queryFn: () => loadLastStockSummaryRefresh(companyGuids, fy),
    enabled: companyGuids.length > 0,
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const eta = Math.max(3, (lastRefresh?.seconds ?? 8) * Math.max(1, companyGuids.length));
  const progress = busy ? Math.min(95, (elapsed / eta) * 100) : 0;

  const onRefresh = async () => {
    if (!companyGuids.length || busy) return;
    setBusy(true); setNote(null); setElapsed(0);
    timer.current = setInterval(() => setElapsed((e) => e + 0.25), 250);
    try {
      const res = await refreshStockSummaryCompanies(companyGuids, fy);
      if (res.status === "cooldown") setNote(`Just refreshed — try again in ${res.retry_after_seconds ?? 0}s.`);
      else if (res.status === "busy") setNote("A refresh is already running for one of these companies.");
      else if (res.status === "error") setNote(res.message ?? "Refresh failed.");
      else {
        setNote(`Refreshed in ${res.seconds ?? 0}s — ${res.items ?? 0} items, ${res.moves ?? 0} movement rows.`);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["stockSummary"] }),
          qc.invalidateQueries({ queryKey: ["stockSummaryLastRefresh"] }),
        ]);
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
    }
  };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  /* ------------------------------------------------------------------ render */

  return (
    <div className="p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to={`${BASE}/reports?cat=tally`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-3 w-3" /> Tally Reports
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Boxes className="h-6 w-6 text-primary" /> Stock Summary
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every stock item's opening, inward, outward and closing position — quantity, rate and value,
            laid out the way Tally prints its Stock Group Summary.
          </p>
        </div>
        <Button
          onClick={onExport}
          disabled={!sorted.length}
          className="h-9 gap-1.5 rounded-button bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {/* ── Controls ───────────────────────────────────────────────────────────
          Row 1 is the report's IDENTITY — which books, which year, which window.
          Everything that merely REFINES the result lives behind the Filters
          toggle, so nine controls never crowd the top of the page at once. */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-end gap-3 p-3">
          <Field label="Company">
            <MultiSelectFilter
              options={companyOptions}
              value={companyGuids}
              onChange={(v) => setParam({ company: v.length ? CSV(v) : null })}
              allLabel={companiesLoading ? "Loading…" : "All Companies"}
              unit="Companies"
              triggerClassName="w-[240px] h-9 text-sm rounded-input border-border"
            />
          </Field>

          <Field label="Financial year">
            <select
              value={fy}
              onChange={(e) => pickFy(e.target.value)}
              className="h-9 rounded-input border border-border bg-surface px-2 text-sm"
            >
              {fyOptions.map((f) => <option key={f} value={f}>FY {f}</option>)}
            </select>
          </Field>

          <Field label="Period">
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={ymdToIso(fromYmd)}
                min={ymdToIso(bounds.from)}
                max={ymdToIso(bounds.to)}
                onChange={(e) => setParam({ from: isoToYmd(e.target.value) })}
                className="h-9 w-[148px] rounded-input text-sm"
              />
              <span className="text-muted-foreground text-xs">to</span>
              <Input
                type="date"
                value={ymdToIso(toYmd)}
                min={ymdToIso(bounds.from)}
                max={ymdToIso(bounds.to)}
                onChange={(e) => setParam({ to: isoToYmd(e.target.value) })}
                className="h-9 w-[148px] rounded-input text-sm"
              />
              {!wholeFy && (
                <button
                  type="button"
                  onClick={() => setParam({ from: bounds.from, to: bounds.to })}
                  className="text-[11px] text-primary hover:underline whitespace-nowrap ml-1"
                >
                  Full year
                </button>
              )}
            </div>
          </Field>

          <Field label="Search">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchRaw}
                onChange={(e) => setSearchRaw(e.target.value)}
                placeholder="Item name, item code, group…"
                className="pl-9 h-9 w-56 rounded-input"
              />
            </div>
          </Field>

          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant={panelOpen || activeFilterCount ? "secondary" : "outline"}
              onClick={() => setPanelOpen((o) => !o)}
              className="h-9 gap-1.5 rounded-button"
            >
              <SlidersHorizontal className="h-4 w-4" /> Filters
              {activeFilterCount > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <Button variant="outline" onClick={onRefresh} disabled={!companyGuids.length || busy} className="h-9 gap-1.5 rounded-button">
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        {panelOpen && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border bg-muted/30 p-3">
            <Field label="Primary group">
              <MultiSelectFilter
                options={primaryOptions} value={primaryGroups} onChange={setPrimaryGroups}
                allLabel="All Groups" unit="Groups"
                triggerClassName="w-[180px] h-9 text-sm rounded-input border-border"
              />
            </Field>

            {/* One control per depth — but each level's OPTIONS are cut from the rows still
                standing after the levels above it, so no combination can return nothing.
                A depth nothing in the loaded books uses is not rendered at all. */}
            {SG_LEVELS.filter((lv) => activeLevels.has(lv)).map((lv) => (
              <Field key={lv} label={`Sub group ${lv}`}>
                <MultiSelectFilter
                  options={sgOptions[lv - 1]}
                  value={subGroups[lv - 1]}
                  onChange={(v) => setSubGroup(lv, v)}
                  allLabel={`All Sub ${lv}`} unit="Groups" searchable
                  triggerClassName="w-[175px] h-9 text-sm rounded-input border-border"
                />
              </Field>
            ))}

            {categoryOptions.length > 1 && (
              <Field label="Category">
                <MultiSelectFilter
                  options={categoryOptions} value={categories} onChange={setCategories}
                  allLabel="All Categories" unit="Categories"
                  triggerClassName="w-[160px] h-9 text-sm rounded-input border-border"
                />
              </Field>
            )}

            <Field label="Base unit">
              <MultiSelectFilter
                options={unitOptions} value={units} onChange={setUnits}
                allLabel="All Units" unit="Units"
                triggerClassName="w-[135px] h-9 text-sm rounded-input border-border"
              />
            </Field>

            <Field label="Show">
              <select
                value={show}
                onChange={(e) => setShow(e.target.value as ShowMode)}
                className="h-9 rounded-input border border-border bg-surface px-2 text-sm"
              >
                {(Object.keys(SHOW_LABEL) as ShowMode[]).map((m) => (
                  <option key={m} value={m}>{SHOW_LABEL[m]}</option>
                ))}
              </select>
            </Field>

            <button
              type="button"
              onClick={() => setFreeze((f) => !f)}
              className={`h-9 inline-flex items-center gap-1.5 rounded-button border px-3 text-sm ${freeze ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
              title="Freeze the text columns while scrolling the quantity blocks"
            >
              <Pin className={`h-3.5 w-3.5 ${freeze ? "fill-primary" : ""}`} />
              {freeze ? "Columns frozen" : "Freeze columns"}
            </button>
          </div>
        )}
      </div>

      {busy && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {note && <div className="text-xs text-muted-foreground">{note}</div>}

      {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearAll} />}

      {/* Body */}
      {!companyGuids.length ? (
        <div className="py-16 text-center text-muted-foreground">
          {companiesLoading ? "Loading companies…" : "Pick at least one company to load its stock summary."}
        </div>
      ) : !validRange ? (
        <div className="py-16 text-center text-muted-foreground">Pick a valid period (from must be on or before to).</div>
      ) : isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading the stock summary…</div>
      ) : error ? (
        <div className="py-16 text-center text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div>
              <b className="text-foreground font-semibold">
                {companyLabels.length > 2 ? `${companyLabels.length} companies` : companyLabels.join(" + ")}
              </b>
              {" · "}{periodBand(fromYmd, toYmd)}
              {" · "}{filtered.length.toLocaleString("en-IN")} item{filtered.length === 1 ? "" : "s"}
              {" · "}closing <b className="text-foreground font-semibold">₹ {fmtTotal2(totals.closing_value)}</b>
              {" · "}{inStock.toLocaleString("en-IN")} with a balance
              {" · "}{movedCount.toLocaleString("en-IN")} moved
            </div>
            {(builtAt || lastRefresh?.ran_at) && (
              <div>
                Last refreshed {new Date(lastRefresh?.ran_at ?? builtAt ?? "").toLocaleString("en-IN")}
                {" · "}auto-refreshes after each Tally sync
              </div>
            )}
          </div>

          {periodScope === "window" && (
            <div className="flex items-start gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>
                <b>Inwards and Outwards</b> cover {periodBand(fromYmd, toYmd)}.{" "}
                <b>Opening and Closing</b> are Tally's own figures for the full financial year
                ({periodBand(bounds.from, bounds.to)}) — Tally only holds them at the year's boundaries,
                and deriving them for a shorter window would mean computing numbers Tally never stated.
              </span>
            </div>
          )}

          <ScrollableTable className="rounded-lg border border-border" maxHeight="max-h-[62vh]">
            <Table className="border-collapse min-w-[2100px] [&_th]:border-b [&_th]:border-border [&_td]:border-b [&_td]:border-border/60">
              <TableHeader>
                {/* Tier 1 — the text columns (rowSpan 2) + the four Tally balance blocks. */}
                <TableRow className="bg-muted/60 hover:bg-muted/60 sticky top-0 z-30">
                  {visibleLead.map((c) => {
                    const f = freezeStick(c, { header: true });
                    return (
                      <TableHead
                        key={c.key}
                        rowSpan={2}
                        style={{ ...f.style, width: c.w, minWidth: c.w }}
                        onClick={() => toggleSort(c.key)}
                        className={`h-auto align-bottom py-2 px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-nowrap cursor-pointer select-none ${f.className}`}
                      >
                        <span className="inline-flex items-center gap-1">{c.label}{sortIcon(c.key)}</span>
                      </TableHead>
                    );
                  })}
                  {BLOCKS.map((b) => (
                    <TableHead
                      key={b.key}
                      colSpan={MEASURES.length}
                      className="h-[34px] py-2 px-3 text-center text-[11px] font-semibold uppercase tracking-wide text-foreground/70 whitespace-nowrap !border-l-2 !border-l-border"
                    >
                      {b.label}
                    </TableHead>
                  ))}
                </TableRow>

                {/* Tier 2 — Quantity / Rate / Value under each block. The rowSpan=2 heads above
                    already occupy this row's leading cells. */}
                <TableRow className="bg-muted/50 hover:bg-muted/50 sticky top-[34px] z-30">
                  {BLOCKS.flatMap((b) =>
                    MEASURES.map((m, i) => {
                      const key = `${b.key}_${m.key}` as NumKey;
                      return (
                        <TableHead
                          key={key}
                          onClick={() => toggleSort(key)}
                          className={`h-auto py-1.5 px-3 text-right text-[10.5px] font-semibold uppercase tracking-wide text-foreground/60 whitespace-nowrap cursor-pointer select-none ${m.key === "rate" ? "italic" : ""} ${i === 0 ? "!border-l-2 !border-l-border" : ""}`}
                        >
                          <span className="inline-flex items-center gap-1 justify-end w-full">
                            {m.label}{sortIcon(key)}
                          </span>
                        </TableHead>
                      );
                    }),
                  )}
                </TableRow>
              </TableHeader>

              <TableBody>
                {page.pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={COL_COUNT} className="py-10 text-center text-sm text-muted-foreground">
                      {all.length === 0
                        ? `No stock summary has been built for FY ${fy} on ${companyLabels.join(", ") || "this company"} yet — hit Refresh, or wait for tonight's build.`
                        : "No items match those filters."}
                    </TableCell>
                  </TableRow>
                ) : (
                  page.pageItems.map((r) => (
                    <TableRow key={`${r.company_guid}|${r.item}`} className="group border-border/40 hover:bg-muted/40">
                      {visibleLead.map((c) => {
                        const f = freezeStick(c, { bg: "bg-surface group-hover:bg-[hsl(var(--muted))]" });
                        const v = String(r[c.key] ?? "");
                        return (
                          <TableCell
                            key={c.key}
                            style={{ ...f.style, width: c.w, maxWidth: c.w }}
                            title={v}
                            className={`py-1.5 px-3 text-[13px] truncate ${c.key === "item" ? "text-foreground" : "text-muted-foreground"} ${f.className}`}
                          >
                            {v}
                          </TableCell>
                        );
                      })}
                      {BLOCKS.flatMap((b) => {
                        const q = r[`${b.key}_qty` as NumKey] as number;
                        const v = r[`${b.key}_value` as NumKey] as number;
                        // BLANK THE WHOLE BLOCK, NOT CELL BY CELL. 2,426 items carry a stale master
                        // rate on a nil balance (qty 0, value 0) — rendering each cell on its own
                        // rule prints a lone Rate on an otherwise empty line, which reads as the row
                        // having split in two. Tally prints nothing at all for such an item, and the
                        // xlsx export already used this block rule; the screen now matches both.
                        const dead = !q && !v;
                        return [
                          <TableCell
                            key={`${b.key}_qty`}
                            className="py-1.5 px-3 text-right text-[13px] tabular-nums whitespace-nowrap !border-l-2 !border-l-border/60"
                          >
                            {dead ? "" : fmtQtyUnit(q, r.base_unit)}
                          </TableCell>,
                          <TableCell
                            key={`${b.key}_rate`}
                            className="py-1.5 px-3 text-right text-[13px] tabular-nums italic text-muted-foreground whitespace-nowrap"
                          >
                            {dead ? "" : fmtRate2(r[`${b.key}_rate` as NumKey] as number | null)}
                          </TableCell>,
                          <TableCell
                            key={`${b.key}_value`}
                            className={`py-1.5 px-3 text-right text-[13px] tabular-nums whitespace-nowrap ${v < 0 ? "text-destructive" : ""}`}
                          >
                            {dead ? "" : fmtValue2(v)}
                          </TableCell>,
                        ];
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>

              {page.pageItems.length > 0 && (
                <TableFooter className="sticky bottom-0 z-20">
                  <TableRow className="bg-muted/70 font-semibold hover:bg-muted/70">
                    <TableCell
                      colSpan={visibleLead.length}
                      style={freeze ? { left: 0 } : undefined}
                      className={`py-2 px-3 text-[12px] uppercase tracking-wide whitespace-nowrap ${freeze ? "sticky left-0 z-30 bg-muted" : ""}`}
                    >
                      Grand Total — {filtered.length.toLocaleString("en-IN")} items
                    </TableCell>
                    {BLOCKS.flatMap((b) => [
                      <TableCell
                        key={`${b.key}_qty`}
                        title={oneUnit ? undefined : "Mixed base units — filter to a single Base Unit to total quantities."}
                        className="py-2 px-3 text-right text-[13px] tabular-nums whitespace-nowrap !border-l-2 !border-l-border"
                      >
                        {oneUnit ? fmtQtyUnit(totals[`${b.key}_qty`], oneUnit) || `0.000 ${oneUnit}` : "—"}
                      </TableCell>,
                      // A sum of rates is nonsense — Tally does not print one either.
                      <TableCell key={`${b.key}_rate`} className="py-2 px-3 text-right text-muted-foreground/50">—</TableCell>,
                      <TableCell key={`${b.key}_value`} className="py-2 px-3 text-right text-[13px] tabular-nums whitespace-nowrap">
                        {fmtTotal2(totals[`${b.key}_value`])}
                      </TableCell>,
                    ])}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </ScrollableTable>

          <Pagination state={page} rowsLabel="items" />

          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
            <span>
              {VALUE_NOTE} Rates are never totalled; quantities total only under a single Base Unit.
            </span>
          </p>
        </>
      )}
    </div>
  );
}

/** Label + control wrapper. SalesRegister repeats this div five times; at nine controls it earns a name. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">
        {label}
      </span>
      {children}
    </div>
  );
}
