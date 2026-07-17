import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import { exportRowsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";

/** Per-column filter behaviour. */
export type ColumnFilter<T> =
  | { kind: "text"; get: (row: T) => string }
  | { kind: "select"; get: (row: T) => string; options?: string[] }
  | { kind: "number"; get: (row: T) => number }
  | { kind: "date"; get: (row: T) => string }; // row value as ISO (date or datetime)

export interface QueueColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Provide to make this column's header clickable for sorting. */
  sortValue?: (row: T) => string | number;
  /** Typed per-column filter. Omit for no filter box on this column. */
  filter?: ColumnFilter<T>;
  align?: "left" | "right";
  /** Extra classes on the <td> (e.g. whitespace-nowrap). */
  tdClassName?: string;
  /**
   * The column's plain value for Excel. `cell` returns a ReactNode, which Excel
   * cannot render, so an export needs a text/number twin. Falls back to the
   * filter's or the sort's accessor — provide this only where neither exists, or
   * where they'd export the wrong thing.
   */
  exportValue?: (row: T) => string | number;
}

/**
 * The dimension rows are grouped under. Purchase groups by company; HR groups by
 * department. The grouping is always the primary sort order — an active column
 * sort orders rows *within* a group.
 */
export interface QueueGroupBy<T> {
  idOf: (row: T) => string | null;
  nameOf: (id: string) => string;
  /** The "no filter" option in the top bar, e.g. "All companies". */
  allLabel: string;
  /** Icon in the group header. Defaults to a building (Purchase's company glyph). */
  icon?: ReactNode;
  /** Header for the group column in an Excel export. Defaults to "Group". */
  label?: string;
}

interface QueueTableProps<T> {
  rows: T[];
  rowKey: (row: T) => string;
  columns: QueueColumn<T>[];
  groupBy: QueueGroupBy<T>;
  /** Leading actions cell (buttons / Open link) — rendered as the first column. */
  actions?: (row: T) => ReactNode;
  rowClassName?: (row: T) => string;
  rowsLabel?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  /** Pre-activate a sort column on first render. */
  initialSort?: { key: string; dir: "asc" | "desc" };
  /**
   * Opt in to Excel export by giving the file name stem (e.g. "HR_Requisitions").
   * Omitting it leaves the table exactly as it was — which is why Purchase's queues
   * are unchanged by this. The export always carries the CURRENTLY FILTERED AND
   * SORTED rows, not the raw set: what you see is what you get, and the About sheet
   * records which filters produced it.
   */
  exportName?: string;
  /** Title on the export's About sheet. Defaults to the file name stem. */
  exportTitle?: string;
  /** Extra "what this means" lines for the export's About sheet. */
  exportNotes?: string[];
}

type SortState = { key: string; dir: "asc" | "desc" } | null;
type FilterVal = string | { min: string; max: string } | { from: string; to: string };

const inputBase =
  "h-8 w-full min-w-0 rounded-lg border border-line bg-white px-2.5 text-[12.5px] text-ink placeholder:text-grey-2/60 focus:outline-none focus:ring-2 focus:ring-orange/25 focus:border-orange/50";

/** yyyy-mm-dd → dd-mm-yyyy for compact summaries. */
const dmy = (iso: string): string => (iso ? iso.split("-").reverse().join("-") : "");

const BuildingIcon = (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-orange" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M6 21V7l6-4 6 4v14M10 9h.01M14 9h.01M10 13h.01M14 13h.01M10 17h.01M14 17h.01" /></svg>
);

/**
 * Shared work-queue table: groups rows by a caller-chosen dimension, with a polished
 * per-column filter row (typed controls — text, dropdown, numeric min–max, and date
 * range), a per-group filter, sortable columns, and 25/page pagination. Grouping is
 * the primary order (group name A→Z); an active column sort orders rows WITHIN each
 * group. Every FMS queue uses this so they all behave identically.
 */
export default function QueueTable<T>({
  rows,
  rowKey,
  columns,
  groupBy,
  actions,
  rowClassName,
  rowsLabel = "rows",
  emptyTitle = "Nothing here",
  emptyMessage = "Items needing action will appear here.",
  initialSort,
  exportName,
  exportTitle,
  exportNotes,
}: QueueTableProps<T>) {
  const [filters, setFilters] = useState<Record<string, FilterVal>>({});
  const [group, setGroup] = useState<string>("all");
  const [sort, setSort] = useState<SortState>(initialSort ?? null);

  const { idOf, nameOf: groupNameOf, allLabel } = groupBy;

  const nameOf = (row: T): string => {
    const id = idOf(row);
    return id ? groupNameOf(id) : "—";
  };

  const isActive = (col: QueueColumn<T>): boolean => {
    const f = filters[col.key];
    if (!f || !col.filter) return false;
    if (col.filter.kind === "text" || col.filter.kind === "select") return (f as string) !== "";
    if (col.filter.kind === "number") { const v = f as { min: string; max: string }; return v.min !== "" || v.max !== ""; }
    const v = f as { from: string; to: string }; return v.from !== "" || v.to !== "";
  };

  const matches = (col: QueueColumn<T>, row: T): boolean => {
    const f = filters[col.key];
    if (!f || !col.filter || !isActive(col)) return true;
    switch (col.filter.kind) {
      case "text":
        return col.filter.get(row).toLowerCase().includes((f as string).trim().toLowerCase());
      case "select":
        return col.filter.get(row) === (f as string);
      case "number": {
        const { min, max } = f as { min: string; max: string };
        const v = col.filter.get(row);
        if (min !== "" && v < Number(min)) return false;
        if (max !== "" && v > Number(max)) return false;
        return true;
      }
      case "date": {
        const { from, to } = f as { from: string; to: string };
        const d = col.filter.get(row).slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }
    }
  };

  const hasActiveFilters = group !== "all" || columns.some(isActive);

  // Distinct groups present in the source rows (for the group filter).
  const groups = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const id = idOf(row);
      if (id && !map.has(id)) map.set(id, groupNameOf(id));
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, idOf, groupNameOf]);

  // Distinct option lists for every "select" filter column.
  const selectOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns) {
      if (c.filter?.kind === "select") {
        if (c.filter.options) { out[c.key] = c.filter.options; continue; }
        const set = new Set<string>();
        for (const row of rows) { const v = c.filter.get(row); if (v) set.add(v); }
        out[c.key] = [...set].sort((a, b) => a.localeCompare(b));
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns]);

  // Filter → sort (group primary, chosen column secondary).
  const sorted = useMemo(() => {
    let list = rows.filter((row) => {
      if (group !== "all" && idOf(row) !== group) return false;
      for (const col of columns) if (!matches(col, row)) return false;
      return true;
    });

    const col = sort ? columns.find((c) => c.key === sort.key && c.sortValue) : undefined;
    list = list
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        const cn = nameOf(a.row).localeCompare(nameOf(b.row)); // primary: keep groups together
        if (cn !== 0) return cn;
        if (col && sort) {
          const va = col.sortValue!(a.row);
          const vb = col.sortValue!(b.row);
          let d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
          if (sort.dir === "desc") d = -d;
          if (d !== 0) return d;
        }
        return a.i - b.i; // stable
      })
      .map((x) => x.row);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters, group, sort, columns]);

  // Per-group counts (of the filtered set) shown in each group header.
  const countByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of sorted) m.set(nameOf(row), (m.get(nameOf(row)) ?? 0) + 1);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted]);

  const pg = usePagination(sorted, { resetKey: `${JSON.stringify(filters)}|${group}|${sort?.key}|${sort?.dir}` });
  const colSpan = columns.length + (actions ? 1 : 0);

  const onSort = (key: string) =>
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const setFilter = (key: string, val: FilterVal) => setFilters((prev) => ({ ...prev, [key]: val }));
  const clearAll = () => { setFilters({}); setGroup("all"); };

  /* ------------------------------- Excel export ------------------------------ */

  /** The active filters in plain English, for the export's About sheet. */
  const filterSummary = (): string[] => {
    const out: string[] = [];
    if (group !== "all") out.push(`${groupBy.label ?? "Group"}: ${groupNameOf(group)}`);
    for (const col of columns) {
      if (!isActive(col) || !col.filter) continue;
      const f = filters[col.key];
      if (col.filter.kind === "text") out.push(`${col.header} contains "${f as string}"`);
      else if (col.filter.kind === "select") out.push(`${col.header} is "${f as string}"`);
      else if (col.filter.kind === "number") {
        const v = f as { min: string; max: string };
        out.push(`${col.header}: ${v.min || "any"} – ${v.max || "any"}`);
      } else {
        const v = f as { from: string; to: string };
        out.push(`${col.header}: ${v.from ? dmy(v.from) : "any"} → ${v.to ? dmy(v.to) : "any"}`);
      }
    }
    return out;
  };

  const exportNow = () => {
    if (!exportName) return;
    const cols = [
      { header: groupBy.label ?? "Group", width: 22, value: (row: T) => nameOf(row) },
      ...columns.map((c) => ({
        header: c.header,
        width: 20,
        value: (row: T): string | number =>
          c.exportValue?.(row) ?? c.filter?.get(row) ?? c.sortValue?.(row) ?? "",
      })),
    ];
    exportRowsToXlsx<T>({
      fileName: exportName,
      sheetName: exportTitle ?? exportName,
      title: exportTitle ?? exportName,
      columns: cols as ExportColumn<T>[],
      rows: sorted, // what is on screen after filtering + sorting, not the raw set
      filters: filterSummary(),
      notes: exportNotes,
    });
  };

  const renderFilter = (col: QueueColumn<T>) => {
    if (!col.filter) return null;
    const f = filters[col.key];
    switch (col.filter.kind) {
      case "text":
        return (
          <input value={(f as string) ?? ""} onChange={(e) => setFilter(col.key, e.target.value)} placeholder="Filter…" className={inputBase} />
        );
      case "select":
        return (
          <select value={(f as string) ?? ""} onChange={(e) => setFilter(col.key, e.target.value)} className={`${inputBase} pr-6 cursor-pointer`}>
            <option value="">All</option>
            {selectOptions[col.key]?.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      case "number": {
        const v = (f as { min: string; max: string }) ?? { min: "", max: "" };
        const active = v.min !== "" || v.max !== "";
        const summary = v.min && v.max ? `${v.min} – ${v.max}` : v.min ? `≥ ${v.min}` : v.max ? `≤ ${v.max}` : "";
        return (
          <FilterPopover active={active} summary={summary} onClear={() => setFilter(col.key, { min: "", max: "" })}>
            <div className="space-y-2.5">
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-grey-2">Minimum</label>
                <input autoFocus inputMode="decimal" value={v.min} onChange={(e) => setFilter(col.key, { ...v, min: e.target.value })} placeholder="No minimum" className={inputBase} />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-grey-2">Maximum</label>
                <input inputMode="decimal" value={v.max} onChange={(e) => setFilter(col.key, { ...v, max: e.target.value })} placeholder="No maximum" className={inputBase} />
              </div>
            </div>
          </FilterPopover>
        );
      }
      case "date": {
        const v = (f as { from: string; to: string }) ?? { from: "", to: "" };
        const active = v.from !== "" || v.to !== "";
        const summary = v.from && v.to ? `${dmy(v.from)} → ${dmy(v.to)}` : v.from ? `≥ ${dmy(v.from)}` : v.to ? `≤ ${dmy(v.to)}` : "";
        return (
          <FilterPopover active={active} summary={summary} onClear={() => setFilter(col.key, { from: "", to: "" })}>
            <div className="space-y-2.5">
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-grey-2">From</label>
                <input type="date" value={v.from} onChange={(e) => setFilter(col.key, { ...v, from: e.target.value })} className={inputBase} />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-grey-2">To</label>
                <input type="date" value={v.to} onChange={(e) => setFilter(col.key, { ...v, to: e.target.value })} className={inputBase} />
              </div>
            </div>
          </FilterPopover>
        );
      }
    }
  };

  return (
    <div className="space-y-3">
      {/* Top bar: group filter + result count */}
      <div className="flex flex-wrap items-center gap-2.5">
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="h-9 pl-3 pr-8 text-[13px] rounded-lg border border-line bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange/30 focus:border-orange/50"
        >
          <option value="all">{allLabel}</option>
          {groups.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {hasActiveFilters && (
          <button onClick={clearAll} className="inline-flex items-center gap-1.5 h-9 px-3 text-[12.5px] font-semibold text-grey-2 hover:text-orange rounded-lg hover:bg-page">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            Clear filters
          </button>
        )}
        <span className="ml-auto text-[12.5px] text-grey-2">{sorted.length} {rowsLabel}</span>
        {exportName && (
          <button
            onClick={exportNow}
            disabled={sorted.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-[12.5px] font-semibold text-grey-2 rounded-lg border border-line bg-white hover:text-orange hover:border-orange/50 disabled:opacity-40 disabled:hover:text-grey-2 disabled:hover:border-line"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Excel
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} message={emptyMessage} />
      ) : (
        <>
          <ScrollableTable>
            <table className="w-full text-[13.5px] border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-grey-2">
                  {actions && <th className="font-semibold text-[12px] uppercase tracking-wide px-4 pt-3 pb-2.5 border-b border-line w-px whitespace-nowrap">Actions</th>}
                  {columns.map((c) => (
                    <th key={c.key} className={`font-semibold text-[12px] uppercase tracking-wide px-4 pt-3 pb-2.5 border-b border-line ${c.align === "right" ? "text-right" : ""}`}>
                      {c.sortValue ? (
                        <button onClick={() => onSort(c.key)} className={`inline-flex items-center gap-1 hover:text-navy ${sort?.key === c.key ? "text-navy" : ""}`}>
                          {c.header}
                          <span className="text-[9px] leading-none">{sort?.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  ))}
                </tr>
                {/* Typed per-column filter row */}
                <tr className="bg-page/50">
                  {actions && <th className="px-3 py-2.5 border-b border-line" />}
                  {columns.map((c) => (
                    <th key={c.key} className="px-3 py-2.5 border-b border-line align-middle font-normal">
                      {renderFilter(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="px-4 py-12 text-center text-[13px] text-grey-2">
                      No matches for the current filters.{" "}
                      <button onClick={clearAll} className="font-semibold text-orange hover:underline">Clear filters</button>
                    </td>
                  </tr>
                ) : (
                  pg.pageItems.map((row, idx) => {
                    const thisName = nameOf(row);
                    const prevName = idx > 0 ? nameOf(pg.pageItems[idx - 1]) : null;
                    const showHeader = thisName !== prevName;
                    return (
                      <QueueRows key={rowKey(row)}>
                        {showHeader && (
                          <tr className="bg-navy/[0.03]">
                            <td colSpan={colSpan} className="px-4 py-2 border-b border-line">
                              <span className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-navy">
                                {groupBy.icon ?? BuildingIcon}
                                {thisName}
                                <span className="text-grey-2 font-medium normal-case tracking-normal">· {countByGroup.get(thisName)}</span>
                              </span>
                            </td>
                          </tr>
                        )}
                        <tr className={`hover:bg-page/60 ${rowClassName?.(row) ?? ""}`}>
                          {actions && <td className="px-4 py-3 border-b border-line/70 whitespace-nowrap">{actions(row)}</td>}
                          {columns.map((c) => (
                            <td key={c.key} className={`px-4 py-3 border-b border-line/70 ${c.align === "right" ? "text-right" : ""} ${c.tdClassName ?? ""}`}>
                              {c.cell(row)}
                            </td>
                          ))}
                        </tr>
                      </QueueRows>
                    );
                  })
                )}
              </tbody>
            </table>
          </ScrollableTable>
          <Pagination state={pg} rowsLabel={rowsLabel} />
        </>
      )}
    </div>
  );
}

/** Fragment wrapper so a group-header row + its data row share one key. */
function QueueRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * Compact filter trigger for range-style filters (numeric / date). Shows a small
 * pill summarising the active range; clicking opens a portaled popover (portaled
 * so the table's own overflow doesn't clip it) with the real controls.
 */
function FilterPopover({
  active,
  summary,
  onClear,
  children,
}: {
  active: boolean;
  summary: string;
  onClear: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 232;
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    setPos({ top: r.bottom + 6, left: Math.max(8, left) });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const reposition = () => place();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 h-8 w-full px-2.5 rounded-lg border text-[12.5px] transition-colors ${
          active ? "border-orange/50 text-navy bg-orange/5" : "border-line text-grey-2 hover:border-grey-2/40 hover:text-grey"
        }`}
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
        <span className="truncate">{active ? summary : "Filter"}</span>
        {active && (
          <span
            role="button"
            aria-label="Clear"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="ml-auto shrink-0 text-grey-2 hover:text-orange"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </span>
        )}
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: 232 }}
            className="z-50 rounded-xl border border-line bg-white shadow-lg p-3"
          >
            {children}
            <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-line">
              <button onClick={onClear} className="text-[12px] font-medium text-grey-2 hover:text-orange">Clear</button>
              <button onClick={() => setOpen(false)} className="text-[12px] font-semibold text-orange hover:underline">Done</button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
