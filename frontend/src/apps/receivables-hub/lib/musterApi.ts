import { supabase } from "@/core/platform/supabase";
import { getConnectwaveSupabase } from "./connectwaveSupabase";

/**
 * Data access for the admin "Customer Muster" screen.
 *
 * READS come straight from the ConnectWave anon client (the muster tables are
 * anon-readable there). WRITES go through the `muster-write` Edge Function on the
 * IDENTITY project — it re-verifies the caller is an Orange One admin and then
 * writes to ConnectWave with ITS service key, so the browser never holds write
 * access to another project's data.
 *
 * The tables are seeded from the finance Google Sheets and topped up on every sync
 * with unchecked "stub" rows for brand-new customers (salesperson 'OTHERS', group =
 * own name). This screen is where a steward corrects those and ticks them off.
 */

export interface TagRow {
  ledger_id: string;        // Tally GUID (primary key)
  tally_name: string | null;
  salesperson: string | null;
  category: string | null;
  checked: boolean;
  match_status: string | null;
  source: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export interface GroupRow {
  ledger_id: string;        // Tally GUID (primary key) — same key as ext_ledger_tags
  tally_name: string | null;
  group_name: string;
  collection_team: string | null;
  checked: boolean;
  match_status: string | null;
  source: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/**
 * Manual (non-Tally) customer payments — ext_other_payments.
 *
 * Unlike the two musters above this is per-TRANSACTION, not one row per ledger: the `id` bigint
 * addresses a row, while `ledger_id` (the Tally GUID, NOT NULL) says whose money it is. That GUID
 * is what liveOtherPayments.ts groups by when it nets these out of the Live (Tally) snapshot —
 * which is why there is no name/company matching anywhere in this feature.
 */
export interface OtherPaymentRow {
  id: number;
  ledger_id: string;              // Tally GUID — NOT NULL
  tally_name: string | null;      // last-seen Tally name; display fallback only, never a key
  payment_date: string | null;    // ISO yyyy-mm-dd
  amount: number;                 // magnitude; direction is carried by allocation_type
  ref_invoice: string | null;
  allocation_type: string | null; // 'AGST REF' | 'ON ACCOUNT' (pinned by a DB check constraint)
  payment_ref: string | null;
  remarks: string | null;
  checked: boolean;
  match_status: string | null;
  source: string | null;          // 'other_payments_sheet' (seeded) | 'muster' (entered in-app)
  updated_at: string | null;
  updated_by: string | null;
}

/** Fields a caller supplies; the server sets match_status / source / updated_by itself. */
export interface OtherPaymentInput {
  ledger_id: string;
  tally_name: string | null;
  payment_date: string | null;
  amount: number;
  allocation_type: string;
  ref_invoice: string | null;
  payment_ref: string | null;
  remarks: string | null;
  checked: boolean;
}

/**
 * Red Mark customers — ext_redmark. A per-ledger flag keyed by the Tally GUID (one row per
 * red-marked customer; the row's presence IS the flag). Live (Tally) reads membership by ledger_id
 * (= Customer.id) to drive the red-mark badge/KPI/filter across the screens.
 */
export interface RedMarkRow {
  ledger_id: string;              // Tally GUID (primary key)
  tally_name: string | null;      // last-seen Tally name; display fallback only, never a key
  company: string | null;         // sheet company label (display)
  location: string | null;
  salesperson: string | null;
  reason: string | null;          // optional note
  checked: boolean;
  match_status: string | null;
  source: string | null;          // 'redmark_sheet' (seeded) | 'muster' (entered in-app)
  updated_at: string | null;
  updated_by: string | null;
}

/** Fields a caller supplies to add/flag a red-mark customer; server sets match_status/source/updated_by. */
export interface RedMarkInput {
  ledger_id: string;
  tally_name: string | null;
  company: string | null;
  location: string | null;
  salesperson: string | null;
  reason: string | null;
  checked: boolean;
}

// PostgREST caps a request at 1000 rows; page through until exhausted.
async function fetchAll<T>(table: string, columns: string, order: string): Promise<T[]> {
  const cw = getConnectwaveSupabase();
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await cw
      .from(table)
      .select(columns)
      .order(order, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export function fetchTagRows(): Promise<TagRow[]> {
  return fetchAll<TagRow>(
    "ext_ledger_tags",
    "ledger_id,tally_name,salesperson,category,checked,match_status,source,updated_at,updated_by",
    "tally_name",
  );
}

export function fetchGroupRows(): Promise<GroupRow[]> {
  return fetchAll<GroupRow>(
    "ext_ledger_group",
    "ledger_id,tally_name,group_name,collection_team,checked,match_status,source,updated_at,updated_by",
    "tally_name",
  );
}

/**
 * Every manual payment, for both the Masters tab and the Live (Tally) netting.
 *
 * Ordered by `id` — the UNIQUE primary key. That is not cosmetic: fetchAll pages with .range(), and
 * Postgres guarantees no row order without an ORDER BY, so an unordered walk can hand back the same
 * row twice and drop another. Ordering by a non-unique column is not enough (ties break arbitrarily).
 * This is the exact bug class this whole feature exists to fix — see the note in connectwaveFetcher.
 */
export function fetchOtherPaymentRows(): Promise<OtherPaymentRow[]> {
  return fetchAll<OtherPaymentRow>(
    "ext_other_payments",
    "id,ledger_id,tally_name,payment_date,amount,ref_invoice,allocation_type,payment_ref,remarks,checked,match_status,source,updated_at,updated_by",
    "id",
  );
}

/**
 * Per-ledger snapshot facts (from collection_customer_snapshot) used to enrich the
 * muster with company / location / closing balance. Keyed by ledger_id (the Tally
 * GUID), which is exactly the ext_ledger_tags primary key — so the same customer
 * name in two companies shows as two rows, each with its own company + balance.
 */
export interface SnapRow {
  ledger_id: string;
  tenant_id: string;        // needed to resolve the book's finance company/location via ext_company_map
  name: string | null;
  company: string | null;   // RAW Tally book name as stored; resolve via companyMap before display
  location: string | null;  // always '' in the snapshot — the real value comes from ext_company_map
  outstanding: number;
}

export function fetchSnapshot(): Promise<SnapRow[]> {
  return fetchAll<SnapRow>(
    "collection_customer_snapshot",
    "ledger_id,tenant_id,name,company,location,outstanding",
    "ledger_id",
  );
}

/** Invoke muster-write and surface the REAL error message (mirrors adminUserApi). */
async function invokeMuster(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke("muster-write", { body });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const parsed = await ctx.json();
        if (parsed?.error) detail = String(parsed.error);
      } catch {
        /* body wasn't JSON — keep the generic message */
      }
    }
    throw new Error(detail);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
}

export function saveTag(input: {
  ledger_id: string;
  salesperson: string | null;
  category: string | null;
  checked: boolean;
}): Promise<void> {
  return invokeMuster({ action: "update_tag", ...input });
}

export function saveGroup(input: {
  ledger_id: string;
  group_name: string | null;
  collection_team: string | null;
  checked: boolean;
}): Promise<void> {
  return invokeMuster({ action: "update_group", ...input });
}

/**
 * Company master (ext_company_map): Tally book → finance (company, location).
 * Keyed by the company GUID, so a yearly Tally rename never orphans the mapping.
 * Reads live via companyMap.fetchCompanyMap(); this is the write half.
 */
export function saveCompanyMap(input: {
  company_guid: string;
  tally_company: string | null;
  company: string | null;
  location: string | null;
  checked: boolean;
}): Promise<void> {
  return invokeMuster({ action: "update_company_map", ...input });
}

/**
 * Same as invokeMuster but hands back the response body.
 * A separate function rather than a widened invokeMuster: that one returns void and already has
 * three callers, and only the insert below needs the created row (so the tab can append it
 * without re-reading every payment).
 */
async function invokeMusterData<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("muster-write", { body });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const parsed = await ctx.json();
        if (parsed?.error) detail = String(parsed.error);
      } catch {
        /* body wasn't JSON — keep the generic message */
      }
    }
    throw new Error(detail);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

/** Add a payment. Resolves to the created row (id assigned by the DB). */
export function insertOtherPayment(input: OtherPaymentInput): Promise<{ row: OtherPaymentRow }> {
  return invokeMusterData<{ row: OtherPaymentRow }>({ action: "insert_other_payment", ...input });
}

/** Edit a payment. Throws (404) if the row no longer exists — never a silent no-op. */
export function saveOtherPayment(input: OtherPaymentInput & { id: number }): Promise<void> {
  return invokeMuster({ action: "update_other_payment", ...input });
}

export function deleteOtherPayment(id: number): Promise<void> {
  return invokeMuster({ action: "delete_other_payment", id });
}

/**
 * Every red-mark customer, for both the Masters tab and the Live (Tally) flag. Ordered by the
 * UNIQUE primary key `ledger_id` — required for correct .range() paging (see fetchOtherPaymentRows).
 */
export function fetchRedMarkRows(): Promise<RedMarkRow[]> {
  return fetchAll<RedMarkRow>(
    "ext_redmark",
    "ledger_id,tally_name,company,location,salesperson,reason,checked,match_status,source,updated_at,updated_by",
    "ledger_id",
  );
}

/** Flag a customer as Red Mark. Upserts on ledger_id, so re-adding is idempotent. Returns the row. */
export function insertRedMark(input: RedMarkInput): Promise<{ row: RedMarkRow }> {
  return invokeMusterData<{ row: RedMarkRow }>({ action: "insert_redmark", ...input });
}

/** Edit a red-mark row's metadata (reason/salesperson/checked). Throws (404) if it no longer exists. */
export function saveRedMark(input: {
  ledger_id: string;
  salesperson: string | null;
  reason: string | null;
  checked: boolean;
}): Promise<void> {
  return invokeMuster({ action: "update_redmark", ...input });
}

/** Un-flag a customer (delete the row) by Tally GUID. */
export function deleteRedMark(ledger_id: string): Promise<void> {
  return invokeMuster({ action: "delete_redmark", ledger_id });
}
