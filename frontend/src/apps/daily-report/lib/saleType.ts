/**
 * Daily Report — which product line a sale belongs to.
 *
 * The answer comes from the MIRROR'S OWN RULESET (`sale_type_rule` on
 * ConnectWave), not from pattern-matching voucher names here. That table is
 * what `resolve_sale_type()` reads in SQL, so a rule added once is honoured by
 * the outstanding report, the sales register and this report alike. Never add a
 * local override map: a second source of truth is how a voucher ends up typed
 * one way on one screen and another way on the next.
 *
 * ⚠ THIS REIMPLEMENTS resolve_sale_type() AND MUST MATCH IT, TIE-BREAK INCLUDED.
 *
 *   The SQL orders candidate rules by `priority` ascending and then by
 *   `length(match_value) DESC`. That second clause is load-bearing and is NOT
 *   decoration: `HEAD/` and `HEAD/M/` are both priority 10, and the longer one
 *   must win or every HEAD/M/… voucher — which is a MACHINE deal — reports as a
 *   print head. Same for `SPARE/` against `SPARE/EN/`.
 *
 *   The existing browser-side copy in
 *   `apps/receivables-hub/lib/connectwaveFetcher.ts` iterates on priority alone
 *   and returns the first hit, so on equal priority its winner is whatever order
 *   PostgREST happened to return. That is a real defect in the Outstanding
 *   Dashboard's typing, logged separately — it is NOT fixed here, because
 *   changing it moves live figures on a screen this work has not tested.
 */

import { getConnectwaveSupabase } from "@hub/lib/connectwaveSupabase";

/** The buckets `sale_type` holds. `other` is the fall-through, never a match. */
export type SaleType = "ink" | "head" | "machine" | "spare_parts" | "paper" | "non_product" | "other";

const KNOWN: SaleType[] = ["ink", "head", "machine", "spare_parts", "paper", "non_product"];

interface SaleTypeRule {
  rule_kind: string;
  match_value: string;
  sale_type: string;
  match_mode: string;
  case_sensitive: boolean;
  priority: number;
}

/**
 * Resolve a line's product line. Closure over one fetch of the rules, so a
 * screen reads the table once and classifies thousands of lines against it.
 */
export type SaleTypeResolver = (voucherType: string, voucherNo: string) => SaleType;

/** Everything the report needs to say WHY a line is unclassified. */
export interface SaleTypeRuleset {
  resolve: SaleTypeResolver;
  /** False when the rules could not be read at all — the page says so out loud. */
  loaded: boolean;
  ruleCount: number;
}

export async function loadSaleTypeRuleset(): Promise<SaleTypeRuleset> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("sale_type_rule")
    .select("rule_kind, match_value, sale_type, match_mode, case_sensitive, priority")
    .eq("is_active", true);

  if (error || !data) {
    // Degrade LOUDLY, never silently: everything lands in "Not yet classified",
    // which is visible on the page, rather than being quietly bucketed as ink.
    console.warn("[daily-report] could not read sale_type_rule — every line will read as unclassified.", error);
    return { resolve: () => "other", loaded: false, ruleCount: 0 };
  }

  const rules = (data as SaleTypeRule[])
    .slice()
    // The SQL's ORDER BY, reproduced exactly. Lower priority first, then the
    // LONGER match_value first so HEAD/M/ beats HEAD/ and SPARE/EN/ beats SPARE/.
    .sort((a, b) => a.priority - b.priority || (b.match_value ?? "").length - (a.match_value ?? "").length);

  const resolve: SaleTypeResolver = (voucherType, voucherNo) => {
    for (const r of rules) {
      // 'voucher_type' matches the voucher type; every other kind matches the
      // voucher number (which on the open-bill path is the bill name).
      const target = r.rule_kind === "voucher_type" ? voucherType : voucherNo;
      if (!target || !r.match_value) continue;
      const a = r.case_sensitive ? target : target.toUpperCase();
      const b = r.case_sensitive ? r.match_value : r.match_value.toUpperCase();
      const hit = r.match_mode === "prefix" ? a.startsWith(b) : a === b;
      if (hit) return KNOWN.includes(r.sale_type as SaleType) ? (r.sale_type as SaleType) : "other";
    }
    return "other";
  };

  return { resolve, loaded: true, ruleCount: rules.length };
}

/** Section headings, in the order the report prints them. */
export const SALE_TYPE_LABEL: Record<SaleType, string> = {
  ink: "Ink",
  head: "Print heads",
  machine: "Machines",
  spare_parts: "Spare parts",
  paper: "Paper",
  non_product: "Service and other income",
  other: "Not yet classified",
};

/**
 * Print order. `other` last on purpose — an unknown should be the thing a reader
 * finds at the bottom having already seen the real figures, not the thing that
 * displaces them.
 */
export const SALE_TYPE_ORDER: SaleType[] = [
  "ink", "head", "machine", "spare_parts", "paper", "non_product", "other",
];
