import { useMemo, useState } from "react";
import { filterOptionLabel, filterValueOf, sortFilterOptions } from "@/shared/lib/blankFilter";

/**
 * Sorting and CASCADING column filters for a hub grid.
 *
 * The repo rule (CLAUDE.md) is that every grid sorts on every column and carries a searchable
 * filter under every column, and that those filters cascade: a column's options come from the rows
 * that survive every OTHER active filter, so no combination a reader can assemble returns an empty
 * table. The portal's QueueTable and MasterCrud both do this; neither can be used inside `.hub-root`
 * (they are painted in portal tokens), so this is the hub's version of the same rule.
 *
 * ── Three things that are easy to get wrong, and are handled here ──
 *
 * 1. A column is EXCLUDED FROM ITS OWN OPTIONS. Otherwise narrowing to one value leaves that lone
 *    value in the list with no way to widen again.
 * 2. Blanks are a real, selectable value, via shared/lib/blankFilter (BLANK_VALUE / "(Blank)").
 *    Never hand-roll "Not set": the sentinel has to survive the round trip through the option list.
 * 3. The EMPTY RESULT is not an empty table. This hook reports `anyFilter` and hands back
 *    `clearFilters` so the caller can keep the header, the sort toggles and the filter row standing
 *    and put one spanning row in the tbody — swapping in a full-page empty state removes the only
 *    control that could undo the filter.
 *
 * Sorting is by `sortValue` where a column gives one (a number, a date, a rank) and by the rendered
 * text otherwise, so a money column orders by amount rather than by "₹1.2 L" as a string.
 */

export interface GridColumn<T> {
  /** Stable key; also the filter's identity. */
  key: string;
  /** The value the column filters on and sorts by when there is no `sortValue`. */
  value: (row: T) => string;
  /**
   * Order by this instead of the text. Numbers sort numerically, strings by locale.
   * Give one for anything whose rendered form does not sort correctly: money, dates, severities.
   */
  sortValue?: (row: T) => string | number;
  /**
   * Set false where every row's value is unique (an amount, a note) and the dropdown would merely
   * restate the table. Sorting is never suppressed.
   */
  filter?: boolean;
}

export interface ColumnGrid<T> {
  /** Filtered + sorted rows. */
  rows: T[];
  /** Rows that survive every filter EXCEPT this column's — the source of its options. */
  optionsFor: (key: string) => string[];
  selected: (key: string) => string[];
  setSelected: (key: string, values: string[]) => void;
  sortDir: (key: string) => "asc" | "desc" | null;
  toggleSort: (key: string) => void;
  anyFilter: boolean;
  clearFilters: () => void;
  /** Turn a stored option back into its label ("(Blank)"), for chips and exports. */
  optionLabel: (v: string) => string;
}

export function useColumnGrid<T>(
  allRows: T[],
  columns: GridColumn<T>[],
  /** Extra predicate applied before the column filters — the page's own search box, a view toggle. */
  prefilter?: (row: T) => boolean,
  /**
   * The order the grid OPENS in. Omitted, it opens in the order the rows arrived.
   *
   * ⚠ NOT COSMETIC — leave it off a grid that had a default order and you silently change what the
   *   screen says. Every table converted onto this hook had one: the two musters opened on
   *   Outstanding descending (the biggest debtors first), Other Payments on the newest payment, the
   *   name masters alphabetically. Dropping that reorders the first page without any visible cause.
   *
   * ⚠ READ ONCE, on the first render, exactly like any useState seed. That is deliberate: once the
   *   reader has clicked a header, a re-render must not drag them back to the default.
   *
   * Given one, the header's arrow is right on load, which pre-sorting `allRows` would not be — the
   * column would claim to be unsorted while the rows were in fact ordered by it.
   */
  initialSort?: { key: string; dir: "asc" | "desc" },
): ColumnGrid<T> {
  const [selectedBy, setSelectedBy] = useState<Record<string, string[]>>({});
  const [sortKey, setSortKey] = useState<string | null>(initialSort?.key ?? null);
  const [dir, setDir] = useState<"asc" | "desc" | null>(initialSort?.dir ?? null);

  const base = useMemo(
    () => (prefilter ? allRows.filter(prefilter) : allRows),
    // The caller rebuilds `prefilter` each render; depending on its identity would recompute every
    // time, so depend on the rows and let the caller memo its own inputs.
    [allRows, prefilter],
  );

  const colByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  /** Does this row pass every active filter except `skip`? */
  const passes = useMemo(() => (row: T, skip?: string) => {
    for (const [key, values] of Object.entries(selectedBy)) {
      if (!values.length || key === skip) continue;
      const col = colByKey.get(key);
      if (!col) continue;
      if (!values.includes(filterValueOf(col.value(row)))) return false;
    }
    return true;
  }, [selectedBy, colByKey]);

  const rows = useMemo(() => {
    const filtered = base.filter((r) => passes(r));
    if (!sortKey || !dir) return filtered;
    const col = colByKey.get(sortKey);
    if (!col) return filtered;
    const read = col.sortValue ?? ((r: T) => col.value(r));
    const sign = dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = read(a);
      const bv = read(b);
      if (typeof av === "number" && typeof bv === "number") return sign * (av - bv);
      return sign * String(av).localeCompare(String(bv), undefined, { numeric: true });
    });
  }, [base, passes, sortKey, dir, colByKey]);

  const optionsFor = (key: string): string[] => {
    const col = colByKey.get(key);
    if (!col || col.filter === false) return [];
    const seen = new Set<string>();
    for (const r of base) if (passes(r, key)) seen.add(filterValueOf(col.value(r)));
    // Selected values are always offered back, even when the other filters no longer produce them —
    // hiding a ticked option leaves a filter the reader can see the effect of but cannot undo.
    for (const v of selectedBy[key] ?? []) seen.add(v);
    // `{ numeric: true }` so "10" sorts after "9" — the same collation MasterCrud uses. Blanks are
    // pinned last by sortFilterOptions itself.
    return sortFilterOptions([...seen], (a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setDir("asc"); return; }
    setDir(dir === "asc" ? "desc" : dir === "desc" ? null : "asc");
  };

  const anyFilter = Object.values(selectedBy).some((v) => v.length > 0);

  return {
    rows,
    optionsFor,
    selected: (key) => selectedBy[key] ?? [],
    setSelected: (key, values) => setSelectedBy((prev) => ({ ...prev, [key]: values })),
    sortDir: (key) => (sortKey === key ? dir : null),
    toggleSort,
    anyFilter,
    clearFilters: () => setSelectedBy({}),
    optionLabel: filterOptionLabel,
  };
}
