/**
 * SHARED LAYOUT — an admin sizes a screen once, and everyone opens on it. Every FMS, every report.
 *
 * Every reader-set size in the hub already lives in localStorage, under a handful of key families
 * (ResizeGrip / ResizeKit sizes, useColumnWidths and QueueTable widths, the Columns pickers, the
 * Ink / RM IMS tables and charts, the Ink Expiry tables, the Sales dashboards' open sections). So
 * the layout IS those keys: an admin's Save copies them to hub_shared_layouts (migration
 * 20270118120000, row `all`), and the gate (SharedLayoutGate.tsx) writes them back before any page
 * mounts.
 *
 * WHO KEEPS WHAT (the user's rule, 21-10-2026)
 *   - Everyone can drag. A drag holds while you move around the hub.
 *   - A viewer's drags are for that visit only: every page load (refresh, new tab, next login)
 *     puts the admin's saved layout back.
 *   - An admin's own drags stay in their browser until they press "Save layout for everyone" —
 *     that is how they build the layout. A newer save by another admin replaces them.
 *
 * The first version (10-10-2026) covered only the Bushra pages, in the row `bushra`; it is read
 * as the fallback until an admin saves the `all` row, which then carries those keys too.
 */
import { supabase } from "@/core/platform/supabase";

// Not in the generated database types until they are regenerated after the migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const TABLE = "hub_shared_layouts";
const ALL = "all";
const LEGACY = "bushra";
const STAMP = `orangeone.sharedLayout.${ALL}.applied`;

/** Key families that are a screen's layout. Data filters, drafts and caches are never in here. */
const PREFIXES = [
  "orangeone.size.",               // ResizeGrip, ResizeKit panels / bars / tables
  "orangeone.table.widths.",       // useColumnWidths, QueueTable
  "orangeone.table.cols.",         // QueueTable column picker
  "orangeone.cols.",               // Bushra column pickers
  "bushra-sales:section:",         // Sales dashboards' open sections
  "bushra-central-master:colwidths:",
  "ink-mis:cols:", "rm-mis:cols:",  // IMS tables: widths, order, hidden
  "ink-expiry:table:",             // Ink Expiry tables: widths, hidden, row heights
];
const EXACT = new Set([
  "ink-mis:chart-panel-height", "ink-mis:chart-label-width", "ink-mis:row-pad", "ink-mis:head-pad",
  "ink-mis:freeze", "ink-mis:hidden-lines",
  "rm-mis:chart-panel-height", "rm-mis:chart-label-width", "rm-mis:row-pad", "rm-mis:head-pad",
  "rm-mis:freeze", "rm-mis:hidden-lines",
  "riskRegister.visibleColumns.v2",
  "orangeone.nav.width",            // the left menu's width (which groups are open stays personal)
]);
/** A localStorage key that is part of a screen's layout. */
export const isLayoutKey = (k: string) => EXACT.has(k) || PREFIXES.some((p) => k.startsWith(p));

export interface SharedLayout { entries: Record<string, string>; updatedAt: string; ready: boolean }

const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === "PGRST205" || e.code === "42P01" || /could not find the table|does not exist/i.test(e.message ?? "");

/** The saved layout: the `all` row, or the older Bushra-only row while `all` has never been saved. */
export async function loadSharedLayout(): Promise<SharedLayout> {
  const { data, error } = await db.from(TABLE).select("id,entries,updated_at").in("id", [ALL, LEGACY]);
  if (error) {
    if (isMissingTable(error)) return { entries: {}, updatedAt: "", ready: false };
    throw new Error(error.message);
  }
  const rows = (data ?? []) as { id: string; entries: Record<string, string> | null; updated_at: string }[];
  const row = rows.find((r) => r.id === ALL) ?? rows.find((r) => r.id === LEGACY);
  return { entries: row?.entries ?? {}, updatedAt: row?.updated_at ?? "", ready: true };
}

function myLayoutKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isLayoutKey(k)) out.push(k);
  }
  return out;
}

/**
 * Writes the saved layout into this browser: this browser's own layout keys are cleared first, so
 * the screens open exactly as the admin left them (and a column the admin never touched opens at
 * its default). An admin's browser is written only once per save, so their unsaved work survives a
 * refresh; a viewer's is written on every page load. Returns true when something was written.
 */
export function applySharedLayout(layout: SharedLayout, isAdmin: boolean): boolean {
  // Nothing saved yet: everyone keeps their own sizes until an admin's first Save.
  if (!layout.ready || !layout.updatedAt) return false;
  try {
    if (isAdmin && localStorage.getItem(STAMP) === layout.updatedAt) return false;
    for (const k of myLayoutKeys()) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(layout.entries)) if (isLayoutKey(k) && typeof v === "string") localStorage.setItem(k, v);
    localStorage.setItem(STAMP, layout.updatedAt);
  } catch {
    return false; // private window / blocked storage — the default sizes still work
  }
  // Stores that cache what they read (useColumnWidths) listen for this and re-read.
  try { window.dispatchEvent(new StorageEvent("storage", { key: null })); } catch { /* old browser */ }
  return true;
}

/** This browser's layout keys — what an admin's Save sends. */
export function collectLayout(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const k of myLayoutKeys()) out[k] = localStorage.getItem(k) ?? "";
  } catch { /* nothing to send */ }
  return out;
}

/**
 * Saves this browser's layout as everyone's. Admin only (RLS enforces it).
 *
 * If another admin saved after this browser last took the layout, theirs is kept underneath and
 * this browser's keys go on top — one admin sizing Purchase does not wipe another's Sales.
 */
export async function saveSharedLayout(userId: string): Promise<{ keys: number; updatedAt: string; entries: Record<string, string> }> {
  const mine = collectLayout();
  let entries = mine;
  const latest = await loadSharedLayout().catch(() => null);
  let applied = "";
  try { applied = localStorage.getItem(STAMP) ?? ""; } catch { /* treat as not applied */ }
  if (latest?.updatedAt && latest.updatedAt !== applied) entries = { ...latest.entries, ...mine };

  const { data, error } = await db.from(TABLE)
    .upsert({ id: ALL, entries, updated_by: userId }, { onConflict: "id" })
    .select("updated_at").single();
  if (error) {
    if (isMissingTable(error)) throw new Error("The shared-layout table is not in the database yet — migration 20270118120000 has to be run first.");
    throw new Error(error.message);
  }
  // This browser already holds the layout; mark it applied so it is not re-written.
  try {
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    localStorage.setItem(STAMP, data.updated_at);
  } catch { /* fine */ }
  return { keys: Object.keys(entries).length, updatedAt: data.updated_at, entries };
}
