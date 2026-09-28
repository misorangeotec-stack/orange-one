import { fetchAll } from "@hub/lib/musterApi";
import { ymdToIso, type VoucherDates } from "@hub/lib/creditTermsPivot";

/**
 * The read behind the Credit Terms report's "Last activity" columns (RC-19). What it feeds is in
 * creditTermsPivot.ts, next to the evidence for it.
 *
 * It is not scoped: it is joined onto `allCustomers`, which useAppData has already narrowed to the
 * viewer, so a ledger outside the viewer's scope is never looked up. It returns a Map, so its query key
 * must stay OUT of main.tsx's PERSISTED_QUERY_ROOTS — a Map does not survive the JSON round trip into
 * IndexedDB.
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
