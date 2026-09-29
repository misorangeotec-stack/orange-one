/**
 * INK IMS — the sorting and filtering every one of its grids obeys, written once.
 *
 * The portal's rule is that EVERY grid sorts on every column and filters under every column,
 * and that a column's dropdown offers only what the OTHER filters still allow. Ink IMS does not
 * use the shared `QueueTable` (its dashboard is a frozen-column spreadsheet with grouped company
 * headings and consignment columns added at runtime, which that component does not do), so the
 * rule has to be implemented here rather than inherited. This file is that implementation, and
 * all four screens read it, so the dashboard, the item master, the ETD / ETA list and the godown
 * picker cannot drift apart.
 *
 * ─── WHY THE DROPDOWNS CASCADE ────────────────────────────────────────────────────────────
 *
 * Built from the raw rows, the dropdowns let a planner assemble a combination that matches
 * nothing: tick Category "Reactive", then Group "Pigment Powder", and the table empties with no
 * hint which of the two did it. Built from the rows surviving every OTHER filter, that
 * combination cannot be assembled in the first place — picking Reactive drops the groups with no
 * reactive ink out of the Group list.
 *
 * ⚠ A COLUMN IS ALWAYS EXCLUDED FROM ITS OWN OPTIONS. This is the whole trick, and the reason
 *   the first version of this screen turned cascading off rather than getting it right: if a
 *   column's list were built from rows its own filter had already narrowed, then ticking one
 *   value would leave that value as the only one in the list, with no way to widen again.
 *
 * ⚠ AND A TICKED VALUE IS NEVER DROPPED FROM ITS OWN LIST. Excluding the column from its own
 *   filter is not quite enough: tick Category "Reactive", then narrow Group to something that
 *   holds no reactive ink, and "Reactive" is no longer present in the surviving rows. Without
 *   the union below it would vanish from the menu while still filtering the table, which is the
 *   one state a filter must never reach — narrowed by a control that no longer shows why.
 */
import { BLANK_VALUE, filterValueOf, sortFilterOptions } from "@/shared/lib/blankFilter";

/** What one cell holds for filtering and sorting: text to read, a number to compare, or nothing. */
export type CellValue = string | number | null;

/**
 * What one column's filter holds. `text` and the `min`/`max` pair are typed into the funnel's
 * own panel; `list` holds blank-folded values ticked in the portal's picker.
 *
 * Declared HERE rather than beside the component that draws it, so `HeaderFilter` can import the
 * sort helpers without the two files importing each other.
 */
export interface ColumnFilter {
  text?: string;
  list?: string[];
  min?: number;
  max?: number;
}

/** An empty entry means "no filter", never "match nothing". */
export const isFilterActive = (f: ColumnFilter | undefined): boolean =>
  Boolean(f && ((f.text ?? "").trim() || f.list?.length || f.min !== undefined || f.max !== undefined));

/** Which column orders the table, and which way. `null` is the screen's own natural order. */
export type SortState = { key: string; dir: "asc" | "desc" } | null;

/**
 * The click-a-heading cycle, matching `QueueTable`: a new column starts ascending, the same
 * column flips. There is deliberately no third "off" click — the screens that have a natural
 * order of their own expose it as a column of its own (the dashboard's No.), so one click on
 * that column is the way back, and it is labelled.
 */
export const nextSort = (prev: SortState, key: string): SortState =>
  prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };

/**
 * Order two cells.
 *
 * Blanks sort LAST in both directions, matching `MasterCrud`: a row with nothing in the column
 * is not the smallest value, it is an unknown, and burying the unknowns at the bottom of a
 * descending sort would hide exactly the rows a planner is hunting for at the top of an
 * ascending one.
 */
function compareCells(a: CellValue, b: CellValue, dir: "asc" | "desc"): number {
  const aBlank = a === null || a === "";
  const bBlank = b === null || b === "";
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;
  const d =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true });
  return dir === "desc" ? -d : d;
}

/**
 * Sort a copy, never in place: several screens hand in a memoised array that other things read.
 * With no sort set the rows come back untouched, which is what keeps the dashboard opening in
 * the planner's own numbering.
 */
export function applySort<T>(
  rows: T[],
  sort: SortState,
  valueOf: (row: T, id: string) => CellValue,
): T[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => compareCells(valueOf(a, sort.key), valueOf(b, sort.key), sort.dir));
}

/**
 * Does one cell survive one column's filter?
 *
 * Numbers take the from/to range and a blank fails it — "20 and over" is not a claim an unknown
 * can satisfy. Text takes a contains-match. A tick-list matches on the blank-folded value, so
 * "(Blank)" is a value a planner can actually pick rather than a row that quietly disappears.
 */
export function passesColumnFilter(v: CellValue, f: ColumnFilter): boolean {
  if (!isFilterActive(f)) return true;
  if (f.min !== undefined || f.max !== undefined) {
    if (typeof v !== "number") return false;
    if (f.min !== undefined && v < f.min) return false;
    if (f.max !== undefined && v > f.max) return false;
    return true;
  }
  const text = v === null ? "" : String(v);
  if (f.text?.trim() && !text.toUpperCase().includes(f.text.trim().toUpperCase())) return false;
  if (f.list?.length && !f.list.includes(filterValueOf(text))) return false;
  return true;
}

/**
 * The rows left after every column filter, optionally ignoring one column's own.
 *
 * `exceptId` is what makes the cascade work: pass a column's id and you get the rows the OTHER
 * filters allow, which is exactly the set that column's dropdown should be built from.
 */
export function rowsPassing<T>(
  rows: T[],
  filters: Record<string, ColumnFilter>,
  valueOf: (row: T, id: string) => CellValue,
  exceptId?: string,
): T[] {
  const active = Object.entries(filters).filter(([id, f]) => id !== exceptId && isFilterActive(f));
  if (active.length === 0) return rows;
  return rows.filter((r) => active.every(([id, f]) => passesColumnFilter(valueOf(r, id), f)));
}

/**
 * The values one column's tick-list offers: everything the other filters still allow, plus
 * whatever is already ticked here so a selection can always be undone. "(Blank)" comes last.
 *
 * Returns the blank-folded values; the caller turns them into labels with `filterOptionLabel`.
 */
export function cascadedOptions<T>(
  rows: T[],
  filters: Record<string, ColumnFilter>,
  valueOf: (row: T, id: string) => CellValue,
  id: string,
): string[] {
  const seen = new Set<string>();
  for (const r of rowsPassing(rows, filters, valueOf, id)) {
    const v = valueOf(r, id);
    seen.add(filterValueOf(v === null ? "" : String(v)));
  }
  for (const picked of filters[id]?.list ?? []) seen.add(picked);
  return sortFilterOptions([...seen], (a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

/**
 * A fixed vocabulary narrowed to what the other filters allow, with the ticked values kept.
 *
 * The portal's rule leaves an author-declared option list alone, because such a list is a
 * vocabulary rather than a reading of the data. Ink IMS has one: the Remark column, whose three
 * values ("NEW ORDER REQUIRED", "EXCESS STOCK", blank) are computed by the cover maths and are
 * the answer the screen exists to give. They are always all offered, in the author's order, so
 * the planner can ask "what needs ordering" without first finding out whether anything does.
 */
export function fixedOptions(vocabulary: string[], picked: string[] | undefined): string[] {
  const out = vocabulary.map((v) => filterValueOf(v));
  for (const p of picked ?? []) if (!out.includes(p)) out.push(p);
  return out.includes(BLANK_VALUE) ? [...out.filter((v) => v !== BLANK_VALUE), BLANK_VALUE] : out;
}
