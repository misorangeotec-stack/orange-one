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
 * Per-ledger snapshot facts (from collection_customer_snapshot) used to enrich the
 * muster with company / location / closing balance. Keyed by ledger_id (the Tally
 * GUID), which is exactly the ext_ledger_tags primary key — so the same customer
 * name in two companies shows as two rows, each with its own company + balance.
 */
export interface SnapRow {
  ledger_id: string;
  name: string | null;
  company: string | null;
  location: string | null;
  outstanding: number;
}

export function fetchSnapshot(): Promise<SnapRow[]> {
  return fetchAll<SnapRow>(
    "collection_customer_snapshot",
    "ledger_id,name,company,location,outstanding",
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
