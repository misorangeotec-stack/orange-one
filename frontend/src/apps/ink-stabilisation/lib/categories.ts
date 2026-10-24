import { supabase } from "@/core/platform/supabase";
import { NOT_CATEGORISED, SURAT_GUID } from "./constants";

export { NOT_CATEGORISED };

// Neither table is in the generated Database type — the standing FMS convention.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * WHICH CATEGORY IS AN INK IN — taken from BUSHRA CENTRAL MASTER, as the user asked
 * (28-09-2026): main Central Masters is filled from Tally and cannot be edited, so the
 * user keeps categories in Bushra Central Master instead.
 *
 * Bushra Central Master is an OVERLAY on `mst_items`, and this reads it the same way that
 * app does (apps/bushra-central-master/lib/store.ts, centralValue + overrides):
 *
 *   ink type = the override's `inkType`  IF the override has that key (even if null —
 *                                          a deliberately cleared value stays cleared)
 *            = else `mst_items.ink_type`  (what Central / Tally says)
 *
 * The Ink type is the tab ("KY REACTIVE PRO", "EP SUBLIMATION HD", …); the broader
 * Category ("REACTIVE INK", "SUBLIMATION INK") is carried alongside for display.
 *
 * ⚠ JOINED ON (COMPANY, ITEM NAME). mst_items.name is Tally's own item name verbatim,
 *   the same string rpt_batch_line carries, so the match is exact. Only Enterprises
 *   Surat's items are read — the same ink is a separate item in every book.
 *
 * ⚠ A READER WITHOUT A BUSHRA CENTRAL MASTER GRANT gets no override rows (RLS), and so
 *   sees Central Masters' values. That is a degraded view, not an error; the page says so.
 */


export type CategorySource = "bushra" | "central" | "missing";

export interface ItemCategory {
  inkType: string | null;
  category: string | null;
  /** Where the ink type came from — or "missing" when neither has one. */
  source: CategorySource;
  /** False when Central Masters has no item of this name for Enterprises Surat at all. */
  inMaster: boolean;
}

export interface CategoryMap {
  byItem: Map<string, ItemCategory>;
  /** How many Bushra Central Master overrides were readable (0 = none saved, or no grant). */
  overridesRead: number;
}

const BASE_TENANT = `acct_orange::${SURAT_GUID}`;

interface ItemRow { id: string; name: string; tally_tenant: string; category: string | null; ink_type: string | null }
interface OverrideRow { item_id: string; fields: Record<string, unknown> | null }

async function readAll<T>(build: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, soft = false): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await build(off, off + 999);
    if (error) {
      if (soft) return out;
      throw new Error(error.message);
    }
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function fetchItemCategories(): Promise<CategoryMap> {
  const [items, overrides] = await Promise.all([
    readAll<ItemRow>((a, b) => db.from("mst_items")
      .select("id,name,tally_tenant,category,ink_type")
      .like("tally_tenant", `${BASE_TENANT}%`)
      .order("id").range(a, b)),
    // Soft: no grant on Bushra Central Master means no rows, not a broken page.
    readAll<OverrideRow>((a, b) => db.from("bushra_central_master_overrides")
      .select("item_id,fields").order("item_id").range(a, b), true),
  ]);

  const ov = new Map(overrides.map((o) => [o.item_id, o.fields ?? {}]));
  const byItem = new Map<string, ItemCategory>();
  // The live book wins over an older-year snapshot carrying the same name.
  for (const it of [...items].sort((x, y) => Number(x.tally_tenant === BASE_TENANT) - Number(y.tally_tenant === BASE_TENANT))) {
    const o = ov.get(it.id) ?? {};
    const hasInk = "inkType" in o;
    const inkType = hasInk ? clean(o.inkType) : clean(it.ink_type);
    const category = "category" in o ? clean(o.category) : clean(it.category);
    byItem.set(it.name, {
      inkType, category, inMaster: true,
      source: inkType === null ? "missing" : hasInk ? "bushra" : "central",
    });
  }
  return { byItem, overridesRead: overrides.length };
}

export function categoryFor(map: CategoryMap | undefined, item: string): ItemCategory {
  return map?.byItem.get(item) ?? { inkType: null, category: null, source: "missing", inMaster: false };
}
