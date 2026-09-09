import { supabase } from "@/core/platform/supabase";
import type { ComplaintType } from "../types";

/**
 * Resolve a LOT No. to the invoice line(s) it was shipped or received on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SOURCE IS CONNECTWAVE — `rpt_batch_line` in project ieeefdnyhzgrroifiqbb.
 *
 * This file has been wrong twice, and both corrections are worth keeping.
 *
 *   1. It first said the LOT was unreachable. WRONG — Tally carries it per
 *      inventory line at ALLINVENTORYENTRIES.BATCHALLOCATIONS.BATCHNAME. Nobody
 *      had seen it because every existing exporter's FETCH list stops at
 *      STOCKITEMNAME / BILLEDQTY / RATE / AMOUNT and never asks for the batch
 *      sub-list.
 *
 *   2. It then read `public.fms_complaint_lot_index` — a copy of that data
 *      pulled out of Tally by tools/sync_tally_lot_index.py, because the mirror
 *      did not carry the batch. THAT IS NO LONGER TRUE either: ConnectWave
 *      gained `rpt_batch_line` on 07-09-2026.
 *
 * Measured 08-09-2026, which is why the swap was worth making:
 *
 *                            our synced index      ConnectWave
 *     real lots                      31,852            112,277
 *     purchase lines                  1,875              9,698
 *
 * The purchase column is the one that changes behaviour. The RM arm of this
 * module was documented as "will miss three times in four" on the old source;
 * on this one it answers.
 *
 * ⚠ THE SYNC SCRIPT AND ITS INDEX ARE NOT DELETED, and this is deliberate. They
 *   still work, and they are the fallback if ConnectWave's batch build ever
 *   stops. Nothing in this file reads them any more.
 *
 * ⚠ CONNECTWAVE KNOWS NAMES, NOT OUR IDS. It mirrors Tally, so a row names a
 *   party, an item and a company as Tally spells them and has never heard of
 *   mst_parties.id. `fms_complaint_resolve_lot_rows` (migration 20261110121600)
 *   is the bridge — it resolves company first, then party and item WITHIN that
 *   book, and refuses to guess when a name is ambiguous. The rules live in SQL
 *   because they are subtle and were each learned the hard way; see that
 *   migration's header.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THREE MEASURED FACTS THAT SHAPE THE SIGNATURE BELOW.
 *
 * 1. A LOT IS NOT A UNIQUE KEY — it returns a LIST, never one row. 92% of lot
 *    numbers appear on more than one inventory line, and that is correct rather
 *    than dirty: a drum is bought once and sold from repeatedly. Lot 26071158 is
 *    a purchase from Enterprises-(Surat) and then two sales, to K.R. Saroj
 *    Knitwears and to Vaibhav Enterprises. Worst case found: one lot on 581
 *    lines.
 *
 *    So the honest interaction is "type a LOT, pick which shipment you mean".
 *    A silent autofill would put a coin-toss customer on the complaint.
 *
 * 2. THE RAW STRING NEEDS NORMALISING. Lots arrive bare (26081377) or with
 *    internal references glued on ("#1642-26071158", "F22512127359",
 *    "#952 #953-2602582"). {@link normaliseLot} is the shared rule.
 *
 * 3. LOT EXPIRY STILL DOES NOT EXIST. `rpt_batch_line` has a `batch_expiry`
 *    column and it is populated on ZERO of 112,277 real lots (`batch_mfd` on
 *    one). The column existing is not the same as the data existing, and the
 *    complaint form must keep asking the user to type it.
 */

/** Tally's placeholders for "this item has no batch tracking". Never a real lot. */
const PLACEHOLDER_LOTS = new Set(["primary batch", "any", "not applicable"]);

/**
 * The lot number inside a raw Tally batch name.
 *
 * "26081377" → "26081377"; "#1642-26071158" → "26071158";
 * "F22512127359" → "22512127359"; "Primary Batch" → null.
 *
 * ⚠ ONE RULE, SHARED, and it is the EQUALITY TEST rather than the query. The
 *   database filter below is a substring `ilike`, which is deliberately loose so
 *   the network fetch stays small; this function then decides what actually
 *   matched. Without that second pass, lot "2601403" would also return
 *   "26014030".
 */
export function normaliseLot(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || PLACEHOLDER_LOTS.has(s.toLowerCase())) return null;
  // The lot is the trailing digit run; anything before it is internal references.
  const m = /(\d{5,})\s*$/.exec(s);
  return m ? m[1] : null;
}

/** One invoice line a LOT was shipped or received on — a candidate, not an answer. */
export interface LotMatch {
  /** "sales" — we shipped it (FG). "purchase" — we received it (RM). */
  direction: "sales" | "purchase";
  voucherNo: string;
  /** yyyy-mm-dd. */
  voucherDate: string;
  /** Which of OUR books the voucher is in — fills the Company picker. */
  companyId: string | null;
  /** Tally's own company name, for display when the book did not map. */
  tallyCompany: string;
  partyName: string;
  partyId: string | null;
  itemName: string;
  itemId: string | null;
  category: string | null;
  inkType: string | null;
  qty: string | null;
  godown: string | null;
  /** The batch string exactly as Tally holds it, for display beside the clean lot. */
  rawBatch: string;
}

/** Shape of the ConnectWave row we read. Only the columns we use. */
interface BatchLineRow {
  batch_name: string | null;
  stock_item: string | null;
  party: string | null;
  voucher_no: string | null;
  voucher_type: string | null;
  vch_date: string | null;
  direction: string | null;
  company_guid: string | null;
  qty_text: string | null;
  godown_name: string | null;
}

/**
 * ConnectWave's company guid → the company name Tally reports. FOR DISPLAY ONLY.
 *
 * ⚠ THE GUID IS THE KEY, NOT THIS NAME. `v_company` returns SEVEN rows for FIVE
 *   companies: a Tally file that has been renamed appears under both names
 *   against one guid — "…(F.Y.2026-27)" and "…(F.Y.2024-26)" are one book of
 *   39,235 lines, counted twice. Resolving a book by name therefore depended on
 *   which of the two names happened to win this map, and the FY-renamed spelling
 *   is not the one `mst_companies.tally_name` holds. That is exactly how the
 *   Company picker came back empty for lot 26071221.
 *
 *   So the guid is what goes to the resolver, and this map only supplies a label
 *   for the rare book that does not map at all. `keepFirst` makes it at least
 *   deterministic.
 *
 * Cached — it never changes within a session, and re-reading it per keystroke
 * would be a second round trip for a label.
 */
let companyNames: Map<string, string> | null = null;

async function companyNameByGuid(): Promise<Map<string, string>> {
  if (companyNames) return companyNames;
  // ⚠ DYNAMIC IMPORT, NOT STATIC. A static import of the ConnectWave client
  //   pulls a second Supabase client into the entry bundle for every user of
  //   every app — the same trap documented at core/admin/UserForm.tsx.
  const { getConnectwaveSupabase } = await import(
    "@/apps/receivables-hub/lib/connectwaveSupabase"
  );
  const { data, error } = await getConnectwaveSupabase()
    .from("v_company")
    .select("company_guid,company_name");
  if (error) throw new Error(error.message);
  const m = new Map<string, string>();
  for (const r of (data ?? []) as { company_guid: string; company_name: string }[]) {
    // keepFirst: a renamed book yields two rows for one guid, and last-write-wins
    // would make the label depend on row order.
    if (r.company_guid && !m.has(r.company_guid)) m.set(r.company_guid, r.company_name ?? "");
  }
  companyNames = m;
  return m;
}

/** Tally's yyyymmdd → the yyyy-mm-dd the form's date inputs expect. */
function isoDate(raw: string | null): string {
  const s = (raw ?? "").trim();
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Already ISO, or something we do not recognise — hand it back rather than
  // inventing a date.
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

/**
 * Find the shipments a LOT appears on, newest first.
 *
 * A LIST, never one answer — see fact 1 in the header. The caller shows them and
 * the user picks; nothing is applied automatically.
 *
 * Two round trips, and both are needed: ConnectWave holds the shipment, our own
 * database holds the ids that shipment maps to. Neither can answer alone.
 */
export async function findLotMatches(
  complaintType: ComplaintType,
  lotNo: string,
): Promise<LotMatch[]> {
  const key = normaliseLot(lotNo);
  if (!key) return [];

  // A finished-good complaint asks who we SHIPPED it to; a raw-material one asks
  // who we BOUGHT it from. Narrowing here rather than in the UI keeps a customer
  // out of a vendor picker.
  const direction = complaintType === "finished_good" ? "sales" : "purchase";

  const { getConnectwaveSupabase } = await import(
    "@/apps/receivables-hub/lib/connectwaveSupabase"
  );

  const [names, res] = await Promise.all([
    companyNameByGuid(),
    getConnectwaveSupabase()
      .from("rpt_batch_line")
      .select(
        "batch_name,stock_item,party,voucher_no,voucher_type,vch_date,direction,company_guid,qty_text,godown_name",
      )
      // Loose on purpose — `normaliseLot` below is what decides a match. The
      // filter exists to keep the fetch small, not to be correct.
      .ilike("batch_name", `%${key}%`)
      // Drops "Primary Batch" / "Any": ConnectWave has already worked out which
      // lines carry a real lot, so we do not re-derive it.
      .eq("is_real_lot", true)
      .eq("direction", direction)
      .order("vch_date", { ascending: false })
      .limit(300),
  ]);
  if (res.error) throw new Error(res.error.message);

  // THE EXACT TEST. `ilike` matched a substring; the lot is what normalises to
  // the same key.
  const rows = ((res.data ?? []) as BatchLineRow[])
    .filter((r) => normaliseLot(r.batch_name) === key)
    .slice(0, 100);
  if (rows.length === 0) return [];

  // Our ids, resolved in SQL — see migration 20261110121600. Matched back BY
  // POSITION, which is why the RPC returns `idx` and nothing here reorders.
  const { data: resolved, error } = await (supabase as any).rpc(
    "fms_complaint_resolve_lot_rows",
    {
      p_rows: rows.map((r) => ({
        // THE BOOK IS MATCHED ON THE GUID — stable across Tally's FY renames.
        // The name rides along only as the resolver's fallback.
        company_guid: r.company_guid,
        tally_company: names.get(r.company_guid ?? "") ?? "",
        party_name: r.party,
        item_name: r.stock_item,
      })),
    },
  );
  if (error) throw new Error(error.message);

  const byIdx = new Map<number, any>();
  for (const x of (resolved ?? []) as any[]) byIdx.set(x.idx, x);

  return rows.map((r, i) => {
    const got = byIdx.get(i) ?? {};
    return {
      direction: (r.direction === "purchase" ? "purchase" : "sales") as
        | "sales"
        | "purchase",
      voucherNo: r.voucher_no ?? "",
      voucherDate: isoDate(r.vch_date),
      companyId: got.company_id ?? null,
      tallyCompany: names.get(r.company_guid ?? "") ?? "",
      partyName: r.party ?? "",
      partyId: got.party_id ?? null,
      itemName: r.stock_item ?? "",
      itemId: got.item_id ?? null,
      category: got.category ?? null,
      inkType: got.ink_type ?? null,
      // `qty_text` keeps Tally's own "100.0000 KGS" welding of number and unit;
      // splitTallyQty at the call site is what pulls them apart.
      qty: r.qty_text ?? null,
      godown: r.godown_name ?? null,
      rawBatch: r.batch_name ?? "",
    };
  });
}

/**
 * Whether the LOT lookup is wired. TRUE — it reads ConnectWave.
 */
export const LOT_LOOKUP_AVAILABLE = true;

/**
 * Can the lot source actually answer right now?
 *
 * ⚠ AN UNREACHABLE SOURCE AND A LOT THAT DOES NOT EXIST LOOK IDENTICAL from the
 *   form — both are "no rows". Blaming the user's lot number for a ConnectWave
 *   outage or a missing env var is the wrong message, so the form asks this
 *   before it reports a miss.
 *
 * One cheap head count; any failure is reported as "not ready" rather than
 * thrown, because a lookup problem must never block raising a complaint.
 */
export async function lotSourceReady(): Promise<boolean> {
  try {
    const { getConnectwaveSupabase } = await import(
      "@/apps/receivables-hub/lib/connectwaveSupabase"
    );
    const { count, error } = await getConnectwaveSupabase()
      .from("rpt_batch_line")
      .select("tenant_id", { count: "exact", head: true })
      .eq("is_real_lot", true);
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}
