import { supabase } from "./supabase";
import type { MasterItem, MasterParty } from "./liveMasters";

/**
 * RECONCILE — matching the hand-typed Dispatch masters to their Tally records.
 *
 * Order to Dispatch has 326 customers and 246 items typed in by hand over
 * months. Tally has 7,812 parties and 14,228 items. Many are the same real
 * firm or the same real product, and NOTHING JOINS THEM: the Dispatch `code`
 * column is free text and mostly empty, and the names differ by punctuation,
 * suffixes and spelling.
 *
 * So a human decides, one row at a time, helped by ranked suggestions. This file
 * computes the suggestions and records the decisions; mst_reconcile_links holds
 * them. Phase 1's cutover reads that ledger — the deciding and the applying are
 * deliberately separate acts, so nobody is squinting at fuzzy name matches during
 * a maintenance window.
 *
 * ⚠ SUGGESTIONS ARE NEVER STORED. They are recomputed from live data every time
 *   this screen opens. Storing them would mean a later sync could silently
 *   change what looks like somebody's answer.
 */
const db = supabase as any;

export type LegacyTable = "fms_dispatch_customers" | "fms_dispatch_items";

export interface LegacyRow {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
}

export interface ReconcileLink {
  legacyTable: LegacyTable;
  legacyId: string;
  tallyGuid: string | null;
  matchedName: string | null;
  status: "linked" | "portal_only";
  decidedAt: string;
}

export interface Suggestion {
  guid: string;
  name: string;
  detail: string;
  /** exact = same name ignoring case; close = same after punctuation is ignored. */
  confidence: "exact" | "close";
}

/**
 * Names are compared with punctuation and spacing ignored, and NOTHING ELSE
 * stripped.
 *
 * ⚠ IT IS TEMPTING TO STRIP "PVT LTD", "LLP" AND "- MACHINE". Do not. In this
 *   Tally, "AADESH DIGITAL PRINTS" and "AADESH DIGITAL PRINTS-MACHINE" are two
 *   deliberately separate ledgers — the trading account and the machine account
 *   for one customer, carrying different balances. Folding those together would
 *   propose a wrong merge with high confidence, which is worse than proposing
 *   nothing at all.
 */
export const normalizeName = (s: string): string =>
  (s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

export async function fetchLegacyRows(table: LegacyTable): Promise<LegacyRow[]> {
  const { data, error } = await db
    .from(table)
    .select("id,name,code,active")
    .order("name", { ascending: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    id: r.id, name: r.name ?? "", code: r.code ?? null, active: r.active ?? true,
  }));
}

export async function fetchReconcileLinks(): Promise<ReconcileLink[]> {
  const { data, error } = await db
    .from("mst_reconcile_links")
    .select("legacy_table,legacy_id,tally_guid,matched_name,status,decided_at");
  if (error) throw new Error(`mst_reconcile_links: ${error.message}`);
  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    legacyTable: r.legacy_table, legacyId: r.legacy_id, tallyGuid: r.tally_guid ?? null,
    matchedName: r.matched_name ?? null, status: r.status, decidedAt: r.decided_at,
  }));
}

/** Records (or re-records) one decision. Upsert, so re-deciding replaces. */
export async function saveReconcileDecision(input: {
  legacyTable: LegacyTable;
  legacyId: string;
  legacyName: string;
  tallyGuid: string | null;
  matchedName: string | null;
  status: "linked" | "portal_only";
  decidedBy: string | null;
}): Promise<void> {
  const { error } = await db.from("mst_reconcile_links").upsert({
    legacy_table: input.legacyTable,
    legacy_id: input.legacyId,
    legacy_name: input.legacyName,
    tally_guid: input.tallyGuid,
    matched_name: input.matchedName,
    status: input.status,
    decided_by: input.decidedBy,
    decided_at: new Date().toISOString(),
  }, { onConflict: "legacy_table,legacy_id" });
  if (error) throw new Error(error.message);
}

export async function clearReconcileDecision(table: LegacyTable, legacyId: string): Promise<void> {
  const { error } = await db.from("mst_reconcile_links")
    .delete().eq("legacy_table", table).eq("legacy_id", legacyId);
  if (error) throw new Error(error.message);
}

type Candidate = { guid: string | null; name: string; detail: string };

/**
 * Builds a normalized-name index once, then answers each legacy row from it.
 *
 * The naive form is 326 x 7,812 comparisons per keystroke. Indexing first makes
 * each lookup a Map hit, which is what keeps this screen usable on the Items tab
 * (246 x 14,228).
 *
 * A name can map to SEVERAL candidates and that is expected, not a fault: the
 * same firm is a separate ledger in every Tally company, so "A S TRADING" is
 * genuinely three records. They are all offered, labelled by company, because
 * only a human knows which one Dispatch has been billing.
 */
export function buildMatcher(candidates: Candidate[]) {
  const exact = new Map<string, Candidate[]>();
  const close = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (!c.guid) continue;
    const push = (m: Map<string, Candidate[]>, k: string) => {
      const arr = m.get(k);
      if (arr) arr.push(c); else m.set(k, [c]);
    };
    push(exact, c.name.trim().toUpperCase());
    push(close, normalizeName(c.name));
  }

  return (legacyName: string): Suggestion[] => {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    const take = (list: Candidate[] | undefined, confidence: "exact" | "close") => {
      for (const c of list ?? []) {
        if (!c.guid || seen.has(c.guid)) continue;
        seen.add(c.guid);
        out.push({ guid: c.guid, name: c.name, detail: c.detail, confidence });
      }
    };
    take(exact.get(legacyName.trim().toUpperCase()), "exact");
    take(close.get(normalizeName(legacyName)), "close");
    return out;
  };
}

export const partyCandidates = (
  parties: MasterParty[],
  companyLabel: Map<string, string>,
  role: "customer" | "vendor",
): Candidate[] =>
  parties
    .filter((p) => (role === "customer" ? p.isCustomer : p.isVendor))
    .map((p) => ({
      guid: p.tallyGuid,
      name: p.name,
      detail: p.companyId ? companyLabel.get(p.companyId) ?? "" : "",
    }));

export const itemCandidates = (items: MasterItem[], groupLabel: Map<string, string>): Candidate[] =>
  items.map((i) => ({
    guid: i.tallyGuid,
    name: i.name,
    detail: i.groupId ? groupLabel.get(i.groupId) ?? "" : "",
  }));
