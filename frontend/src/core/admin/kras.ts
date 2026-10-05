/**
 * KRA Details — each employee's KRAs and their weight, read and written straight against
 * `public.org_kras` (20270106120000). RLS is the gate: everyone reads, admins write.
 *
 * Designation and department are NOT here — they are the employee's profile values, looked
 * up on screen, so a promotion or a team move never leaves a stale copy behind.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/core/platform/supabase";

/**
 * The generated `Database` type knows nothing about `org_kras` until types are regenerated
 * from the live schema. One untyped handle keeps the escape hatch in one place.
 */
const db = supabase as unknown as SupabaseClient;

/**
 * LOCAL TEST MODE — on localhost (`npm run dev`) the KRAs are kept in this browser, not in
 * the database. The local app talks to the LIVE database, where `org_kras` does not exist
 * until the migration is run, and test rows must not land there anyway. Every deployed
 * build has `DEV` false and reads/writes `org_kras` as normal.
 */
export const LOCAL_TEST = import.meta.env.DEV;
const LOCAL_KEY = "org-kras:local-test:v1";

export const KRAS_QUERY_KEY = ["org-kras"] as const;

export interface Kra {
  id: string;
  profileId: string;
  /** The KRA text. `name` for the MasterCrud contract. */
  name: string;
  /** Wt% — this KRA's share of the employee's 100. */
  weight: number;
  active: boolean;
  sortOrder: number;
}

export interface KraInput {
  profileId: string;
  name: string;
  weight: number;
  active: boolean;
}

interface Row {
  id: string;
  profile_id: string;
  name: string;
  weight: number | string;
  active: boolean;
  sort_order: number;
}

const fromRow = (r: Row): Kra => ({
  id: r.id,
  profileId: r.profile_id,
  name: r.name,
  // numeric comes back from PostgREST as a string.
  weight: Number(r.weight) || 0,
  active: r.active,
  sortOrder: r.sort_order,
});

const readLocal = (): Row[] => {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    return Array.isArray(v) ? (v as Row[]) : [];
  } catch {
    return [];
  }
};
const writeLocal = (rows: Row[]) => localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));

export async function fetchKras(): Promise<Kra[]> {
  if (LOCAL_TEST) return readLocal().map(fromRow);
  const { data, error } = await db
    .from("org_kras")
    .select("id,profile_id,name,weight,active,sort_order")
    .order("profile_id")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(fromRow);
}

/** Whether a Wt% is usable, or why not. */
export function weightProblem(raw: string): string | null {
  const s = raw.trim().replace(/%$/, "");
  if (!s) return "Wt% is required.";
  const n = Number(s);
  if (!Number.isFinite(n)) return `Wt% "${raw}" is not a number.`;
  if (n < 0 || n > 100) return "Wt% must be between 0 and 100.";
  return null;
}

/** "45", "45%", " 2.5 " → number. Call after `weightProblem` has passed. */
export const parseWeight = (raw: string) => Math.round(Number(raw.trim().replace(/%$/, "")) * 100) / 100;

/**
 * Insert (null id) or update one KRA. A new row goes to the end of that employee's list,
 * so an imported sheet keeps the order it was written in.
 */
export async function saveKra(id: string | null, input: KraInput, userId: string): Promise<void> {
  const name = input.name.trim();
  if (LOCAL_TEST) {
    const rows = readLocal();
    if (rows.some((r) => r.id !== id && r.profile_id === input.profileId && r.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`"${name}" is already a KRA for this employee.`);
    }
    if (id) {
      writeLocal(rows.map((r) => (r.id === id ? { ...r, profile_id: input.profileId, name, weight: input.weight, active: input.active } : r)));
    } else {
      const sort = Math.max(0, ...rows.filter((r) => r.profile_id === input.profileId).map((r) => r.sort_order)) + 10;
      writeLocal([...rows, { id: crypto.randomUUID(), profile_id: input.profileId, name, weight: input.weight, active: input.active, sort_order: sort }]);
    }
    return;
  }

  const row = { profile_id: input.profileId, name, weight: input.weight, active: input.active };
  if (id) {
    const { error } = await db.from("org_kras").update(row).eq("id", id);
    if (error) throw new Error(friendly(error.message, name));
    return;
  }
  const { data: last } = await db
    .from("org_kras")
    .select("sort_order")
    .eq("profile_id", input.profileId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const sort = (((last ?? []) as { sort_order: number }[])[0]?.sort_order ?? 0) + 10;
  const { error } = await db.from("org_kras").insert({ ...row, sort_order: sort, created_by: userId });
  if (error) throw new Error(friendly(error.message, name));
}

const friendly = (msg: string, name: string) =>
  /duplicate key|unique/i.test(msg) ? `"${name}" is already a KRA for this employee.` : msg;
