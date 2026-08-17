import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Combobox from "@/shared/components/ui/Combobox";
import EmptyState from "@/shared/components/ui/EmptyState";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import Pagination from "@/shared/components/ui/Pagination";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import { exportRowsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";

/** Per-column filter behaviour. */
export type ColumnFilter<T> =
  | { kind: "text"; get: (row: T) => string }
  /**
   * Tick any number of values. An empty selection means NO filter (everything),
   * exactly as a cleared text box does.
   *
   * ⚠ `select` AND `multiselect` ARE THE SAME CONTROL — a searchable, multi-value
   *   picker whose search box is always on. `select` was once a native <select>,
   *   and on a live queue that was unusable: the customer list runs to dozens of
   *   names and the only way through it was scrolling. Both names survive purely so
   *   the ~190 columns already declaring `select` did not all have to be edited.
   *   Prefer `select` in new code, and never assume it is single-choice.
   *
   * `initial` seeds the table on first render — the way to open a screen already
   * excluding a value nobody wants to see by default, without hiding it for good.
   * "Clear filters" still drops back to showing everything, so the excluded rows are
   * always one click away rather than unreachable.
   */
  | { kind: "select"; get: (row: T) => string; options?: string[]; initial?: string[] }
  | { kind: "multiselect"; get: (row: T) => string; options?: string[]; initial?: string[] }
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
  /**
   * Off until the reader picks it in the Columns menu — for the columns that are
   * worth having but not worth the width by default.
   *
   * IGNORED unless the table opts in to `columnPicker`. Without a menu to turn it
   * back on, a hidden column would be unreachable, so a table with no picker shows
   * every column it was given.
   */
  defaultHidden?: boolean;
  /** Cannot be hidden — the column that says WHICH ROW this is. */
  alwaysVisible?: boolean;
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
  /**
   * Omit for a FLAT table: no group bands, no group dropdown, and a column sort that
   * orders the whole list. Use that where the dimension reads better as its own column
   * with a filter — HR's requisition queues do exactly that with Department, because
   * banding a short due-date-sorted queue by department hides the order that matters.
   */
  groupBy?: QueueGroupBy<T>;
  /** Leading actions cell (buttons / Open link) — rendered as the first column. */
  actions?: (row: T) => ReactNode;
  rowClassName?: (row: T) => string;
  rowsLabel?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  /** Pre-activate a sort column on first render. */
  initialSort?: { key: string; dir: "asc" | "desc" };
  /** Pre-select a group on first render (e.g. deep-linked `?status=…` from a dashboard). */
  initialGroup?: string;
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
  /**
   * Opt in to row multi-select + a bulk-action bar (used by Ready to Dispatch and
   * FG Transfer). Adds a leading checkbox column and a header select-all over the
   * currently filtered rows; `renderBulkActions` renders the action buttons for the
   * selected rows and is given a `clear()` to reset the selection after acting.
   * Omitting it leaves the table exactly as it was for every other queue.
   */
  selectable?: { renderBulkActions: (selected: T[], clear: () => void) => ReactNode };
  /**
   * Hide the in-body group-header rows. The group filter dropdown still works —
   * this only drops the repeated "· N" header bands, e.g. where a Status column
   * already conveys the grouping and the bands are just noise.
   */
  hideGroupHeaders?: boolean;
  /**
   * Opt in to a "Columns" menu, for tables wide enough that not everyone wants
   * every column. Omitting it leaves the table exactly as it was — which is why
   * every existing queue is unchanged by this.
   *
   * `storageKey` namespaces the remembered choice per table, so two tables that
   * happen to share column keys don't overwrite each other.
   */
  columnPicker?: { storageKey: string };
}

type SortState = { key: string; dir: "asc" | "desc" } | null;
type FilterVal = string | string[] | { min: string; max: string } | { from: string; to: string };

const inputBase =
  "h-8 w-full min-w-0 rounded-lg border border-line bg-white px-2.5 text-[12.5px] text-ink placeholder:text-grey-2/60 focus:outline-none focus:ring-2 focus:ring-orange/25 focus:border-orange/50";

/** yyyy-mm-dd → dd-mm-yyyy for compact summaries. */
const dmy = (iso: string): string => (iso ? iso.split("-").reverse().join("-") : "");

/* ------------------------- remembered column choice ------------------------ */
/*  Same shape as the sidebar's own preferences (Sidebar.tsx): dot-namespaced    */
/*  key, and every access wrapped — private mode and a full quota must never     */
/*  throw. All of this is convenience, never load-bearing.                       */

const colsKey = (storageKey: string) => `orangeone.table.cols.${storageKey}`;

/**
 * The stored hidden keys, INTERSECTED with the columns that exist right now, or
 * null when there is nothing usable to restore.
 *
 * Null vs empty matters: an empty set is a real choice ("show me everything"),
 * while null means "never asked", which is what lets `defaultHidden` apply.
 *
 * Storing the hidden set rather than the visible one means a column added in a
 * later release arrives visible, which is the kinder default for a new feature.
 * The intersection is what makes a stored preference safe across releases — and
 * it also quietly handles the salary case: a column that isn't offered to this
 * user isn't in `valid`, so their stored "hide it" simply evaporates.
 *
 * Note the whole read is inside the try, `getItem` included — with cookies
 * blocked, merely TOUCHING localStorage throws, and a display preference must
 * never be able to take the table down with it.
 */
function readHiddenCols(storageKey: string, valid: Set<string>): Set<string> | null {
  try {
    const raw = localStorage.getItem(colsKey(storageKey));
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((k): k is string => typeof k === "string" && valid.has(k)));
  } catch {
    return null;
  }
}

function writeHiddenCols(storageKey: string, hidden: Set<string>): void {
  try {
    localStorage.setItem(colsKey(storageKey), JSON.stringify([...hidden]));
  } catch {
    /* private mode / quota — the table still works, it just won't remember */
  }
}

const BuildingIcon = (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-orange" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M6 21V7l6-4 6 4v14M10 9h.01M14 9h.01M10 13h.01M14 13h.01M10 17h.01M14 17h.01" /></svg>
);

/**
 * Shared work-queue table: groups rows by a caller-chosen dimension, with a polished
 * per-column filter row (typed controls — text, dropdown, numeric min–max, and date
 * range), a per-group filter, sortable columns, and 25/page pagination. Grouping is
 * the primary order (group name A→Z); an active column sort orders rows WITHIN each
 * group. Every FMS queue uses this so they all behave identically.
 *
 * `groupBy` is optional: omit it and the table is flat — no bands, no group dropdown,
 * and the column sort owns the whole list.
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
  initialGroup,
  exportName,
  exportTitle,
  exportNotes,
  selectable,
  hideGroupHeaders,
  columnPicker,
}: QueueTableProps<T>) {
  // Seeded once from any multiselect column's `initial`, so a screen can open with a
  // sensible default selection. Lazy on purpose: `columns` is usually rebuilt every
  // render, and re-seeding would stamp the default back over the user's choice.
  const [filters, setFilters] = useState<Record<string, FilterVal>>(() => {
    const seed: Record<string, FilterVal> = {};
    for (const c of columns) {
      if ((c.filter?.kind === "select" || c.filter?.kind === "multiselect") && c.filter.initial?.length)
        seed[c.key] = [...c.filter.initial];
    }
    return seed;
  });
  const [group, setGroup] = useState<string>(initialGroup ?? "all");
  const [sort, setSort] = useState<SortState>(initialSort ?? null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  /**
   * Which columns the reader has put away. Lazily seeded, for the same reason
   * `filters` is: `columns` is a fresh array almost every render, so re-seeding
   * would stamp `defaultHidden` back over a choice the moment anything re-rendered.
   *
   * A remembered choice beats `defaultHidden` — once someone has opened the menu,
   * the stored set is the whole truth, including "I want the default-hidden ones".
   */
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    if (!columnPicker) return new Set(); // no menu ⇒ nothing may be hidden
    const stored = readHiddenCols(columnPicker.storageKey, new Set(columns.map((c) => c.key)));
    return stored ?? new Set(columns.filter((c) => c.defaultHidden && !c.alwaysVisible).map((c) => c.key));
  });

  /**
   * The columns actually on screen. EVERYTHING below reads this, never `columns` —
   * filtering, sorting, the option lists, the export and the cells. A hidden column
   * that still filtered would narrow the table with no visible control to undo it.
   */
  const picking = !!columnPicker; // the prop is usually a fresh literal; its identity is noise
  const shownColumns = useMemo(
    () => (picking ? columns.filter((c) => c.alwaysVisible || !hiddenCols.has(c.key)) : columns),
    [columns, hiddenCols, picking],
  );

  const idOf = groupBy?.idOf;
  const groupNameOf = groupBy?.nameOf;

  const nameOf = (row: T): string => {
    const id = idOf?.(row);
    return id && groupNameOf ? groupNameOf(id) : "—";
  };

  const isActive = (col: QueueColumn<T>): boolean => {
    const f = filters[col.key];
    if (!f || !col.filter) return false;
    if (col.filter.kind === "text") return (f as string) !== "";
    if (col.filter.kind === "select" || col.filter.kind === "multiselect") return Array.isArray(f) && f.length > 0;
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
      case "multiselect":
        return (f as string[]).includes(col.filter.get(row));
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

  const hasActiveFilters = (!!groupBy && group !== "all") || shownColumns.some(isActive);

  // Distinct groups present in the source rows (for the group filter).
  const groups = useMemo(() => {
    const map = new Map<string, string>();
    if (!idOf || !groupNameOf) return [];
    for (const row of rows) {
      const id = idOf(row);
      if (id && !map.has(id)) map.set(id, groupNameOf(id));
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, idOf, groupNameOf]);

  /**
   * Distinct option lists for every "select" filter column.
   *
   * ⚠ THE OPTIONS CASCADE: each column offers only values still reachable once
   *   the OTHER columns' filters are applied. Filter Type to Ink and the Item
   *   group list drops the groups holding no ink, so no combination a reader can
   *   assemble from these dropdowns can ever return an empty table. Listing every
   *   value in the source rows instead means offering choices that are already
   *   excluded, and the reader finds out by clicking.
   *
   *   A column is excluded from its OWN options (`other.key === c.key`) — else
   *   narrowing to one value would leave that lone value in its list, with no way
   *   to widen again short of clearing the filter.
   *
   *   An author-declared `options` list is left exactly as declared: it is a
   *   fixed vocabulary (every status a step can hold), not a reading of the data,
   *   and shrinking it would hide states the screen is meant to name.
   */
  const selectOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of shownColumns) {
      if (c.filter?.kind === "select" || c.filter?.kind === "multiselect") {
        if (c.filter.options) { out[c.key] = c.filter.options; continue; }
        const set = new Set<string>();
        for (const row of rows) {
          if (idOf && group !== "all" && idOf(row) !== group) continue;
          let reachable = true;
          for (const other of shownColumns) {
            if (other.key === c.key) continue;
            if (!matches(other, row)) { reachable = false; break; }
          }
          if (!reachable) continue;
          const v = c.filter.get(row);
          if (v) set.add(v);
        }
        out[c.key] = [...set].sort((a, b) => a.localeCompare(b));
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, shownColumns, filters, group, idOf]);

  // Filter → sort (group primary, chosen column secondary).
  const sorted = useMemo(() => {
    let list = rows.filter((row) => {
      if (idOf && group !== "all" && idOf(row) !== group) return false;
      for (const col of shownColumns) if (!matches(col, row)) return false;
      return true;
    });

    const col = sort ? shownColumns.find((c) => c.key === sort.key && c.sortValue) : undefined;
    list = list
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        // Group is the primary sort ONLY when its header bands are shown. With
        // hideGroupHeaders — or no grouping at all — the group is not an ordering,
        // so a column sort like "Due" must order the whole list, not within-group.
        const cn = hideGroupHeaders || !groupBy ? 0 : nameOf(a.row).localeCompare(nameOf(b.row));
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
  }, [rows, filters, group, sort, shownColumns]);

  // Per-group counts (of the filtered set) shown in each group header.
  const countByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of sorted) m.set(nameOf(row), (m.get(nameOf(row)) ?? 0) + 1);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted]);

  const pg = usePagination(sorted, { resetKey: `${JSON.stringify(filters)}|${group}|${sort?.key}|${sort?.dir}` });
  const colSpan = shownColumns.length + (actions ? 1 : 0) + (selectable ? 1 : 0);

  // Row multi-select (opt-in). Selection is over the currently filtered rows.
  const selectedRows = selectable ? sorted.filter((r) => selectedKeys.has(rowKey(r))) : [];
  const allSelected = !!selectable && sorted.length > 0 && sorted.every((r) => selectedKeys.has(rowKey(r)));
  const clearSelection = () => setSelectedKeys(new Set());
  const toggleRow = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleAll = () => setSelectedKeys(allSelected ? new Set() : new Set(sorted.map(rowKey)));

  const onSort = (key: string) =>
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const setFilter = (key: string, val: FilterVal) => setFilters((prev) => ({ ...prev, [key]: val }));
  /**
   * Note this does NOT bring hidden columns back. Visibility is not a filter, and
   * reshaping the table from a button labelled "Clear filters" would be a surprise;
   * the Columns menu has its own "Select all".
   */
  const clearAll = () => { setFilters({}); setGroup("all"); };

  /**
   * Put columns away / bring them back.
   *
   * Hiding one also RELEASES ITS FILTER AND DROPS ITS SORT. Otherwise the column
   * keeps narrowing or ordering the table from behind a control nobody can see —
   * and the export's About sheet would go on claiming a filter that has no
   * on-screen existence. The row count visibly grows back, which is the honest
   * signal that a filter was let go.
   */
  const applyVisible = (nextVisible: string[]) => {
    if (!columnPicker) return;
    const visible = new Set(nextVisible);
    const nextHidden = new Set(
      columns.filter((c) => !c.alwaysVisible && !visible.has(c.key)).map((c) => c.key),
    );
    // Never leave an empty table. Turning every OPTIONAL column off is fine where
    // an `alwaysVisible` column survives it — a name-only list is a legitimate thing
    // to want. It is only the truly blank result that gets refused.
    if (!columns.some((c) => c.alwaysVisible || !nextHidden.has(c.key))) return;
    setHiddenCols(nextHidden);
    writeHiddenCols(columnPicker.storageKey, nextHidden);
    setFilters((prev) => {
      const out: Record<string, FilterVal> = {};
      for (const [k, v] of Object.entries(prev)) if (!nextHidden.has(k)) out[k] = v;
      return out;
    });
    setSort((prev) => (prev && nextHidden.has(prev.key) ? null : prev));
  };

  /* ------------------------------- Excel export ------------------------------ */

  /** The active filters in plain English, for the export's About sheet. */
  const filterSummary = (): string[] => {
    const out: string[] = [];
    if (groupBy && groupNameOf && group !== "all") out.push(`${groupBy.label ?? "Group"}: ${groupNameOf(group)}`);
    for (const col of shownColumns) {
      if (!isActive(col) || !col.filter) continue;
      const f = filters[col.key];
      if (col.filter.kind === "text") out.push(`${col.header} contains "${f as string}"`);
      else if (col.filter.kind === "select" || col.filter.kind === "multiselect") {
        // A single ticked value reads as plain equality — which is what most exports
        // are — rather than a one-item "is one of:" list.
        const vals = f as string[];
        out.push(vals.length === 1 ? `${col.header} is "${vals[0]}"` : `${col.header} is one of: ${vals.join(", ")}`);
      }
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
      // An ungrouped table has no group column to lead with — its dimension is
      // already one of `columns`, so prepending it would export it twice.
      ...(groupBy ? [{ header: groupBy.label ?? "Group", width: 22, value: (row: T) => nameOf(row) }] : []),
      // The columns ON SCREEN. The export has always promised "what you see is what
      // you get" about filters and sorting; putting a column away is no different.
      ...shownColumns.map((c) => ({
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
      case "multiselect": {
        const v = (Array.isArray(f) ? f : []) as string[];
        return (
          <MultiSelect
            values={v}
            onChange={(next) => setFilter(col.key, next)}
            options={(selectOptions[col.key] ?? []).map((o) => ({ value: o, label: o }))}
            placeholder="All"
            /* Search is forced ON rather than left to MultiSelect's "more than 6
               options" default. A filter row where some columns can be typed into
               and others cannot is what sends people back to scrolling; the whole
               point of this control is that EVERY filter answers to typing. The
               cost is a redundant search box on a two-option column, which is a far
               smaller tax than a customer list you can only scroll. */
            searchable
            triggerClassName={inputBase}
          />
        );
      }
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
        {/* Single-choice, unlike the column filters: the group is the primary sort
            and the band headings, so "several at once" has no meaning here. It is
            still searchable — a company list is exactly as long as a customer one. */}
        {groupBy && (
          <Combobox
            value={group}
            onChange={setGroup}
            options={[
              { value: "all", label: groupBy.allLabel },
              ...groups.map((c) => ({ value: c.id, label: c.name })),
            ]}
            searchable
            className="w-auto"
            triggerClassName="h-9 py-0 rounded-lg text-[13px] whitespace-nowrap"
          />
        )}
        {/* The OPTIONAL columns only. An `alwaysVisible` column would sit here as a
            permanently-ticked row that does nothing when clicked, which reads as a
            broken control; it is visibly in the table already. */}
        {columnPicker && (
          <MultiSelect
            values={shownColumns.filter((c) => !c.alwaysVisible).map((c) => c.key)}
            onChange={applyVisible}
            options={columns.filter((c) => !c.alwaysVisible).map((c) => ({ value: c.key, label: c.header }))}
            triggerLabel="Columns"
            className="w-auto"
            triggerClassName="h-9 py-0 rounded-lg text-[13px] whitespace-nowrap"
          />
        )}
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

      {selectable && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-orange/40 bg-orange/5 px-3.5 py-2.5">
          <span className="text-[12.5px] font-semibold text-navy">{selectedRows.length} selected</span>
          <button onClick={clearSelection} className="text-[12px] font-medium text-grey-2 hover:text-orange">Clear</button>
          <div className="ml-auto flex flex-wrap items-center gap-2">{selectable.renderBulkActions(selectedRows, clearSelection)}</div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} message={emptyMessage} />
      ) : (
        <>
          <ScrollableTable>
            <table className="w-full text-[13.5px] border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-grey-2">
                  {selectable && (
                    <th className="px-4 pt-3 pb-2.5 border-b border-line w-px">
                      <input type="checkbox" className="h-4 w-4 accent-orange align-middle" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                    </th>
                  )}
                  {actions && <th className="font-semibold text-[12px] uppercase tracking-wide px-4 pt-3 pb-2.5 border-b border-line w-px whitespace-nowrap">Actions</th>}
                  {shownColumns.map((c) => (
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
                  {selectable && <th className="px-3 py-2.5 border-b border-line" />}
                  {actions && <th className="px-3 py-2.5 border-b border-line" />}
                  {shownColumns.map((c) => (
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
                    const showHeader = !!groupBy && !hideGroupHeaders && thisName !== prevName;
                    return (
                      <QueueRows key={rowKey(row)}>
                        {showHeader && (
                          <tr className="bg-navy/[0.03]">
                            <td colSpan={colSpan} className="px-4 py-2 border-b border-line">
                              <span className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-navy">
                                {groupBy?.icon ?? BuildingIcon}
                                {thisName}
                                <span className="text-grey-2 font-medium normal-case tracking-normal">· {countByGroup.get(thisName)}</span>
                              </span>
                            </td>
                          </tr>
                        )}
                        <tr className={`hover:bg-page/60 ${rowClassName?.(row) ?? ""}`}>
                          {selectable && (
                            <td className="px-4 py-3 border-b border-line/70">
                              <input type="checkbox" className="h-4 w-4 accent-orange align-middle" checked={selectedKeys.has(rowKey(row))} onChange={() => toggleRow(rowKey(row))} aria-label="Select row" />
                            </td>
                          )}
                          {actions && <td className="px-4 py-3 border-b border-line/70 whitespace-nowrap">{actions(row)}</td>}
                          {shownColumns.map((c) => (
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
