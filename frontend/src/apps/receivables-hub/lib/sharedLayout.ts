/**
 * SHARED LAYOUT — an admin sizes the Bushra dashboards and reports once, and everyone opens on it.
 *
 * Every reader-set size on these pages already lives in localStorage, under a handful of prefixes
 * (ResizeGrip / ResizeKit sizes, useColumnWidths, the Columns pickers, the Sales dashboards' open
 * sections), and every Bushra page's key names "bushra" (its path or its table id). So the layout IS
 * those keys: an admin's Save copies them to hub_shared_layouts (migration 20270118120000); a
 * viewer's browser writes them back before the page mounts — once per save, so a viewer's own later
 * tweaks hold until the admin saves again.
 */
import { supabase } from "@/core/platform/supabase";

// Not in the generated database types until they are regenerated after the migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const TABLE = "hub_shared_layouts";
export const BUSHRA_LAYOUT = "bushra";
const STAMP = (id: string) => `orangeone.sharedLayout.${id}.applied`;

const PREFIXES = ["orangeone.size.", "orangeone.table.widths.", "orangeone.cols.", "bushra-sales:section:"];
/** A localStorage key that is part of the Bushra pages' layout. */
export const isLayoutKey = (k: string) => PREFIXES.some((p) => k.startsWith(p)) && /bushra/i.test(k);

export interface SharedLayout { entries: Record<string, string>; updatedAt: string; ready: boolean }

const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === "PGRST205" || e.code === "42P01" || /could not find the table|does not exist/i.test(e.message ?? "");

export async function loadSharedLayout(id = BUSHRA_LAYOUT): Promise<SharedLayout> {
  const { data, error } = await db.from(TABLE).select("entries,updated_at").eq("id", id).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { entries: {}, updatedAt: "", ready: false };
    throw new Error(error.message);
  }
  return { entries: (data?.entries ?? {}) as Record<string, string>, updatedAt: data?.updated_at ?? "", ready: true };
}

/**
 * Writes a saved layout into this browser, unless this exact save is already in it. The viewer's
 * own Bushra layout keys are cleared first, so the page opens exactly as the admin left it.
 * Returns true when something changed.
 */
export function applySharedLayout(layout: SharedLayout, id = BUSHRA_LAYOUT): boolean {
  if (!layout.updatedAt) return false;
  try {
    if (localStorage.getItem(STAMP(id)) === layout.updatedAt) return false;
    const mine: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isLayoutKey(k)) mine.push(k);
    }
    for (const k of mine) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(layout.entries)) if (isLayoutKey(k) && typeof v === "string") localStorage.setItem(k, v);
    localStorage.setItem(STAMP(id), layout.updatedAt);
  } catch {
    return false; // private window / blocked storage — the default sizes still work
  }
  // Stores that cache what they read (useColumnWidths) listen for this and re-read.
  try { window.dispatchEvent(new StorageEvent("storage", { key: null })); } catch { /* old browser */ }
  return true;
}

/** This browser's Bushra layout keys — what an admin's Save sends. */
export function collectLayout(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && isLayoutKey(k)) out[k] = localStorage.getItem(k) ?? "";
    }
  } catch { /* nothing to send */ }
  return out;
}

/** Saves this browser's layout as everyone's. Admin only (RLS enforces it). */
export async function saveSharedLayout(userId: string, id = BUSHRA_LAYOUT): Promise<{ keys: number; updatedAt: string }> {
  const entries = collectLayout();
  const { data, error } = await db.from(TABLE)
    .upsert({ id, entries, updated_by: userId }, { onConflict: "id" })
    .select("updated_at").single();
  if (error) {
    if (isMissingTable(error)) throw new Error("The shared-layout table is not in the database yet — migration 20270118120000 has to be run first.");
    throw new Error(error.message);
  }
  // The admin's own browser already holds this layout; mark it applied so it is not re-written.
  try { localStorage.setItem(STAMP(id), data.updated_at); } catch { /* fine */ }
  return { keys: Object.keys(entries).length, updatedAt: data.updated_at };
}
