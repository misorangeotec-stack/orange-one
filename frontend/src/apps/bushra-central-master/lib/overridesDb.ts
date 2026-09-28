import { supabase } from "@/core/platform/supabase";
import type { MirrorOverride, OverrideMap } from "./store";

/**
 * THE SHARED STORE — Bushra Central Master's overrides, read and written on the server.
 *
 * Until 24-09-2026 every value typed into this app's grid lived in one person's
 * localStorage and was seen by nobody else. It is now one shared set of values in
 * `bushra_central_master_overrides` (migration 20261212120000), so what anyone saves,
 * everyone reads.
 *
 * ⚠ AN OVERLAY, NOT AN EDIT TO CENTRAL. `mst_items` is still never written. A row here
 *   holds only the fields that DISAGREE with what Central and Tally say, so the moment
 *   a field is absent it goes back to following its source.
 *
 * ⚠ READS PAGE, WRITES CHUNK, for the same reason `liveMasters.ts` does both. PostgREST
 *   caps a response at 1000 rows SILENTLY: a plain select would return exactly 1000
 *   overrides and no error, which looks like a working screen with everyone else's work
 *   quietly missing. A single upsert of thousands of rows is the mirror-image problem —
 *   one statement long enough to time out, leaving a half-applied save.
 *
 * ⚠ WRITES ARE WHOLE-ROW. `nextOverride` in store.ts has already folded the edit into
 *   what was stored, so the object handed here is the complete intended state of that
 *   item. Two people editing the SAME item resolve last-save-wins; different items never
 *   contend. The RLS policy — not this file — is what actually enforces who may write.
 */

/** The table is not in the generated Database types, so calls route through an untyped alias — the standing FMS convention. */
const db = supabase as any;

const TABLE = "bushra_central_master_overrides";
const PAGE = 1000;
/** Rows per write. Comfortably under the statement timeout, and few enough round trips. */
const CHUNK = 500;

interface Row {
  item_id: string;
  fields: unknown;
}

/**
 * Every override there is.
 *
 * Throws rather than returning an empty map when the read fails: an empty map means
 * "nobody has changed anything", and a failed read means "we do not know what anyone
 * changed". Treating the second as the first would show a grid of Central's values as
 * though the team's work had been wiped — and then let someone save over it.
 */
export async function fetchOverrides(clean: (v: unknown) => MirrorOverride | null | undefined): Promise<OverrideMap> {
  const out: OverrideMap = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(TABLE)
      .select("item_id,fields")
      // A TOTAL order. PostgREST pages by offset, so rows left tied can swap between
      // pages — dropping one and repeating another. item_id is unique, so it suffices.
      .order("item_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Row[];
    for (const r of rows) {
      // A row of the wrong shape is DROPPED, not thrown on. One bad row written by an
      // older client would otherwise take the whole grid down for everybody at once.
      const o = clean(r.fields);
      if (o) out[r.item_id] = o;
    }
    if (rows.length < PAGE) return out;
  }
}

/** Write these items' overrides, replacing whatever each row held. */
export async function upsertOverrides(entries: [string, MirrorOverride][], userId: string): Promise<void> {
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK).map(([item_id, fields]) => ({
      item_id,
      fields,
      updated_by: userId,
    }));
    const { error } = await db.from(TABLE).upsert(chunk, { onConflict: "item_id" });
    if (error) throw new Error(error.message);
  }
}

/** Drop these items' overrides, so each goes back to following Central and Tally. */
export async function deleteOverrides(itemIds: string[]): Promise<void> {
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const { error } = await db.from(TABLE).delete().in("item_id", itemIds.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
  }
}

/**
 * Drop EVERY override — the whole team's, not one person's, which is why the caller
 * confirms first. `not("item_id", "is", null)` is how PostgREST is told "all rows":
 * a delete with no filter is refused outright, exactly so this cannot be a slip.
 */
export async function deleteAllOverrides(): Promise<void> {
  const { error } = await db.from(TABLE).delete().not("item_id", "is", null);
  if (error) throw new Error(error.message);
}

/** The item ids that already carry an override — what adoption checks before writing. */
export async function fetchOverrideIds(): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(TABLE)
      .select("item_id")
      .order("item_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { item_id: string }[];
    for (const r of rows) out.add(r.item_id);
    if (rows.length < PAGE) return out;
  }
}
