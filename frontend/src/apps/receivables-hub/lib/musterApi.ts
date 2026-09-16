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
  /**
   * RC-12 — the case is settled. The row STAYS; the customer stops counting as Red Mark
   * everywhere (connectwaveFetcher skips cleared rows when building Customer.blocked).
   *
   * ⚠ NOT `checked`, which means "a steward has verified this row" and is true on all 54.
   */
  cleared: boolean;
  cleared_at: string | null;
  cleared_by: string | null;
  /**
   * How it ended. Required on clear (a DB check constraint enforces it, not just the UI) —
   * a partly-paid case may be cleared, so this is the only thing that explains a cleared row
   * with money still owed against it.
   *
   * ⚠ SURVIVES A REOPEN, deliberately: it is then the record of how the LAST clearing ended.
   *   Read it together with `cleared`, never on its own.
   */
  clear_note: string | null;
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
// Exported for lib/nameMasters.ts, which reads the two vocabulary masters the same way.
//
// `order` must be UNIQUE across the table, or the paging can repeat one row and drop another. Pass
// several columns when only their combination is (collection_invoice_snapshot: ledger + bill).
export async function fetchAll<T>(table: string, columns: string, order: string | string[]): Promise<T[]> {
  const cw = getConnectwaveSupabase();
  const out: T[] = [];
  const PAGE = 1000;
  const orderBy = Array.isArray(order) ? order : [order];
  for (let from = 0; ; from += PAGE) {
    let q = cw.from(table).select(columns);
    for (const col of orderBy) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
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

/**
 * Invoke muster-write and surface the REAL error message (mirrors adminUserApi).
 * Exported for lib/nameMasters.ts — the vocabulary masters write through the same door.
 */
export async function invokeMuster(body: Record<string, unknown>): Promise<void> {
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
 *
 * Exported for lib/nameMasters.ts: a vocabulary rename cascades across two projects and returns a
 * per-target row count, which the screen reports rather than saying a bare "Renamed".
 */
export async function invokeMusterData<T>(body: Record<string, unknown>): Promise<T> {
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
    "ledger_id,tally_name,company,location,salesperson,reason,checked,match_status,source,updated_at,updated_by,cleared,cleared_at,cleared_by,clear_note",
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

/**
 * Un-flag a customer (delete the row) by Tally GUID.
 *
 * ⚠ THIS IS NOT "THEY PAID" — that is `clearRedMark`. Delete is for a customer marked by MISTAKE,
 *   and it destroys the case history. Both actions exist on purpose; see RC-12.
 */
export function deleteRedMark(ledger_id: string): Promise<void> {
  return invokeMuster({ action: "delete_redmark", ledger_id });
}

/**
 * Close a settled case (RC-12). The row stays, marked cleared, with who / when / why.
 *
 * The note is REQUIRED — by the server and by a DB check constraint, not merely by the dialog.
 *
 * ⚠ THIS ACTION HAS A DIFFERENT AUTHORISATION RULE FROM EVERY OTHER MUSTER WRITE: the collection
 *   team may clear THEIR OWN customers, alongside admins and Settings full-access users. Use
 *   `useCanClear()` (lib/clearStatus.ts) to decide whether to offer it — that hook mirrors the
 *   server's rule, which is the one that actually decides.
 */
export function clearRedMark(ledger_id: string, clear_note: string): Promise<{ row: RedMarkRow }> {
  return invokeMusterData<{ row: RedMarkRow }>({ action: "clear_redmark", ledger_id, clear_note });
}

/** Reopen a cleared case. Keeps the previous clearing's who/when/note as history. */
export function reopenRedMark(ledger_id: string): Promise<{ row: RedMarkRow }> {
  return invokeMusterData<{ row: RedMarkRow }>({ action: "reopen_redmark", ledger_id });
}

// ── Disputed bills (RC-13) ───────────────────────────────────────────────────

/**
 * A customer bill under dispute — ext_dispute. One row per (ledger_id, bill_ref), addressed by `id`.
 *
 * ⚠ IT HOLDS ONLY WHAT A HUMAN TYPED. The bill's date, amount, pending and sale type are joined LIVE
 *   from the invoice snapshot by whoever displays it; nothing here is a copy of Tally.
 *
 * ⚠ THE BILL NUMBER ALONE IS NOT A KEY. 982 bill numbers are shared by 2,010 open bills across
 *   customers; only (ledger_id, bill_ref) is unique, and every lookup must use both.
 */
export interface DisputeRow {
  id: number;
  ledger_id: string;              // Tally ledger GUID (= Customer.id)
  bill_ref: string;               // the snapshot's own spelling (= Invoice.billRefName), matched exactly
  tally_name: string | null;      // customer name when added; display fallback only
  remarks: string | null;
  item_description: string | null;
  checked: boolean;
  match_status: string | null;
  source: string | null;          // 'muster' (entered in-app) | 'dispute_sheet' (the seed load)
  updated_at: string | null;
  updated_by: string | null;
  /** Settled. The row STAYS. Same four columns, same meaning, as RedMarkRow. */
  cleared: boolean;
  cleared_at: string | null;
  cleared_by: string | null;
  /** ⚠ Survives a reopen — it then describes the LAST clearing. Read it with `cleared`. */
  clear_note: string | null;
}

/**
 * One string for a bill's full key, for Sets and Maps. Plain text on purpose, and unambiguous: a Tally
 * ledger GUID never contains "::", so the ledger half cannot run into the bill half.
 */
export const disputeKey = (ledgerId: string, billRef: string) => `${ledgerId}::${billRef}`;

/** Every dispute, cleared or not, ordered by the unique `id` (see fetchOtherPaymentRows on why). */
export function fetchDisputeRows(): Promise<DisputeRow[]> {
  return fetchAll<DisputeRow>(
    "ext_dispute",
    "id,ledger_id,bill_ref,tally_name,remarks,item_description,checked,match_status,source,updated_at,updated_by,cleared,cleared_at,cleared_by,clear_note",
    "id",
  );
}

/**
 * Put one or more of a customer's OPEN bills in dispute, with one remark. Resolves to the new rows.
 *
 * All or nothing: the server inserts them in one statement, refuses a bill that is not open in Tally
 * (400) and one already on the list (409, naming it and whether it is cleared).
 */
export function insertDisputes(input: {
  ledger_id: string;
  tally_name: string | null;
  bill_refs: string[];
  remarks: string | null;
  item_description: string | null;
}): Promise<{ rows: DisputeRow[] }> {
  return invokeMusterData<{ rows: DisputeRow[] }>({ action: "insert_dispute", ...input });
}

/**
 * Edit a dispute's typed fields. ONLY the fields passed are written — the report edits the remark
 * alone, and must not send back an item description loaded minutes ago over a colleague's edit.
 * Admin / Settings full access only.
 */
export function saveDispute(input: {
  id: number;
  remarks?: string | null;
  item_description?: string | null;
  checked?: boolean;
}): Promise<{ row: DisputeRow }> {
  return invokeMusterData<{ row: DisputeRow }>({ action: "update_dispute", ...input });
}

/** ⚠ For a bill put in dispute by MISTAKE. A settled dispute is cleared, and the record stays. */
export function deleteDispute(id: number): Promise<void> {
  return invokeMuster({ action: "delete_dispute", id });
}

/**
 * Close a settled dispute. The note is required (dialog, server, and a DB check constraint).
 *
 * ⚠ THE SAME NARROWER DOOR AS clearRedMark: the customer's collection team may clear it, alongside
 *   admins and Settings full-access users. Decide whether to offer it with `useCanClear()`.
 */
export function clearDispute(id: number, clear_note: string): Promise<{ row: DisputeRow }> {
  return invokeMusterData<{ row: DisputeRow }>({ action: "clear_dispute", id, clear_note });
}

/** Reopen a cleared dispute. Keeps the previous clearing's who/when/note as history. */
export function reopenDispute(id: number): Promise<{ row: DisputeRow }> {
  return invokeMusterData<{ row: DisputeRow }>({ action: "reopen_dispute", id });
}

/**
 * The open bills, straight from collection_invoice_snapshot — for Settings → Masters, which reads
 * the raw snapshot like every other muster tab rather than the scoped dashboard payload.
 *
 * ⚠ RAW TALLY FIGURES. The dashboard's copy of the same bill has manual Other Payments netted into
 *   `pending` (liveOtherPayments) and a few cash-voucher "bills" removed (liveNonBillRefs); this one
 *   has neither. That is why the Masters tab shows only whether a bill is still open and leaves the
 *   money to the Disputed Bills report, where it matches every other screen.
 */
export interface OpenBillRow {
  ledger_id: string;
  bill_ref: string;
  bill_date: string | null;       // yyyymmdd, as the snapshot stores it
  due_date: string | null;
  amount: number;
  pending: number;
  overdue_days: number;
  sale_type: string | null;
}

export function fetchOpenBills(): Promise<OpenBillRow[]> {
  return fetchAll<OpenBillRow>(
    "collection_invoice_snapshot",
    "ledger_id,bill_ref,bill_date,due_date,amount,pending,overdue_days,sale_type",
    // Unique only together (the table's key also carries tenant_id, and ledger GUIDs never repeat
    // across tenants — 0 duplicate (ledger_id, bill_ref) pairs on 17-09-2026).
    ["ledger_id", "bill_ref"],
  );
}
