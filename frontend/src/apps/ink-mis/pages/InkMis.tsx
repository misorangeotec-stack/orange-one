/**
 * INK MIS — the ink planning dashboard.
 *
 * The Hub port of the planner's Excel sheet. One line per ink, stock merged across the four
 * books, the hand-entered pipeline alongside it, and the cover maths that decides what to order.
 *
 * FIVE VIEWS, one tab each: Combined, then each book on its own. Combined is the default
 * because that is the decision the planner actually makes — ink is moved between books, so a
 * shortage in one book is only a shortage if the group as a whole is short.
 *
 * ─── WHAT IS TALLY'S AND WHAT IS THE PLANNER'S ───────────────────────────────────────────
 *
 * The four stock columns and the consumption figure come from Tally through ConnectWave and
 * cannot be edited here. Everything else on the row — the averages, lead time, safety factor
 * and every consignment — is the planner's own. The column header group says which is which,
 * because a planner who mistakes a typed number for a Tally number will trust it too much.
 *
 * ─── THE FORMULAS, TAKEN FROM THE SHEET ──────────────────────────────────────────────────
 *
 *   Month max level  = three-month average × lead time × safety factor
 *   Daily max level  = per-day average     × lead time × safety factor
 *   Days cover       = stock ÷ per-day average
 *   Days with ETA    = (stock + ETA + at port) ÷ per-day average
 *   Cover %          = stock ÷ month max level
 *
 * All five were reproduced from the planner's own figures before this screen was written, so
 * the numbers here should match the sheet cell for cell given the same inputs.
 *
 * BOTH AVERAGES COME FROM THE SALES REGISTER, filled by a button rather than recomputed on
 * every render, so a planner's override for a launch or a one-off run survives. The rule and
 * the evidence for it are in lib/inkMis.ts — in short, branch and related sales are the group
 * moving ink to itself and must be excluded, and the per-day divisor is working days ELAPSED
 * this month, not the whole month. Per-day is NOT the three-month average over ninety.
 *
 * ETD IS EXCLUDED FROM COVER. Only ETA and AT PORT count towards the total, matching the
 * sheet's "ETA + AT PORT + STOCK". Goods that have not left the supplier are not cover.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { appBasePath } from "../../appInfo";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Download, ListChecks, Pencil, Plus, RefreshCw, Search, Ship, Trash2, Wand2,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import ReorderChart, { reorderQty } from "../components/ReorderChart";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import HeaderFilter, { isFilterActive, type ColumnFilter } from "../components/HeaderFilter";
import { ResizableHead, useTableColumns } from "../lib/tableColumns";
import { salesFyOptions } from "@hub/lib/salesReport";
import {
  DEFAULT_THRESHOLDS, EMPTY_PLAN, INK_COMPANIES, deriveInkRow, fmtDays, fmtPct, fmtQty,
  INK_CATEGORIES, INK_SOURCES, SHIPMENT_STATUSES, emptyShipment, loadGroupFields, loadHolidays,
  loadLines, loadInkConsumption, loadInkPositions, loadOrder, loadOverrides, loadPlans,
  loadShipments, loadThresholds, newId, saveHolidays, savePlans, saveShipments, saveThresholds,
  sourceLabel, workingDaysElapsed,
  type InkBand, type InkOrder, type InkOverrides, type InkPlan, type InkRow, type InkScope,
  type InkThresholds, type Shipment, type ShipmentStatus,
} from "../lib/inkMis";

const BASE = appBasePath("ink-mis");

/** The sheet's conditional formatting, kept close to the original so the screen reads the
 *  same way at a glance: red is a shortage, purple is money sitting still. */
const BAND_CLASS: Record<InkBand, string> = {
  low: "bg-red-100 text-red-900 font-semibold",
  mid: "bg-amber-100 text-amber-900 font-semibold",
  normal: "bg-emerald-50 text-emerald-900",
  excess: "bg-fuchsia-100 text-fuchsia-900",
  none: "",
};

const BAND_LABEL: Record<InkBand, string> = {
  low: "Below 33%",
  mid: "33–66%",
  normal: "Normal",
  excess: "Excess",
  none: "Not planned",
};

export default function InkMis() {
  const fyOptions = useMemo(() => salesFyOptions(), []);
  const fy = fyOptions[0];

  const [tab, setTab] = useState<string>("combined");
  const [search, setSearch] = useState("");
  /**
   * A FILTER ON EVERY HEADING, keyed by column id.
   *
   * The old filter row could only carry four of them, so the columns a planner most wants to
   * narrow — stock, days of cover, a consignment's quantities — could not be filtered at all. A
   * funnel on each heading scales to thirty columns and costs no screen.
   *
   * An empty entry means "no filter", never "match nothing".
   */
  const [colFilters, setColFilters] = useState<Record<string, ColumnFilter>>({});
  const setColFilter = (id: string, next: ColumnFilter) =>
    setColFilters((prev) => {
      const out = { ...prev, [id]: next };
      if (!isFilterActive(next)) delete out[id];
      return out;
    });
  const [editing, setEditing] = useState(false);
  const [plans, setPlans] = useState<Record<string, InkPlan>>(() => loadPlans());
  const [thresholds, setThresholds] = useState<InkThresholds>(() => loadThresholds());
  // The item master and the row order are OWNED BY THE ITEM MASTER SCREEN. Read here, never
  // written, so there is one place that edits them and no chance of two screens disagreeing.
  const [overrides] = useState<InkOverrides>(() => loadOverrides());
  const [order] = useState<InkOrder>(() => loadOrder());
  const [lineFields] = useState(() => loadLines());
  const [groupFields] = useState(() => loadGroupFields());
  const [scope, setScope] = useState<InkScope>("ink");
  // Four company columns collapse into one group. Remembered per browser; starts collapsed,
  // because the merged Stock column is the number the planner reads first.
  const [companiesOpen, setCompaniesOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("ink-mis:companies-open") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("ink-mis:companies-open", companiesOpen ? "1" : "0");
    } catch {
      /* private mode: the toggle still works for this visit */
    }
  }, [companiesOpen]);
  const [holidays, setHolidays] = useState<string[]>(() => loadHolidays());

  /**
   * CONSIGNMENTS ARE EDITED HERE TOO, not only on the pipeline screen.
   *
   * The decision to order is taken in a meeting, looking at this sheet: cover, lead time, what
   * is already coming. Sending the planner to another tab to record what was just agreed means
   * the sheet on screen is wrong for as long as that takes, so a column can be added, filled and
   * deleted right here. The pipeline screen remains the fuller view — notes, per-ink lists — and
   * both write the same store.
   *
   * These are NOT part of the data query's key, so typing a quantity re-renders and nothing
   * reloads.
   */
  const [shipments, setShipments] = useState<Shipment[]>(() => loadShipments());
  useEffect(() => saveShipments(shipments), [shipments]);

  useEffect(() => savePlans(plans), [plans]);
  useEffect(() => saveThresholds(thresholds), [thresholds]);
  useEffect(() => saveHolidays(holidays), [holidays]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["inkMis", "positions", fy, overrides, scope, order, lineFields, groupFields],
    queryFn: () =>
      loadInkPositions(fy, undefined, undefined, overrides, scope, order, lineFields, groupFields),
    staleTime: 5 * 60 * 1000,
  });

  /**
   * ONLY NUMBERED LINES REACH THE DASHBOARD. The planner gives a line a number in the item
   * master when they want it on the sheet; a line whose number is blank stays in the item
   * master (with its closing stock) and nowhere else. Everything below — rows, totals, the
   * missing-code warning — reads this list, never the unfiltered one.
   *
   * The COUNT of what is left out is shown on the item master, not here. This screen is the
   * planner's sheet, and a standing notice about items they chose to leave off it is noise on
   * the one screen that should carry only what they asked for.
   */
  const allPositions = useMemo(() => data?.rows ?? [], [data]);
  const positions = useMemo(
    () => allPositions.filter((p) => (order[p.key] ?? order[p.legacyKey]) !== undefined),
    [allPositions, order],
  );
  const needsCode = useMemo(() => positions.filter((p) => !p.coded).length, [positions]);

  /* ------------------------------------------------- averages from the Sales Register */

  /**
   * BOTH AVERAGES LOAD WITH THE PAGE, from the Sales Register:
   *
   *   three-month average = the three complete months before this one, summed, over 3
   *   per-day average     = this month so far, over the working days elapsed (Sundays out)
   *
   * They used to appear only after pressing a button, which is why the columns sat empty: the
   * report never asked on its own, and a press made before the stock had loaded filled nothing.
   *
   * A number the planner types still wins, and is flagged as typed (see InkPlan.manual). Clearing
   * the box hands that ink back to the live figure.
   *
   * Needs the stock load first — the register carries item NAMES, and the name-to-line bridge is
   * built from the stock rows — hence `enabled`.
   */
  const nameToCode = data?.nameToCode;
  const holidayKey = [...holidays].sort().join(",");
  const consumptionQuery = useQuery({
    queryKey: ["inkMis", "consumption", fy, overrides, scope, holidayKey],
    queryFn: () => loadInkConsumption(nameToCode ?? new Map(), new Date(), new Set(holidays)),
    enabled: Boolean(nameToCode && nameToCode.size),
    staleTime: 5 * 60 * 1000,
  });
  const consumption = consumptionQuery.data;
  const workingDays = workingDaysElapsed(new Date(), new Set(holidays));
  const typedCount = Object.values(plans).filter(
    (p) => p.manual?.threeMonthAvg || p.manual?.perDayAvg,
  ).length;

  const clearTypedAverages = () =>
    setPlans((prev) => {
      const next: Record<string, InkPlan> = {};
      for (const [k, p] of Object.entries(prev)) next[k] = { ...p, manual: {} };
      return next;
    });

  /* ------------------------------------------------------------------ the rows */

  const companyKey = tab === "combined" ? null : tab;

  const rows: InkRow[] = useMemo(() => {
    const built = positions.map((p) => {
      const base = plans[p.key] ?? plans[p.legacyKey] ?? EMPTY_PLAN;
      // The company tabs use that book's own sales; Combined uses the group's.
      const live = consumption?.get(p.key);
      const src = companyKey ? live?.byCompany[companyKey] : live;
      const plan: InkPlan = {
        ...base,
        threeMonthAvg: base.manual?.threeMonthAvg ? base.threeMonthAvg : (src?.threeMonthAvg ?? 0),
        perDayAvg: base.manual?.perDayAvg ? base.perDayAvg : (src?.perDayAvg ?? 0),
      };
      return deriveInkRow(p, plan, shipments, thresholds, companyKey);
    });
    // EVERY NUMBERED LINE SHOWS, stock or not. The number is the planner's decision that a line
    // belongs on the sheet — an ink at zero stock that they numbered is exactly the one they want
    // to watch — so no stock filter second-guesses it. `positions` is already numbered-only.
    const scoped = built;
    const q = search.trim().toUpperCase();
    const searched = q
      ? scoped.filter((r) => r.itemCode.includes(q) || r.description.toUpperCase().includes(q))
      : scoped;
    return searched.filter((r) =>
      Object.entries(colFilters).every(([id, f]) => {
        if (!isFilterActive(f)) return true;
        const v = cellValue(r, id);
        if (typeof v === "number" || v === null) {
          // A blank cell fails any range: "20 and over" is not a claim an unknown can satisfy.
          if (v === null) return false;
          if (f.min !== undefined && v < f.min) return false;
          if (f.max !== undefined && v > f.max) return false;
          return true;
        }
        const text = v ?? "";
        if (f.text?.trim() && !text.toUpperCase().includes(f.text.trim().toUpperCase())) return false;
        if (f.list?.length && !f.list.includes(text)) return false;
        return true;
      }),
    );
    // NOT re-sorted here. loadInkPositions already applied the planner's own row order, and
    // sorting again would throw it away.
  }, [positions, plans, consumption, shipments, thresholds, companyKey, search, colFilters, order]);

  /**
   * Consignment columns, one per entry, mirroring the sheet. Scoped to the book in view.
   *
   * Split in two: shipments first, then the plant's weekly orders, so the sheet reads
   * left-to-right as bought-in supply and then made-here supply, with a total after each.
   */
  const inScope = useMemo(
    () =>
      shipments
        .filter((s) => !companyKey || s.company === companyKey)
        // EMPTY COLUMNS STAY. This used to drop any consignment with no quantities on it, which
        // made a column added here invisible the moment it was created — there is nowhere to type
        // a quantity until the column exists. An empty column is the planner's to fill or delete.
        .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")),
    [shipments, companyKey],
  );
  const shipmentCols = useMemo(() => inScope.filter((s) => s.status !== "PLANT"), [inScope]);
  const plantCols = useMemo(() => inScope.filter((s) => s.status === "PLANT"), [inScope]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({
          stock: t.stock + r.stock,
          plant: t.plant + r.plant,
          etd: t.etd + r.etd,
          eta: t.eta + r.eta,
          atPort: t.atPort + r.atPort,
          total: t.total + r.total,
        }),
        { stock: 0, plant: 0, etd: 0, eta: 0, atPort: 0, total: 0 },
      ),
    [rows],
  );

  const reorderCount = rows.filter((r) => r.band === "low" || r.band === "mid").length;


  /**
   * What one column holds for one row. A string for the columns you read, a number for the ones
   * you compare, null where a figure has not been worked out — the single place that knows how
   * a column id maps to a value, used by the filters and by nothing else.
   */
  const cellValue = (r: InkRow, id: string): string | number | null => {
    if (id.startsWith("co:")) return r.byCompany[id.slice(3)] ?? 0;
    if (id.startsWith("ship:") || id.startsWith("plant:")) {
      const sid = id.slice(id.indexOf(":") + 1);
      const ship = shipments.find((x) => x.id === sid);
      if (!ship || !r.itemCode) return 0;
      return ship.lines.filter((l) => l.itemCode === r.itemCode).reduce((t, l) => t + l.qty, 0);
    }
    switch (id) {
      case "no": return order[r.key] ?? order[r.legacyKey] ?? null;
      case "group": return r.group;
      case "code": return r.itemCode;
      case "description": return r.description;
      case "remark": return r.remark;
      case "category": return r.category;
      case "source": return sourceLabel(r.source);
      case "m3": return r.plan.threeMonthAvg;
      case "pd": return r.plan.perDayAvg;
      case "lead": return r.plan.leadTime;
      case "safety": return r.plan.safetyFactor;
      case "days": return r.daysCover;
      case "withEta": return r.daysCoverWithIncoming;
      case "monthMax": return r.monthMaxLevel;
      case "dailyMax": return r.dailyMaxLevel;
      case "stock": return r.stock;
      case "incoming": return r.incoming;
      case "plantTotal": return r.plant;
      case "total": return r.total;
      default: return null;
    }
  };

  /** Which control a heading's funnel opens. Everything else is a number range. */
  const FILTER_KIND: Record<string, "text" | "list" | "number"> = {
    group: "list",
    code: "text",
    description: "text",
    remark: "list",
    category: "list",
    source: "list",
  };

  /**
   * The values a list filter offers, taken from every line the tab shows — NOT from the rows
   * left after filtering, or the value you just picked would be the only one left to pick.
   */
  const listOptions = useMemo(() => {
    const cache: Record<string, string[]> = {};
    return (id: string) => {
      if (cache[id]) return cache[id];
      const seen = new Set<string>();
      for (const p of positions) {
        if (id === "group") seen.add(p.group);
        else if (id === "category") seen.add(p.category);
        else if (id === "source") seen.add(sourceLabel(p.source));
      }
      if (id === "remark") ["NEW ORDER REQUIRED", "EXCESS STOCK", ""].forEach((v) => seen.add(v));
      cache[id] = [...seen].sort((a, b) => a.localeCompare(b));
      return cache[id];
    };
  }, [positions]);

  /** The funnel itself, dropped into a heading. */
  const colFilter = (id: string) => (
    <HeaderFilter
      kind={FILTER_KIND[id] ?? "number"}
      value={colFilters[id]}
      options={FILTER_KIND[id] === "list" ? listOptions(id) : undefined}
      onChange={(next) => setColFilter(id, next)}
    />
  );

  const filtersOn = Object.keys(colFilters).length > 0;
  const clearFilters = () => setColFilters({});

  // The company columns exist only on Combined, and only when the group is open.
  const cols = useTableColumns("dashboard");
  /** Frozen by default; a narrow screen is better off without the pin eating its width. */
  const [freeze, setFreeze] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("ink-mis:freeze") !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("ink-mis:freeze", freeze ? "1" : "0");
    } catch {
      /* private mode: the toggle still works for this visit */
    }
  }, [freeze]);
  const showCompanyCols = !companyKey && companiesOpen && cols.isVisible("companies");
  const showShipmentCols = cols.isVisible("shipments");
  const showPlantCols = cols.isVisible("plant");

  /**
   * The planning block, left of the stock columns. Item code is not hideable: without it a row
   * cannot be identified. Stock and Total are not hideable either — they are the answer.
   */
  /**
   * FROZEN LEAD COLUMNS.
   *
   * The sheet is thirty columns wide, so by the time the planner has scrolled out to a
   * consignment column the ink's name is long gone and they cannot tell which row they are
   * typing into. The identity block — number, group, code, description — is pinned to the left
   * and the rest scrolls under it.
   *
   * A pinned column needs a KNOWN width, or every offset after it is a guess; these are the
   * widths used when the planner has not resized one, and the same numbers drive both the cell
   * and the offset of its neighbours. Resizing still works: `widthOf` wins where it is set.
   */
  const PINNED = ["no", "group", "code", "description"] as const;
  const PIN_WIDTH: Record<string, number> = { no: 56, group: 160, code: 144, description: 256 };

  const LEAD_COLS = [
    // The planner's own row number. On the sheet because "why is this line here?" is otherwise
    // unanswerable from the dashboard — the order is theirs, and they should be able to see it
    // rather than infer it from the position.
    { id: "no", label: "No." },
    { id: "group", label: "Group" },
    { id: "code", label: "Item code", locked: true },
    { id: "description", label: "Description" },
    { id: "remark", label: "Remark" },
    { id: "m3", label: "3-month avg" },
    { id: "pd", label: "Per day avg" },
    { id: "lead", label: "Lead time" },
    { id: "safety", label: "Safety" },
    { id: "days", label: "Days cover" },
    { id: "withEta", label: "With ETA" },
    { id: "monthMax", label: "Month max" },
    { id: "dailyMax", label: "Daily max" },
  ];
  const leadVisible = LEAD_COLS.filter((c) => c.locked || cols.isVisible(c.id));

  /** Left offset of each pinned column: the widths of the pinned columns before it. */
  const pinLeft = useMemo(() => {
    const out: Record<string, number> = {};
    let x = 0;
    for (const id of PINNED) {
      if (!leadVisible.some((c) => c.id === id)) continue;
      out[id] = x;
      x += cols.widthOf(id) ?? PIN_WIDTH[id];
    }
    return out;
  }, [cols, leadVisible]);

  /** Everything a pinned BODY cell needs: the same offset, a solid background, and the width. */
  const pinCell = (id: string, tone = "bg-background") => {
    const left = pinLeft[id];
    if (!freeze || left === undefined) return { className: "", style: undefined as CSSProperties | undefined };
    const width = cols.widthOf(id) ?? PIN_WIDTH[id];
    return {
      className: `sticky z-[2] ${tone}`,
      style: { left, width, minWidth: width, maxWidth: width } as CSSProperties,
    };
  };
  const on = (id: string) => leadVisible.some((c) => c.id === id);
  const columnOptions = [
    ...LEAD_COLS.filter((c) => !c.locked).map((c) => ({ value: c.id, label: c.label })),
    { value: "companies", label: "Stock by company" },
    { value: "shipments", label: "Consignment columns" },
    { value: "plant", label: "Plant weekly columns" },
    { value: "incoming", label: "ETA + at port" },
    { value: "category", label: "Category" },
    { value: "source", label: "Import/Plant" },
  ];
  const visibleColumnIds = columnOptions.map((o) => o.value).filter((id) => cols.isVisible(id));

  /* --------------------------------------------------- consignment columns, inline */

  /**
   * A new column lands on the far right of a table thirty columns wide, which is off screen —
   * the planner pressed the button and saw nothing happen. So the column is remembered, scrolled
   * to, and ringed until it is touched.
   */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const newColumnRef = useRef<HTMLTableCellElement | null>(null);

  useEffect(() => {
    if (!justAdded) return;
    newColumnRef.current?.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
    const t = window.setTimeout(() => setJustAdded(null), 6000);
    return () => window.clearTimeout(t);
  }, [justAdded]);

  const addColumn = (status: ShipmentStatus) => {
    const today = new Date().toISOString().slice(0, 10);
    // Scoped to the book in view, so a column added on a company tab is visible there; on
    // Combined it stays unattached, which is how the sheet has always worked.
    const column = {
      ...emptyShipment(),
      status,
      date: today,
      company: companyKey ?? "",
      lines: [],
    };
    setShipments((prev) => [...prev, column]);
    setJustAdded(column.id);
  };

  const patchColumn = (id: string, patch: Partial<Shipment>) =>
    setShipments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const removeColumn = (id: string, label: string) => {
    if (!window.confirm(`Delete the ${label} column? Its quantities are removed with it.`)) return;
    setShipments((prev) => prev.filter((s) => s.id !== id));
  };

  /** One cell: the quantity of one ink on one consignment. Blank removes the line entirely. */
  const setCellQty = (shipmentId: string, itemCode: string, raw: string) =>
    setShipments((prev) =>
      prev.map((s) => {
        if (s.id !== shipmentId) return s;
        const qty = Number(raw);
        const rest = s.lines.filter((l) => l.itemCode !== itemCode);
        if (!raw.trim() || !Number.isFinite(qty) || qty === 0) return { ...s, lines: rest };
        return { ...s, lines: [...rest, { id: newId(), itemCode, qty }] };
      }),
    );

  const setPlan = (code: string, patch: Partial<InkPlan>) =>
    setPlans((prev) => ({ ...prev, [code]: { ...(prev[code] ?? EMPTY_PLAN), ...patch } }));

  /** Typing an average marks it typed; emptying the box gives the ink back to the live figure. */
  const setAverage = (code: string, field: "threeMonthAvg" | "perDayAvg", raw: string) =>
    setPlans((prev) => {
      const cur = prev[code] ?? EMPTY_PLAN;
      const typed = raw.trim() !== "";
      return {
        ...prev,
        [code]: {
          ...cur,
          [field]: typed ? Number(raw) || 0 : 0,
          manual: { ...cur.manual, [field]: typed },
        },
      };
    });

  /** Props for a pinned HEADING: the id, its offset and the width the offset assumes. */
  const pinHead = (id: string) => ({
    id,
    stickyLeft: freeze ? pinLeft[id] : undefined,
    fallbackWidth: PIN_WIDTH[id],
    className: freeze ? "bg-card" : "",
  });

  /** Merge a pinned cell's props with the classes the cell already wanted. */
  const pinMerge = (
    pinned: { className: string; style: CSSProperties | undefined },
    extra: string,
  ) => ({ className: `${pinned.className} ${extra}`.trim(), style: pinned.style });

  /** A consignment column heading: read-only until Edit values is on, then fully editable. */
  const consignmentHeader = (s: Shipment) => (
    <span ref={s.id === justAdded ? newColumnRef : undefined} className="block">
      {consignmentHeaderBody(s)}
    </span>
  );

  const consignmentHeaderBody = (s: Shipment) =>
    editing ? (
      <div className="space-y-1 text-left font-normal">
        <div className="flex items-center gap-1">
          <select
            className="h-6 w-full min-w-0 rounded border bg-background px-1 text-[10px]"
            value={s.status}
            onChange={(e) => patchColumn(s.id, { status: e.target.value as ShipmentStatus })}
          >
            {SHIPMENT_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="Delete this column"
            aria-label="Delete this column"
            className="shrink-0 text-muted-foreground hover:text-red-600"
            onClick={() => removeColumn(s.id, s.reference || s.status)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <Input
          className="h-6 w-full min-w-0 px-1 text-[11px]"
          placeholder="Reference"
          value={s.reference}
          onChange={(e) => patchColumn(s.id, { reference: e.target.value })}
        />
        <Input
          type="date"
          className="h-6 w-full min-w-0 px-1 text-[10px]"
          value={s.date}
          onChange={(e) => patchColumn(s.id, { date: e.target.value })}
        />
      </div>
    ) : (
      <>
        <div className="text-[10px] uppercase text-muted-foreground">
          {s.status === "PLANT" ? "Plant week" : s.status}
        </div>
        <div>
          {s.reference || "(no ref)"}
          {colFilter(`${s.status === "PLANT" ? "plant" : "ship"}:${s.id}`)}
        </div>
        <div className="text-[10px] font-normal text-muted-foreground">{s.date || "no date"}</div>
      </>
    );

  /** One consignment cell. Typed straight into while Edit values is on. */
  const consignmentCell = (s: Shipment, r: InkRow) => {
    const q = s.lines
      .filter((l) => r.itemCode && l.itemCode === r.itemCode)
      .reduce((t, l) => t + l.qty, 0);
    return (
      <TableCell key={s.id} className="text-right tabular-nums">
        {editing && r.itemCode ? (
          <Input
            type="number"
            inputMode="decimal"
            className="h-8 w-20 text-right"
            value={q || ""}
            onChange={(e) => setCellQty(s.id, r.itemCode, e.target.value)}
          />
        ) : (
          (q ? fmtQty(q) : "")
        )}
      </TableCell>
    );
  };

  /* --------------------------------------------------------------------- export */

  const exportCsv = () => {
    const head = [
      "No.", "Group", "Item code", "Description", "Remark",
      "3-month avg", "Per day avg", "Lead time", "Safety factor",
      "Days cover", "Days cover with ETA", "Month max level", "Daily max level",
      ...(showCompanyCols ? INK_COMPANIES.map((c) => c.label) : []),
      "Stock", ...shipmentCols.map((s) => `${s.status} ${s.reference || "(no ref)"} ${s.date}`),
      "ETD", "ETA + at port", "Plant total", "Total", "Category", "Import/Plant", "To order",
    ];
    const body = rows.map((r) => [
      order[r.key] ?? order[r.legacyKey] ?? "", r.group, r.itemCode, r.description, r.remark,
      r.plan.threeMonthAvg, r.plan.perDayAvg, r.plan.leadTime, r.plan.safetyFactor,
      r.daysCover ?? "", r.daysCoverWithIncoming ?? "", r.monthMaxLevel, r.dailyMaxLevel,
      ...(showCompanyCols ? INK_COMPANIES.map((c) => r.byCompany[c.key] ?? 0) : []),
      r.stock,
      ...shipmentCols.map((s) =>
        s.lines.filter((l) => l.itemCode === r.itemCode).reduce((t, l) => t + l.qty, 0) || "",
      ),
      r.etd, r.incoming, r.plant, r.total, r.category, sourceLabel(r.source), reorderQty(r),
    ]);
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [head, ...body].map((line) => line.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `INK MIS ${tab} ${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ----------------------------------------------------------------------- view */

  const tabs = [{ key: "combined", label: "Combined" }, ...INK_COMPANIES.map((c) => ({ key: c.key, label: c.label }))];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ink MIS</h1>
          <p className="text-sm text-muted-foreground">
            Stock from Tally across four books, merged on item code, against the pipeline you
            maintain by hand.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <Button size="sm" variant="secondary" asChild>
            <Link to={`${BASE}/items`}>
              <ListChecks className="mr-2 h-4 w-4" /> Item master
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link to={`${BASE}/pipeline`}>
              <Ship className="mr-2 h-4 w-4" /> ETD / ETA entry
            </Link>
          </Button>
        </div>
      </div>

      {/* Tabs — combined plus one per book. */}
      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === t.key
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary strip — ONE LINE. Six boxed cards pushed the table below the fold, and the
          table is the report; these are context, so they read as a single row of figures and
          wrap only when the window is genuinely narrow. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-card px-3 py-2 text-sm">
        {[
          { label: "Inks", value: String(rows.length) },
          { label: "Stock", value: fmtQty(totals.stock) },
          { label: "ETA + at port", value: fmtQty(totals.eta + totals.atPort) },
          { label: "Plant", value: fmtQty(totals.plant) },
          { label: "ETD", value: fmtQty(totals.etd) },
          { label: "Needs ordering", value: String(reorderCount) },
        ].map((c) => (
          <span key={c.label} className="whitespace-nowrap">
            <span className="text-muted-foreground">{c.label} </span>
            <strong className="tabular-nums">{c.value}</strong>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-64 pl-8"
            placeholder="Search code or description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={scope}
          onChange={(e) => setScope(e.target.value as InkScope)}
          title="Which items this report lists"
        >
          <option value="ink">Ink groups only</option>
          <option value="all">Every stock group</option>
        </select>
        <Button
          variant={editing ? "default" : "outline"}
          size="sm"
          onClick={() => setEditing((v) => !v)}
        >
          <Pencil className="mr-2 h-4 w-4" /> {editing ? "Done editing" : "Edit values"}
        </Button>
        {editing && (
          <>
            {(["ETD", "ETA", "AT PORT", "PLANT"] as ShipmentStatus[]).map((st) => (
              <Button key={st} variant="outline" size="sm" onClick={() => addColumn(st)}>
                <Plus className="mr-1 h-4 w-4" /> {st}
              </Button>
            ))}
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void consumptionQuery.refetch()}
          disabled={consumptionQuery.isFetching || !nameToCode}
        >
          <Wand2 className="mr-2 h-4 w-4" />
          {consumptionQuery.isFetching ? "Reading the Sales Register…" : "Refresh averages"}
        </Button>
        {filtersOn && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        <MultiSelect
          values={visibleColumnIds}
          onChange={(v) => cols.setHidden(columnOptions.map((o) => o.value).filter((id) => !v.includes(id)))}
          options={columnOptions}
          triggerLabel="Columns"
          triggerClassName="py-1.5 px-2.5 text-[12.5px]"
        />
        <label className="inline-flex items-center gap-2 text-sm" title="Keep number, group, code and description on screen while you scroll right">
          <input type="checkbox" checked={freeze} onChange={(e) => setFreeze(e.target.checked)} />
          Freeze name columns
        </label>
        {cols.customised && (
          <Button variant="ghost" size="sm" onClick={cols.reset} title="Show every column at its automatic width">
            Reset columns
          </Button>
        )}
        {(["low", "mid", "normal", "excess"] as InkBand[]).map((b) => (
          <span key={b} className={`rounded px-2 py-1 text-xs ${BAND_CLASS[b]}`}>
            {BAND_LABEL[b]}
          </span>
        ))}
      </div>

      {/* The standing explanation of how the averages are worked out has gone: it said the same
          thing on every visit and cost a band across the page. What is left appears only when it
          changes what the planner should believe — a failure, or their own typed figures sitting
          on top of the live ones. The rule itself lives on the two column headings and in
          lib/inkMis.ts. */}
      {(consumptionQuery.isError || typedCount > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {consumptionQuery.isError && (
            <span>
              Could not read the Sales Register:{" "}
              {consumptionQuery.error instanceof Error ? consumptionQuery.error.message : "unknown error"}
            </span>
          )}
          {typedCount > 0 && (
            <button type="button" className="font-semibold underline" onClick={clearTypedAverages}>
              {typedCount} ink{typedCount === 1 ? " has" : "s have"} typed averages — use live figures
            </button>
          )}
        </div>
      )}

      {justAdded && (
        <div className="rounded-md border border-primary bg-primary/10 px-3 py-2 text-sm">
          Column added at the right-hand end of the table, after the existing consignment
          columns. Fill in its reference, date and quantities there.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          Could not load stock: {error instanceof Error ? error.message : "unknown error"}
        </div>
      )}

      {needsCode > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{needsCode}</strong> line{needsCode === 1 ? "" : "s"} have no item code, so
            the same ink in two books is still showing as two lines.
          </span>
          <Button size="sm" variant="outline" asChild className="ml-auto">
            <Link to={`${BASE}/items`}>
              <ListChecks className="mr-2 h-4 w-4" /> Fill codes in the item master
            </Link>
          </Button>
        </div>
      )}

      <ReorderChart rows={rows} />

      {/*
        THE TABLE SCROLLS IN ITS OWN BOX, not with the page.
        A sticky heading pins to its scrolling ancestor, so with the page doing the scrolling
        there was nothing for it to pin to and the headings simply left. Giving the table a
        height of its own fixes that, and keeps the left/right buttons above it on screen
        instead of stranded at the top of a long page.
      */}
      <ScrollableTable maxHeight="max-h-[calc(100vh-13rem)]">
        <Table
          className={
            // Every heading sticks to the top of that box. The two rows that must NOT stick —
            // the company band above and the filter row below — switch it back off, or all
            // three would pile up at the same offset.
            "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-[4] [&_thead_th]:bg-card"
          }
        >
          <TableHeader>
            {!companyKey && cols.isVisible("companies") && (
              <TableRow className="bg-card hover:bg-card [&>th]:!static">
                {leadVisible.length > 0 && <TableHead colSpan={leadVisible.length} />}
                <TableHead
                  colSpan={showCompanyCols ? INK_COMPANIES.length + 1 : 1}
                  className="border-x text-center"
                >
                  <button
                    type="button"
                    onClick={() => setCompaniesOpen((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:underline"
                    title={showCompanyCols ? "Collapse the four companies into one column" : "Show each company's stock"}
                  >
                    {showCompanyCols ? "− All four companies" : "+ All four companies"}
                  </button>
                </TableHead>
                <TableHead
                  colSpan={
                    (showShipmentCols ? shipmentCols.length : 0) +
                    (cols.isVisible("incoming") ? 1 : 0) +
                    (showPlantCols ? plantCols.length : 0) +
                    2
                  }
                />
              </TableRow>
            )}
            <TableRow>
              {on("no") && (
                <ResizableHead {...pinHead("no")} cols={cols} className="text-right">
                  No.{colFilter("no")}
                </ResizableHead>
              )}
              {on("group") && (
                <ResizableHead {...pinHead("group")} cols={cols}>
                  Group{colFilter("group")}
                </ResizableHead>
              )}
              <ResizableHead {...pinHead("code")} cols={cols}>
                Item code{colFilter("code")}
              </ResizableHead>
              {on("description") && (
                <ResizableHead {...pinHead("description")} cols={cols}>
                  Description{colFilter("description")}
                </ResizableHead>
              )}
              {on("remark") && (
                <ResizableHead id="remark" cols={cols} className="min-w-[11rem]">
                  Remark{colFilter("remark")}
                </ResizableHead>
              )}
              {on("m3") && (
                <ResizableHead id="m3" cols={cols} className="text-right">
                  3-month avg{colFilter("m3")}
                  <div className="text-[10px] font-normal text-muted-foreground">last 3 months ÷ 3</div>
                </ResizableHead>
              )}
              {on("pd") && (
                <ResizableHead id="pd" cols={cols} className="text-right">
                  Per day avg{colFilter("pd")}
                  <div className="text-[10px] font-normal text-muted-foreground">
                    this month ÷ {workingDays} days
                  </div>
                </ResizableHead>
              )}
              {on("lead") && (
                <ResizableHead id="lead" cols={cols} className="text-right">
                  Lead time{colFilter("lead")}
                </ResizableHead>
              )}
              {on("safety") && (
                <ResizableHead id="safety" cols={cols} className="text-right">
                  Safety{colFilter("safety")}
                </ResizableHead>
              )}
              {on("days") && (
                <ResizableHead id="days" cols={cols} className="text-right">
                  Days cover{colFilter("days")}
                </ResizableHead>
              )}
              {on("withEta") && (
                <ResizableHead id="withEta" cols={cols} className="text-right">
                  With ETA{colFilter("withEta")}
                </ResizableHead>
              )}
              {on("monthMax") && (
                <ResizableHead id="monthMax" cols={cols} className="text-right">
                  Month max{colFilter("monthMax")}
                </ResizableHead>
              )}
              {on("dailyMax") && (
                <ResizableHead id="dailyMax" cols={cols} className="text-right">
                  Daily max{colFilter("dailyMax")}
                </ResizableHead>
              )}
              {showCompanyCols &&
                INK_COMPANIES.map((c) => (
                  <ResizableHead key={c.key} id={`co:${c.key}`} cols={cols} className="text-right">
                    {c.label}
                    {colFilter(`co:${c.key}`)}
                  </ResizableHead>
                ))}
              <ResizableHead
                id="stock"
                cols={cols}
                className={`text-right font-semibold ${!companyKey && !showCompanyCols ? "border-x" : ""}`}
              >
                {companyKey ? "Stock" : showCompanyCols ? "Total stock" : "Stock (4 companies)"}
                {colFilter("stock")}
              </ResizableHead>
              {showShipmentCols &&
                shipmentCols.map((s) => (
                  <ResizableHead
                    key={s.id}
                    id={`ship:${s.id}`}
                    cols={cols}
                    className={`text-right ${s.id === justAdded ? "bg-primary/15 ring-2 ring-primary" : ""}`}
                  >
                    {consignmentHeader(s)}
                  </ResizableHead>
                ))}
              {cols.isVisible("incoming") && (
                <ResizableHead id="incoming" cols={cols} className="text-right">
                  ETA + at port{colFilter("incoming")}
                </ResizableHead>
              )}
              {showPlantCols &&
                plantCols.map((s) => (
                  <ResizableHead
                    key={s.id}
                    id={`plant:${s.id}`}
                    cols={cols}
                    className={`text-right ${s.id === justAdded ? "bg-primary/15 ring-2 ring-primary" : ""}`}
                  >
                    {consignmentHeader(s)}
                  </ResizableHead>
                ))}
              <ResizableHead id="plantTotal" cols={cols} className="text-right">
                Plant total{colFilter("plantTotal")}
              </ResizableHead>
              <ResizableHead id="total" cols={cols} className="text-right font-semibold">
                Total{colFilter("total")}
              </ResizableHead>
              {cols.isVisible("category") && (
                <ResizableHead id="category" cols={cols} className="min-w-[10rem]">
                  Category{colFilter("category")}
                </ResizableHead>
              )}
              {cols.isVisible("source") && (
                <ResizableHead id="source" cols={cols} className="min-w-[9rem]">
                  Import/Plant{colFilter("source")}
                </ResizableHead>
              )}
            </TableRow>
          </TableHeader>

          <TableBody>
            {/* TOTALS FIRST. They were in a footer, which on a table this tall meant scrolling
                past every row to read the one line that summarises them. */}
            {rows.length > 0 && (
              <TableRow className="border-b-2 bg-muted/50 font-semibold hover:bg-muted/50">
                <TableCell colSpan={leadVisible.length}>Total — {rows.length} inks</TableCell>
                {showCompanyCols &&
                  INK_COMPANIES.map((c) => (
                    <TableCell key={c.key} className="text-right tabular-nums">
                      {fmtQty(rows.reduce((t, r) => t + (r.byCompany[c.key] ?? 0), 0))}
                    </TableCell>
                  ))}
                <TableCell className="text-right tabular-nums">{fmtQty(totals.stock)}</TableCell>
                {showShipmentCols &&
                  shipmentCols.map((s) => (
                    <TableCell key={s.id} className="text-right tabular-nums">
                      {fmtQty(s.lines.reduce((t, l) => t + l.qty, 0))}
                    </TableCell>
                  ))}
                {cols.isVisible("incoming") && (
                  <TableCell className="text-right tabular-nums">
                    {fmtQty(totals.eta + totals.atPort)}
                  </TableCell>
                )}
                {showPlantCols &&
                  plantCols.map((s) => (
                    <TableCell key={s.id} className="text-right tabular-nums">
                      {fmtQty(s.lines.reduce((t, l) => t + l.qty, 0))}
                    </TableCell>
                  ))}
                <TableCell className="text-right tabular-nums">{fmtQty(totals.plant)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(totals.total)}</TableCell>
                {cols.isVisible("category") && <TableCell />}
                {cols.isVisible("source") && <TableCell />}
              </TableRow>
            )}

            {isLoading && (
              <TableRow>
                <TableCell colSpan={40} className="py-10 text-center text-muted-foreground">
                  Loading ink stock from ConnectWave…
                </TableCell>
              </TableRow>
            )}

            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={40} className="py-10 text-center text-muted-foreground">
                  {positions.length === 0
                    ? "No numbered items yet. Give an item a number in the item master to show it here."
                    : "No inks to show."}
                </TableCell>
              </TableRow>
            )}

            {rows.map((r) => (
              <TableRow key={r.key}>
                {on("no") && (
                  <TableCell
                    {...pinMerge(pinCell("no"), "text-right text-xs tabular-nums text-muted-foreground")}
                  >
                    {order[r.key] ?? order[r.legacyKey] ?? ""}
                  </TableCell>
                )}
                {on("group") && (
                  <TableCell {...pinMerge(pinCell("group"), "text-xs")}>{r.group}</TableCell>
                )}
                <TableCell {...pinMerge(pinCell("code"), "font-medium")}>{r.itemCode}</TableCell>
                {on("description") && (
                  <TableCell {...pinCell("description")}>{r.description}</TableCell>
                )}
                {on("remark") && (
                  <TableCell>
                    {r.remark && (
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          r.remark === "EXCESS STOCK" ? "bg-fuchsia-100 text-fuchsia-900" : "bg-red-100 text-red-900"
                        }`}
                      >
                        {r.remark}
                      </span>
                    )}
                  </TableCell>
                )}

                {/* Planner inputs — the four editable cells. */}
                {(
                  [
                    ["m3", "threeMonthAvg", r.plan.threeMonthAvg],
                    ["pd", "perDayAvg", r.plan.perDayAvg],
                    ["lead", "leadTime", r.plan.leadTime],
                    ["safety", "safetyFactor", r.plan.safetyFactor],
                  ] as [string, keyof InkPlan, number][]
                )
                  .filter(([id]) => on(id))
                  .map(([id, field, value]) => (
                    <TableCell key={id} className="text-right tabular-nums">
                      {editing ? (
                        <Input
                          type="number"
                          inputMode="decimal"
                          className="h-8 w-20 text-right"
                          value={value || ""}
                          onChange={(e) =>
                            field === "threeMonthAvg" || field === "perDayAvg"
                              ? setAverage(r.key, field, e.target.value)
                              : setPlan(r.key, { [field]: Number(e.target.value) || 0 })
                          }
                        />
                      ) : (
                        fmtDays(value || null)
                      )}
                    </TableCell>
                  ))}

                {on("days") && <TableCell className="text-right tabular-nums">{fmtDays(r.daysCover)}</TableCell>}
                {on("withEta") && <TableCell className="text-right tabular-nums">{fmtDays(r.daysCoverWithIncoming)}</TableCell>}
                {on("monthMax") && <TableCell className="text-right tabular-nums">{fmtQty(r.monthMaxLevel)}</TableCell>}
                {on("dailyMax") && <TableCell className="text-right tabular-nums">{fmtQty(r.dailyMaxLevel)}</TableCell>}

                {showCompanyCols &&
                  INK_COMPANIES.map((c) => (
                    <TableCell key={c.key} className="text-right tabular-nums">
                      {fmtQty(r.byCompany[c.key])}
                    </TableCell>
                  ))}

                <TableCell className={`text-right tabular-nums ${BAND_CLASS[r.band]}`}>
                  {fmtQty(r.stock)}
                  {r.coverPct !== null && <div className="text-[10px] font-normal opacity-70">{fmtPct(r.coverPct)}</div>}
                </TableCell>

                {showShipmentCols && shipmentCols.map((s) => consignmentCell(s, r))}

                {cols.isVisible("incoming") && <TableCell className="text-right tabular-nums">{fmtQty(r.incoming)}</TableCell>}
                {showPlantCols && plantCols.map((s) => consignmentCell(s, r))}
                <TableCell className="text-right tabular-nums">{fmtQty(r.plant)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{fmtQty(r.total)}</TableCell>
                {cols.isVisible("category") && (
                  <TableCell className="text-xs">{r.category}</TableCell>
                )}
                {cols.isVisible("source") && (
                  <TableCell className="text-xs">{sourceLabel(r.source)}</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>

        </Table>
      </ScrollableTable>

      {/* Holidays. Sundays come out automatically; these are the extra closures. Kept visible
          rather than buried, because every date added raises every per-day average. */}
      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Working days — {workingDaysElapsed(new Date(), new Set(holidays))} so far this month
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-muted-foreground">
            Sundays are already excluded. Add public holidays and any other closure here, then
            fill the averages again. The per-day average divides this month's sales by the
            working days that have passed, so each date you add raises it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {holidays.length === 0 && (
              <span className="text-muted-foreground">No holidays added.</span>
            )}
            {[...holidays].sort().map((h) => (
              <span
                key={h}
                className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs"
              >
                {`${h.slice(6, 8)}-${h.slice(4, 6)}-${h.slice(0, 4)}`}
                <button
                  type="button"
                  aria-label={`Remove ${h}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setHolidays((prev) => prev.filter((d) => d !== h))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <Input
            type="date"
            className="w-48"
            onChange={(e) => {
              const ymd = e.target.value.replace(/-/g, "");
              if (!ymd) return;
              setHolidays((prev) => (prev.includes(ymd) ? prev : [...prev, ymd]));
              e.target.value = "";
            }}
          />
        </div>
      </details>

      {/* Band thresholds. Exposed because the sheet's cut-offs were read off its colouring
          rather than documented, so the planner must be able to correct them. */}
      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Colour thresholds</summary>
        <div className="mt-3 flex flex-wrap gap-4">
          {(
            [
              ["low", "Red below", thresholds.low],
              ["mid", "Amber below", thresholds.mid],
              ["excess", "Purple at or above", thresholds.excess],
              ["excessRemark", "Excess remark at or above", thresholds.excessRemark],
            ] as [keyof InkThresholds, string, number][]
          ).map(([field, label, value]) => (
            <label key={field} className="space-y-1">
              <span className="block text-xs text-muted-foreground">{label} (%)</span>
              <Input
                type="number"
                className="w-28"
                value={value}
                onChange={(e) =>
                  setThresholds((t) => ({ ...t, [field]: Number(e.target.value) || 0 }))
                }
              />
            </label>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="self-end"
            onClick={() => setThresholds(DEFAULT_THRESHOLDS)}
          >
            Reset
          </Button>
        </div>
      </details>
    </div>
  );
}
