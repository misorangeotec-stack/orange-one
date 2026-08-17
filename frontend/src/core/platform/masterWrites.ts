import { supabase } from "./supabase";

/**
 * CENTRAL MASTERS — the write half. Read half is liveMasters.ts.
 *
 * Same shape as directoryWrites.ts: plain exported async functions, one per
 * operation, each building a partial patch and throwing on error. No optimistic
 * updates — the caller awaits, then invalidates.
 *
 * ⚠ WHAT A HUMAN MAY EDIT ON A TALLY-SOURCED ROW.
 *   A row with source = 'tally' has fields Tally owns and refreshes on every
 *   sync — name, GSTIN, group, credit terms. Writing to those from here is
 *   pointless: the next pull overwrites them, so the edit silently disappears
 *   minutes later, which is worse than refusing it. TALLY_OWNED_FIELDS below is
 *   the list, it is enforced in updateMaster, and the form renders those fields
 *   read-only for the same reason. The two must be changed together.
 *
 *   Everything else — which modules offer the row, sort order, active, contact
 *   details, HSN, gate-pass prefix — is the portal's, and the sync never touches
 *   it. That guarantee is tested: a portal edit survives a forced re-sync.
 */
const db = supabase as any;

/** Master types, matching mst_master_managers' CHECK and mst_is_master_manager. */
export type CentralMasterType =
  | "company" | "party" | "item" | "item_group" | "unit" | "location" | "party_item";

export const MASTER_TABLE: Record<CentralMasterType, string> = {
  company: "mst_companies",
  party: "mst_parties",
  item: "mst_items",
  item_group: "mst_item_groups",
  unit: "mst_units",
  location: "mst_locations",
  party_item: "mst_party_items",
};

/**
 * Columns a Tally sync owns and rewrites, per master type.
 */
export const TALLY_OWNED_FIELDS: Record<CentralMasterType, readonly string[]> = {
  // `name` IS Tally's for a company — its real book name, rewritten every sync
  // and re-minted each April. The editable label is `alias`, which no sync touches.
  company: ["name", "tally_name"],
  party: ["name", "gstin", "sub_group", "group_chain", "credit_limit", "credit_period", "company_id"],
  // company_id is Tally's too: it is derived from the tenant the item was synced
  // from, and an item cannot move between Tally companies.
  item: ["name", "company_id", "group_id", "unit_id"],
  item_group: ["name"],
  unit: ["name"],
  location: [],
  party_item: [],
};

export const isTallyOwned = (type: CentralMasterType, column: string, source: string): boolean =>
  source === "tally" && TALLY_OWNED_FIELDS[type].includes(column);

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export interface MasterPatch {
  [column: string]: unknown;
}

/**
 * Updates one master row.
 *
 * Tally-owned columns are DROPPED, not rejected: the Excel round trip re-submits
 * every column it exported, so refusing the whole write would make importing a
 * file that merely contains a name column impossible. Dropping keeps the
 * import useful and the guarantee intact.
 */
export async function updateMaster(
  type: CentralMasterType,
  id: string,
  patch: MasterPatch,
  source: string = "portal",
): Promise<void> {
  const fields: MasterPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (isTallyOwned(type, key, source)) continue;
    fields[key] = value;
  }
  if (Object.keys(fields).length === 0) return;
  const { error } = await db.from(MASTER_TABLE[type]).update(fields).eq("id", id);
  fail(error);
}

/** Creates a master row. Always source 'portal' — only the sync writes 'tally'. */
export async function insertMaster(type: CentralMasterType, values: MasterPatch): Promise<string> {
  const { data, error } = await db
    .from(MASTER_TABLE[type])
    .insert({ ...values, source: "portal" })
    .select("id")
    .single();
  fail(error);
  return data.id as string;
}

export async function setMasterActive(type: CentralMasterType, id: string, active: boolean): Promise<void> {
  const { error } = await db.from(MASTER_TABLE[type]).update({ active }).eq("id", id);
  fail(error);
}

/**
 * Sets which modules offer this row.
 *
 * THE SINGLE MOST IMPORTANT WRITE ON THIS SCREEN. Tally holds ~7,800 ledgers and
 * ~14,200 stock items; Order to Dispatch offers a few hundred of each. This tick
 * is the whole difference between a usable picker and an unusable one, and the
 * sync never overwrites it.
 */
export async function setMasterModules(
  type: CentralMasterType,
  ids: string[],
  modules: string[],
): Promise<void> {
  if (ids.length === 0) return;
  // Chunked: `in` builds a URL, and a few thousand uuids exceeds what the
  // gateway will accept as a query string.
  const SIZE = 200;
  for (let i = 0; i < ids.length; i += SIZE) {
    const { error } = await db
      .from(MASTER_TABLE[type])
      .update({ modules })
      .in("id", ids.slice(i, i + SIZE));
    fail(error);
  }
}

/**
 * Runs the Tally sync now, as the signed-in admin.
 *
 * The Edge Function is the only writer of Tally-sourced rows: it reads the
 * ConnectWave mirror with that project's own key and writes here with the
 * service role. The browser never touches the mirror for this.
 *
 * `force` skips the watermark check. Offered because the mirror's watermark does
 * not move for every change — see 20260902120400 for the measurement.
 */
export async function runMastersSync(force = false): Promise<{
  skipped?: boolean;
  watermark?: string | null;
  counts?: Record<string, number>;
  reason?: string;
}> {
  const { data, error } = await supabase.functions.invoke("masters-sync", {
    body: { trigger: "manual", force },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(String(data.error));
  return data ?? {};
}
