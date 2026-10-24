import type { PersonItem } from "../data/peopleWork";

/**
 * The "Search Hub ID / PO no." box — one box for every number the hub hands out.
 *
 * The coordinator is usually rung with a number, not a name: "is PO-0231 stuck?".
 * Each pending row carries its own `ref` PLUS every other number of the same
 * record (`searchRefs`, built per FMS in data/hubRefs.ts) — a requisition's POs,
 * a PO's PI / GRN / Tally voucher, an order's invoice and DC. So the PO number
 * finds the request still waiting at approval, and the request number finds its
 * PO waiting at GRN.
 *
 * Matching ignores case, spaces, dashes and slashes: people type "po 231",
 * "PO/231" and "po-231" for the same PO-231.
 */

export const normRef = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The number on this row that the query hit — its own ref first. Null = no hit. */
export function matchedRef(item: PersonItem, q: string): string | null {
  if (!q) return null;
  if (normRef(item.ref).includes(q)) return item.ref;
  return item.searchRefs.find((r) => normRef(r).includes(q)) ?? null;
}
