/**
 * WHAT A BLANK IS, defined ONCE for every grid in the portal.
 *
 * "Which machines have no billing name?" used to be unanswerable. Both shared
 * grids dropped empty values on the floor while building their filter dropdowns,
 * so a row with nothing in a column was BOTH unselectable and actively excluded —
 * and the second is worse than the first. `MasterCrud` ended its value extraction
 * with `.filter(Boolean)` (a blank row yielded an empty array, and `.some` on an
 * empty array is always false, so picking ANY value in that column dropped every
 * blank row); `QueueTable` spelled the same bug `if (v) set.add(v)`.
 *
 * ⚠ THIS LIVES IN ONE FILE BECAUSE FOUR AUTHORS PROVED IT HAS TO. On the machines
 *   master, Billing name, Print heads and Model no. were all broken this way and
 *   Dryer was not — its column had hand-rolled a literal "Not set" for null. One
 *   author remembered the blank case and three did not. Left per-column, the next
 *   new column gets it wrong again, so the rule is central and every grid inherits
 *   it.
 *
 * ⚠ A BLANK MUST READ THE SAME IN BOTH COMPONENTS. Not "(Blank)" in one and "—"
 *   in the other — see `isRenderedPlaceholder` for the one place that matters.
 */

/**
 * The internal value standing for "this row has nothing here".
 *
 * A SENTINEL, not the literal "(Blank)", so a column whose real data happens to
 * contain the text "(Blank)" cannot silently merge with the empty rows. NUL can
 * never occur in rendered cell text or in a Tally-sourced master value, which is
 * what makes the collision impossible rather than merely unlikely.
 *
 * Safe to hold in component state: neither grid persists its filter selection to
 * localStorage or to the URL, so the sentinel never leaves the page.
 */
export const BLANK_VALUE = "\u0000blank";

/** What the sentinel is SHOWN as, in every dropdown in the portal. */
export const BLANK_LABEL = "(Blank)";

/** A column's filter value, with empty/null/undefined folded to the sentinel. */
export function filterValueOf(v: string | null | undefined): string {
  return v == null || v === "" ? BLANK_VALUE : v;
}

/** The label a filter option is drawn with — the sentinel spelled out. */
export function filterOptionLabel(v: string): string {
  return v === BLANK_VALUE ? BLANK_LABEL : v;
}

/**
 * An em-dash a component INVENTED, rather than a value an author chose.
 *
 * ⚠ THE DISTINCTION IS THE WHOLE RULE, so it is worth stating plainly.
 *   `MasterCrud` derives a column's filter values from the TEXT ITS CELL RENDERS
 *   when the column declares no explicit `filter.get` — which is the majority of
 *   masters columns (office-supplies declares 14 headers and no filters at all).
 *   Dozens of those cells render `—` as the placeholder for "nothing here", so
 *   without this the dropdown would offer a filter value spelled "—" while
 *   `QueueTable` offered "(Blank)" for the same idea.
 *
 *   Where an author WROTE `?? "—"` into a `filter.get`, it is left alone: it is a
 *   value they chose, and on a handful of queues it does not mean "blank" at all
 *   (Dispatch's hold column reads "On hold" / "—", where the dash means NOT held).
 *   `QueueTable` has no rendered-text fallback, so this is only ever consulted on
 *   `MasterCrud`'s derived path.
 *
 * Em-dash and en-dash only — never the plain hyphen, which is real data in part
 * numbers, model codes and account strings.
 */
export function isRenderedPlaceholder(s: string): boolean {
  return s === "—" || s === "–";
}

/**
 * Filter options in display order, with "(Blank)" pinned LAST.
 *
 * Deliberately last rather than alphabetically into the middle: it is not a value,
 * it is the absence of one, and it matches `MasterCrud`'s existing sort rule that
 * keeps blank cells at the bottom in BOTH sort directions.
 *
 * Takes the comparator rather than choosing one, so each grid keeps the collation
 * it already had — `MasterCrud` sorts `{ numeric: true }`, `QueueTable` plain — and
 * none of the ~340 existing dropdowns change order.
 */
export function sortFilterOptions(
  values: string[],
  compare: (a: string, b: string) => number,
): string[] {
  const hasBlank = values.includes(BLANK_VALUE);
  const rest = hasBlank ? values.filter((v) => v !== BLANK_VALUE) : values;
  const sorted = [...rest].sort(compare);
  return hasBlank ? [...sorted, BLANK_VALUE] : sorted;
}
