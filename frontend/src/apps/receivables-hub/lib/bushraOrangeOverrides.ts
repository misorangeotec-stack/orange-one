/**
 * Orange vs Non-Orange — the buckets the business sets by hand (bushra_orange_customer_overrides,
 * migration 20270115120000). No row = the rule in lib/bushraOrangeCustomers.ts decides.
 *
 * Read by everyone who can open the reports; written by admins only (RLS says so, the screen hides
 * the controls from everyone else).
 */
import { supabase } from "@/core/platform/supabase";
import type { Bucket } from "./bushraOrangeCustomers";

const TABLE = "bushra_orange_customer_overrides";
// Not in the generated database types until they are regenerated after the migration — the same
// stance as apps/bushra-central-master/lib/overridesDb.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface BucketOverrides {
  /** Customer Group → the bucket set by hand. */
  byGroup: Map<string, Bucket>;
  /** False when the table is not there yet — the migration has not been run. */
  ready: boolean;
}

/** The table does not exist yet (PostgREST: PGRST205 / 42P01) — the screen says so, not a crash. */
const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === "PGRST205" || e.code === "42P01" || /could not find the table|does not exist/i.test(e.message ?? "");

export async function loadBucketOverrides(): Promise<BucketOverrides> {
  const byGroup = new Map<string, Bucket>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(TABLE)
      .select("customer_group,bucket")
      .order("customer_group", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return { byGroup, ready: false };
      throw new Error(`Orange / Non-Orange settings: ${error.message}`);
    }
    const rows = (data ?? []) as { customer_group: string; bucket: Bucket }[];
    for (const r of rows) byGroup.set(r.customer_group, r.bucket);
    if (rows.length < PAGE) break;
  }
  return { byGroup, ready: true };
}

/**
 * Puts these customers in `bucket`, or hands them back to the rule when `bucket` is null.
 * Batched, so a bulk pick of a few hundred is a handful of requests.
 */
export async function saveBucketOverrides(groups: string[], bucket: Bucket | null, userId: string): Promise<void> {
  const CHUNK = 200;
  for (let i = 0; i < groups.length; i += CHUNK) {
    const part = groups.slice(i, i + CHUNK);
    const { error } = bucket
      ? await db.from(TABLE).upsert(
          part.map((g) => ({ customer_group: g, bucket, updated_by: userId })),
          { onConflict: "customer_group" })
      : await db.from(TABLE).delete().in("customer_group", part);
    if (error) {
      if (isMissingTable(error)) {
        throw new Error("The Orange / Non-Orange table is not in the database yet — migration 20270115120000 has to be run first.");
      }
      throw new Error(error.message);
    }
  }
}
