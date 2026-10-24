import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import MultiSelect from "@/shared/components/ui/MultiSelect";

/**
 * The Ink Expiry table kit: click-to-sort headings, a filter under every heading, and — like the
 * Ink IMS sheet (apps/ink-mis/lib/tableColumns.tsx + InkMis.tsx) — Excel-style layout:
 *
 *   - COLUMN WIDTH: drag a heading's right edge, or any cell's right edge; double-click to reset.
 *   - ROW HEIGHT: drag any row's bottom edge (one height for every row); double-click to reset.
 *   - HEADING HEIGHT: drag the strip along the bottom of the heading row; double-click to reset.
 *   - COLUMNS: show / hide from the "Columns" menu (TableTools), with "Reset layout".
 * All remembered per browser, per table, under `ink-expiry:table:<tableKey>`. Nobody else sees it.
 *
 * Filtering: each column says how to show a value (`text`), how to order it (`sort`), and —
 * optionally — what to FILTER by (`bucket`). Numbers filter by band, not exact value. Options
 * cascade, so a choice never leads to an empty table. Sort is heading click: asc → desc → off.
 */

export interface Col<T> {
  key: string;
  label: string;
  align?: "right";
  /** Shown in the filter list, and used as the value when `bucket` is not given. */
  text: (r: T) => string;
  /** Sort value; null always sorts last. */
  sort: (r: T) => string | number | null;
  /** Filter group for this row (a band for numbers, a month for dates). */
  bucket?: (r: T) => string;
  /** Fixed order for bucket options (bands read in order, not alphabetically). */
  bucketOrder?: string[];
  filter?: boolean;
  render?: (r: T) => ReactNode;
  className?: string;
}

type Dir = "asc" | "desc";

/* ------------------------------------------------------------------ layout (look) -- */

const MIN_W = 48;
const ROW_PAD = 8, HEAD_PAD = 8, PAD_MIN = 1, PAD_MAX = 28;
const EDGE = 7;

interface Look { widths: Record<string, number>; hidden: string[]; rowPad: number; headPad: number }
const FRESH: Look = { widths: {}, hidden: [], rowPad: ROW_PAD, headPad: HEAD_PAD };

function readLook(key: string | undefined): Look {
  if (!key) return FRESH;
  try {
    const v = JSON.parse(localStorage.getItem(`ink-expiry:table:${key}`) ?? "{}") as Partial<Look>;
    return {
      widths: v.widths && typeof v.widths === "object" ? v.widths : {},
      hidden: Array.isArray(v.hidden) ? v.hidden : [],
      rowPad: typeof v.rowPad === "number" ? v.rowPad : ROW_PAD,
      headPad: typeof v.headPad === "number" ? v.headPad : HEAD_PAD,
    };
  } catch {
    return FRESH;
  }
}

function useLook(key: string | undefined) {
  const [look, setLook] = useState<Look>(() => readLook(key));
  useEffect(() => {
    if (!key) return;
    try { localStorage.setItem(`ink-expiry:table:${key}`, JSON.stringify(look)); } catch { /* this visit only */ }
  }, [key, look]);
  return {
    look,
    setWidth: (id: string, px: number | undefined) => setLook((l) => {
      const widths = { ...l.widths };
      if (px === undefined) delete widths[id]; else widths[id] = Math.max(MIN_W, Math.round(px));
      return { ...l, widths };
    }),
    setHidden: (hidden: string[]) => setLook((l) => ({ ...l, hidden })),
    setRowPad: (p: number) => setLook((l) => ({ ...l, rowPad: Math.min(PAD_MAX, Math.max(PAD_MIN, p)) })),
    setHeadPad: (p: number) => setLook((l) => ({ ...l, headPad: Math.min(PAD_MAX, Math.max(PAD_MIN, p)) })),
    resetLook: () => setLook(FRESH),
    customised: Object.keys(look.widths).length > 0 || look.hidden.length > 0 || look.rowPad !== ROW_PAD || look.headPad !== HEAD_PAD,
  };
}

/** Run a drag: `move` gets the pointer travel since the press, in px. */
function drag(e: ReactMouseEvent, cursor: string, move: (dx: number, dy: number) => void) {
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX, y0 = e.clientY;
  const prevCursor = document.body.style.cursor, prevSelect = document.body.style.userSelect;
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  const onMove = (ev: MouseEvent) => move(ev.clientX - x0, ev.clientY - y0);
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = prevCursor;
    document.body.style.userSelect = prevSelect;
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

/* ------------------------------------------------------------------ the hook -- */

/** `tableKey` names the table for its remembered layout; without it the layout is not kept. */
export function useSortFilter<T>(rows: T[], cols: Col<T>[], tableKey?: string) {
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);
  const layout = useLook(tableKey);

  const val = (c: Col<T>, r: T) => (c.bucket ?? c.text)(r);
  const passes = (r: T, skip?: string) =>
    cols.every((c) => c.key === skip || !(filters[c.key]?.length) || filters[c.key].includes(val(c, r)));

  const view = useMemo(() => {
    const out = rows.filter((r) => passes(r));
    if (!sort) return out;
    const c = cols.find((x) => x.key === sort.key);
    if (!c) return out;
    const k = sort.dir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const x = c.sort(a), y = c.sort(b);
      if (x === null || x === "") return y === null || y === "" ? 0 : 1;
      if (y === null || y === "") return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * k;
    });
  }, [rows, filters, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = (c: Col<T>) => {
    // Options read in the column's own order (Jan before Apr, not alphabetical): each option is
    // placed by the smallest sort value among its rows; blanks last.
    const seen = new Map<string, { n: number; s: string | number | null }>();
    for (const r of rows) {
      if (!passes(r, c.key)) continue;
      const v = val(c, r), s = c.sort(r);
      const cur = seen.get(v);
      if (!cur) seen.set(v, { n: 1, s });
      else { cur.n++; if (s !== null && (cur.s === null || s < cur.s)) cur.s = s; }
    }
    const order = c.bucketOrder;
    const cmp = (a: string | number | null, b: string | number | null) =>
      a === null ? (b === null ? 0 : 1) : b === null ? -1
      : typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "en", { numeric: true });
    return [...seen.entries()]
      .sort((a, b) => order ? order.indexOf(a[0]) - order.indexOf(b[0]) : cmp(a[1].s, b[1].s))
      .map(([v, { n }]) => ({ value: v, label: `${v || "(blank)"} (${n})` }));
  };

  const toggleSort = (key: string) => setSort((s) =>
    !s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null);
  const active = Object.values(filters).filter((v) => v.length).length;
  const clear = () => { setFilters({}); setSort(null); };
  /** A key that changes whenever the visible rows do — for resetting pagination. */
  const stamp = `${JSON.stringify(filters)}|${sort?.key}:${sort?.dir}`;
  /** The columns the reader has not hidden, in order. */
  const shown = (all: Col<T>[]) => all.filter((c) => !layout.look.hidden.includes(c.key));

  return { view, filters, setFilters, sort, toggleSort, options, active, clear, stamp, layout, shown };
}

type Ctl<T> = ReturnType<typeof useSortFilter<T>>;

const filterClass =
  "h-8 w-full min-w-0 rounded-lg border border-line bg-white px-2 text-[12px] font-normal normal-case tracking-normal text-ink " +
  "focus:outline-none focus:ring-2 focus:ring-orange/25 focus:border-orange/50";

const widthStyle = (w: number | undefined): CSSProperties | undefined => (w === undefined ? undefined : { width: w, minWidth: w, maxWidth: w });

export function SortFilterHead<T>({ cols, ctl }: { cols: Col<T>[]; ctl: Ctl<T> }) {
  const { look, setWidth, setHeadPad } = ctl.layout;
  const visible = ctl.shown(cols);
  const th = "relative px-3 text-[11.5px] font-semibold uppercase tracking-wide text-grey";
  return (
    <thead className="border-y border-line bg-page">
      <tr>
        {visible.map((c, i) => {
          const on = ctl.sort?.key === c.key ? ctl.sort.dir : null;
          const w = look.widths[c.key];
          return (
            <th key={c.key} data-col-id={c.key}
              className={`${th} ${w === undefined ? "whitespace-nowrap" : "whitespace-normal"} ${c.align === "right" ? "text-right" : "text-left"}`}
              style={{ ...widthStyle(w), paddingTop: look.headPad, paddingBottom: look.headPad }}
              aria-sort={on === "asc" ? "ascending" : on === "desc" ? "descending" : "none"}>
              <button onClick={() => ctl.toggleSort(c.key)} title="Sort"
                className={"inline-flex items-center gap-1 text-left uppercase hover:text-navy " + (on ? "text-navy" : "")}>
                {c.label}
                <span className="flex flex-col text-[8px] leading-[8px]">
                  <span className={on === "asc" ? "text-orange" : "text-grey-2/60"}>▲</span>
                  <span className={on === "desc" ? "text-orange" : "text-grey-2/60"}>▼</span>
                </span>
              </button>
              {/* Column width: drag the heading's right edge; double-click to reset. */}
              <span role="separator" aria-orientation="vertical" title="Drag to resize the column · double-click to reset"
                onMouseDown={(e) => {
                  const start = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;
                  drag(e, "col-resize", (dx) => setWidth(c.key, start + dx));
                }}
                onDoubleClick={(e) => { e.stopPropagation(); setWidth(c.key, undefined); }}
                className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize select-none border-r border-transparent hover:border-orange hover:bg-orange/10" />
              {/* Heading height: the strip along the bottom of the first heading. */}
              {i === 0 && (
                <span role="separator" aria-orientation="horizontal" title="Drag to make the heading row taller or shorter · double-click to reset"
                  onMouseDown={(e) => { const p0 = look.headPad; drag(e, "row-resize", (_dx, dy) => setHeadPad(p0 + dy / 2)); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setHeadPad(HEAD_PAD); }}
                  className="absolute inset-x-0 bottom-0 z-10 h-[5px] cursor-row-resize hover:bg-orange/30" />
              )}
            </th>
          );
        })}
      </tr>
      <tr className="border-t border-line bg-page/40">
        {visible.map((c) => (
          <th key={c.key} className="min-w-[96px] px-1.5 py-1.5 font-normal" style={widthStyle(look.widths[c.key])}>
            {c.filter === false ? null : (
              <MultiSelect
                values={ctl.filters[c.key] ?? []}
                onChange={(next) => ctl.setFilters((f) => ({ ...f, [c.key]: next }))}
                options={ctl.options(c)}
                placeholder="All"
                searchable
                triggerClassName={filterClass}
              />
            )}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * Body rows. Like a spreadsheet, the whole body listens: a press near a row's bottom edge drags the
 * row height (one height for every row), near a cell's right edge drags that column's width.
 */
export function SortFilterBody<T>({ cols, rows, rowKey, empty, ctl }: {
  cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; empty: string; ctl?: Ctl<T>;
}) {
  const look = ctl?.layout.look ?? FRESH;
  const visible = ctl ? ctl.shown(cols) : cols;

  const nearRowEdge = (e: ReactMouseEvent) => {
    const el = e.target as HTMLElement | null;
    if (!el || el.closest("input, select, textarea, button, a, [role=separator]")) return false;
    const row = el.closest("tr");
    return !!row && e.clientY >= row.getBoundingClientRect().bottom - EDGE;
  };
  const columnAt = (e: ReactMouseEvent): { key: string; td: HTMLTableCellElement } | null => {
    const el = e.target as HTMLElement | null;
    if (!el || el.closest("input, select, textarea, button, a, [role=separator]")) return null;
    const td = el.closest("td") as HTMLTableCellElement | null;
    if (!td || e.clientX < td.getBoundingClientRect().right - EDGE) return null;
    const c = visible[td.cellIndex];
    return c ? { key: c.key, td } : null;
  };

  const handlers = ctl ? {
    onMouseMove: (e: ReactMouseEvent<HTMLTableSectionElement>) => {
      e.currentTarget.style.cursor = nearRowEdge(e) ? "row-resize" : columnAt(e) ? "col-resize" : "";
    },
    onMouseDown: (e: ReactMouseEvent<HTMLTableSectionElement>) => {
      if (nearRowEdge(e)) { const p0 = look.rowPad; drag(e, "row-resize", (_dx, dy) => ctl.layout.setRowPad(p0 + dy / 2)); return; }
      const hit = columnAt(e);
      if (hit) { const w0 = hit.td.getBoundingClientRect().width; drag(e, "col-resize", (dx) => ctl.layout.setWidth(hit.key, w0 + dx)); }
    },
    onDoubleClick: (e: ReactMouseEvent<HTMLTableSectionElement>) => {
      if (nearRowEdge(e)) { ctl.layout.setRowPad(ROW_PAD); return; }
      const hit = columnAt(e);
      if (hit) ctl.layout.setWidth(hit.key, undefined);
    },
  } : {};

  return (
    <tbody {...handlers}>
      {rows.map((r) => (
        <tr key={rowKey(r)} className="border-b border-line">
          {visible.map((c) => {
            const w = look.widths[c.key];
            return (
              <td key={c.key}
                className={`px-3 text-[12.5px] ${w === undefined ? "whitespace-nowrap" : "whitespace-normal break-words"} ${c.align === "right" ? "text-right" : ""} ${c.className ?? ""}`}
                style={{ ...widthStyle(w), paddingTop: look.rowPad, paddingBottom: look.rowPad }}>
                {c.render ? c.render(r) : c.text(r)}
              </td>
            );
          })}
        </tr>
      ))}
      {rows.length === 0 && (
        <tr><td colSpan={visible.length} className="px-4 py-10 text-center text-[13px] text-grey">{empty}</td></tr>
      )}
    </tbody>
  );
}

/** "Columns" (show / hide) and "Reset layout" — for a table's header bar. */
export function TableTools<T>({ cols, ctl }: { cols: Col<T>[]; ctl: Ctl<T> }) {
  const { look, setHidden, resetLook, customised } = ctl.layout;
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <MultiSelect
        values={cols.filter((c) => !look.hidden.includes(c.key)).map((c) => c.key)}
        onChange={(v) => setHidden(cols.map((c) => c.key).filter((k) => !v.includes(k)))}
        options={cols.map((c) => ({ value: c.key, label: c.label }))}
        triggerLabel="Columns"
        className="w-32"
        triggerClassName="h-8 rounded-lg px-2.5 py-0 text-[12px]"
      />
      {customised && (
        <button onClick={resetLook} title="Column widths, row height, heading height and hidden columns back to default"
          className="h-8 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-grey hover:border-orange hover:text-orange">
          Reset layout
        </button>
      )}
    </div>
  );
}

/** "3 column filters · Clear" — shown above a table when any heading filter or sort is on. */
export function ActiveFilters<T>({ ctl, shown, total }: { ctl: Ctl<T>; shown: number; total: number }) {
  if (!ctl.active && !ctl.sort) return null;
  return (
    <div className="flex items-center gap-3 border-b border-line bg-orange/5 px-4 py-1.5 text-[12px] text-navy">
      <span>
        {ctl.active ? <>{ctl.active} column filter{ctl.active === 1 ? "" : "s"} on — <b>{shown.toLocaleString("en-IN")}</b> of {total.toLocaleString("en-IN")} rows</> : "Sorted"}
      </span>
      <button onClick={ctl.clear} className="font-semibold text-orange hover:underline">Clear filters &amp; sort</button>
    </div>
  );
}

/* ------------------------------------------------------------------ shared bands -- */

export const DAYS_LEFT_BANDS = ["Expired", "0–30 days", "31–90 days", "91–180 days", "181–365 days", "Over 1 year", "No expiry"];
export function daysLeftBand(days: number | null): string {
  if (days === null) return "No expiry";
  if (days < 0) return "Expired";
  if (days <= 30) return "0–30 days";
  if (days <= 90) return "31–90 days";
  if (days <= 180) return "91–180 days";
  if (days <= 365) return "181–365 days";
  return "Over 1 year";
}

export const AGE_BANDS = ["0–90 days", "91–180 days", "181–365 days", "Over 1 year", "Unknown"];
export function ageBand(days: number | null): string {
  if (days === null) return "Unknown";
  if (days <= 90) return "0–90 days";
  if (days <= 180) return "91–180 days";
  if (days <= 365) return "181–365 days";
  return "Over 1 year";
}

export const QTY_BANDS = ["Up to 50", "51–200", "201–500", "501–1,000", "Over 1,000"];
export function qtyBand(q: number): string {
  if (q <= 50) return "Up to 50";
  if (q <= 200) return "51–200";
  if (q <= 500) return "201–500";
  if (q <= 1000) return "501–1,000";
  return "Over 1,000";
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** '2026-09-15' → 'Sep 2026'; sorts correctly because the column's `sort` uses the ISO date. */
export const monthOf = (iso: string | null, blank = "(none)") => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : blank);
