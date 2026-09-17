import { supabase } from "@/core/platform/supabase";
import { fetchAll } from "@hub/lib/musterApi";
import { MASTERS_BULK_LOAD_END, ymdToIso, type VoucherDates } from "@hub/lib/creditTermsPivot";

/**
 * The two reads behind the Credit Terms report's "Customer since" and "Last transaction" (RC-19).
 * The rules that combine them live in creditTermsPivot.ts, next to the evidence for them.
 *
 * Neither read is scoped. Both are joined onto `allCustomers`, which useAppData has already narrowed to
 * the viewer, so a ledger outside the viewer's scope is never looked up. Both return a Map, so their
 * query keys must stay OUT of main.tsx's PERSISTED_QUERY_ROOTS — a Map does not survive the JSON round
 * trip into IndexedDB.
 */

interface VoucherDateRow {
  ledger_guid: string;
  first_vch_date: string;
  last_vch_date: string;
  last_vch_type: string | null;
}

/**
 * First and last Tally voucher per customer ledger, from ConnectWave's precomputed
 * rpt_ledger_voucher_dates (supabase/connectwave/rpt_ledger_voucher_dates.sql), rebuilt after every
 * snapshot refresh. ~1,270 rows. A ledger GUID never spans two companies, so it alone is the key.
 */
export async function fetchLedgerVoucherDates(): Promise<Map<string, VoucherDates>> {
  const rows = await fetchAll<VoucherDateRow>(
    "rpt_ledger_voucher_dates",
    "ledger_guid,first_vch_date,last_vch_date,last_vch_type",
    ["tenant_id", "ledger_guid"],
  );
  return new Map(rows.map((r) => [
    r.ledger_guid,
    { first: ymdToIso(r.first_vch_date), last: ymdToIso(r.last_vch_date), lastType: r.last_vch_type ?? "" },
  ]));
}

/**
 * When Orange One's masters sync first saw each Tally ledger — ONLY for ledgers first seen after the
 * bulk load, which is the only span where the date means anything (see creditTermsPivot.ts). About 180
 * rows of every party type; mst_parties.tally_guid is the ConnectWave ledger_id.
 *
 * Readable by any staff user (mst_parties_select = is_staff); nobody with Outstanding Dashboard access
 * was external on 17-09-2026.
 */
export async function fetchFirstSeenAfterBulkLoad(): Promise<Map<string, string>> {
  // The mst_* tables are not in the generated Database types, same as core/platform/liveMasters.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const out = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("mst_parties")
      .select("tally_guid,created_at")
      .gt("created_at", MASTERS_BULK_LOAD_END)
      .not("tally_guid", "is", null)
      .order("tally_guid", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { tally_guid: string; created_at: string }[];
    for (const r of rows) out.set(r.tally_guid, r.created_at);
    if (rows.length < PAGE) break;
  }
  return out;
}
