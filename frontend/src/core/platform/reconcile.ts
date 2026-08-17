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
 * them.
 *
 * ⚠ DECIDING AND APPLYING WERE SEPARATE ACTS, AND ARE NOT ANY MORE.
 *   While the Phase 1 cutover was still ahead of us, this screen only recorded
 *   opinions and the migration applied them in bulk — deliberately, so nobody
 *   was squinting at fuzzy name matches inside a maintenance window. The cutover
 *   has now run. A decision recorded after it would write a row here and change
 *   nothing at all: the Dispatch row and its Tally twin would stay two rows for
 *   ever, while the screen reported them reconciled.
 *
 *   So `applyReconcileLink` now performs the merge immediately, one row at a
 *   time, through `mst_apply_reconcile_link`. Same technique the cutover used —
 *   the row Dispatch already points at survives and absorbs the twin, keeping
 *   its id, so no order is ever rewritten.
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
  /**
   * exact  = same name ignoring case
   * close  = same after punctuation is ignored
   * prefix = same once Tally's "M/S" honorific is dropped
   */
  confidence: "exact" | "close" | "prefix";
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

/**
 * The same name with Tally's "M/S" honorific removed from the FRONT only.
 *
 * This is the single biggest reason a real match was never offered: the Dispatch
 * team types "AVADH FAB TEX" and Tally holds "M/S AVADH FAB TEX". Punctuation
 * normalisation alone cannot bridge that — it leaves "M S AVADH FAB TEX" — so 10
 * of the 16 customers left undecided after the Phase 1 cutover in fact had a
 * ledger sitting right there.
 *
 * ⚠ THIS IS AN EXTRA KEY, NEVER A REPLACEMENT. "M S" is also a perfectly real
 *   pair of initials, so a firm genuinely called "M S TRADING" must still match
 *   itself first. Indexing both forms adds candidates without ever removing one,
 *   and the suggestion is labelled `prefix` so the reader can see why it was
 *   offered rather than having to trust it.
 *
 * Deliberately front-anchored: "SHREE M/S" — were it ever to exist — is a
 * different name, not the same one.
 */
export const stripHonorific = (normalized: string): string =>
  normalized.replace(/^M\s?S\s+/, "").trim();

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

/**
 * Performs the merge the decision describes. Call this BEFORE recording the
 * decision: if the merge fails, nothing should claim to be reconciled.
 *
 * Returns the server's one-line summary ("merged: 4 catalogue row(s) moved…"),
 * or "already linked" when the survivor is already carrying that guid — which is
 * the normal answer for a row the Phase 1 cutover handled, and is not an error.
 */
export async function applyReconcileLink(
  table: LegacyTable,
  legacyId: string,
  tallyGuid: string,
): Promise<string> {
  const { data, error } = await db.rpc("mst_apply_reconcile_link", {
    p_legacy_table: table,
    p_legacy_id: legacyId,
    p_tally_guid: tallyGuid,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? "";
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
  const bare = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (!c.guid) continue;
    const push = (m: Map<string, Candidate[]>, k: string) => {
      if (!k) return;
      const arr = m.get(k);
      if (arr) arr.push(c); else m.set(k, [c]);
    };
    const norm = normalizeName(c.name);
    push(exact, c.name.trim().toUpperCase());
    push(close, norm);
    push(bare, stripHonorific(norm));
  }

  return (legacyName: string): Suggestion[] => {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    const take = (list: Candidate[] | undefined, confidence: Suggestion["confidence"]) => {
      for (const c of list ?? []) {
        if (!c.guid || seen.has(c.guid)) continue;
        seen.add(c.guid);
        out.push({ guid: c.guid, name: c.name, detail: c.detail, confidence });
      }
    };
    const norm = normalizeName(legacyName);
    take(exact.get(legacyName.trim().toUpperCase()), "exact");
    take(close.get(norm), "close");
    // Both sides are stripped, so this catches Tally's "M/S X" against a plain
    // "X" AND the rarer reverse. `seen` keeps anything already matched at a
    // higher confidence from being offered twice.
    take(bare.get(stripHonorific(norm)), "prefix");
    return out;
  };
}

/**
 * ⚠ DO NOT FILTER THESE BY `isCustomer`. It used to, and it hid real answers.
 *
 * `is_customer` is derived from the ledger's Tally GROUP, and the group is an
 * accounting classification, not a statement about who buys from us. GARTEX
 * TEXPROCESS INDIA sits under a creditor group — Tally files it as a vendor —
 * and there are eleven sales booked against it. Filtering on the flag removed it
 * from the suggestions AND from the manual picker, so the screen offered no way
 * to reach it at all and the row could only ever be marked "no Tally match".
 *
 * Every ledger is offered instead, and the ones Tally does not class for this
 * role are labelled so the reader can see what they are choosing. Deciding is a
 * human act; the job here is to inform it, not to pre-empt it.
 */
export const partyCandidates = (
  parties: MasterParty[],
  companyLabel: Map<string, string>,
  role: "customer" | "vendor",
): Candidate[] =>
  parties.map((p) => {
    const company = p.companyId ? companyLabel.get(p.companyId) ?? "" : "";
    const wrongRole = role === "customer" ? !p.isCustomer : !p.isVendor;
    const note = wrongRole ? (role === "customer" ? "Tally: vendor" : "Tally: customer") : "";
    return {
      guid: p.tallyGuid,
      name: p.name,
      detail: [company, note].filter(Boolean).join(" · "),
    };
  });

export const itemCandidates = (items: MasterItem[], groupLabel: Map<string, string>): Candidate[] =>
  items.map((i) => ({
    guid: i.tallyGuid,
    name: i.name,
    detail: i.groupId ? groupLabel.get(i.groupId) ?? "" : "",
  }));
