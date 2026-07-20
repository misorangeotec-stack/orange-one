import type { CustomerGroupMap } from "./types";

/**
 * Resolving a customer to its parent group.
 *
 * Lives in its own module (no React, no data-fetching) so pure libs like agingReport.ts can
 * resolve groups without importing the useAppData hook. `useAppData` re-exports these.
 *
 * IDENTITY: the muster is stored against the Tally ledger GUID. Resolve by id, never by name —
 * 387 ledger names repeat across companies, so a name lookup can return another company's group,
 * and it detaches entirely when the ledger is renamed in Tally. `map.mapping` is only a derived
 * name-keyed view, kept for the default pipeline source (which has no ledger ids at all).
 */
export const EMPTY_GROUP_MAP: CustomerGroupMap = { byLedgerId: {}, mapping: {}, groups: {} };

/** The customer's group, or undefined when it has no muster entry at all. */
export function groupEntryOf(
  c: { name: string; id?: string; constituentIds?: string[] },
  map: CustomerGroupMap,
): string | undefined {
  // A ConsolidatedCustomer is already merged across companies and carries every source ledger in
  // `constituentIds`; take the first that the muster knows about. A raw Customer has just `id`.
  const ids = c.constituentIds?.length ? c.constituentIds : (c.id ? [c.id] : []);
  for (const id of ids) {
    const g = map.byLedgerId?.[id];
    if (g !== undefined) return g;
  }
  return map.mapping[c.name];
}

/** As `groupEntryOf`, but an unmapped customer is treated as its own single-row group. */
export function groupNameOf(
  c: { name: string; id?: string; constituentIds?: string[] },
  map: CustomerGroupMap,
): string {
  return groupEntryOf(c, map) ?? c.name;
}

/**
 * Every group name the muster knows about — for filter option lists.
 *
 * Unions both views on purpose. `mapping` is derived and lossy: where one ledger name carries
 * different groups in different companies only the first survives, so a group reachable solely
 * through the losing row would vanish from the filter while its rows still appear in the table.
 */
export function allGroupNames(map: CustomerGroupMap): Set<string> {
  return new Set([
    ...Object.values(map.byLedgerId ?? {}),
    ...Object.values(map.mapping ?? {}),
  ]);
}
