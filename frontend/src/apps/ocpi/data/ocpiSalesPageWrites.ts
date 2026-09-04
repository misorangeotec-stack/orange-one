import { supabase } from "@/core/platform/supabase";
import type { SalesPageBlock } from "../types";
const db = supabase as any;

/**
 * Writes for the sales pages — page 2 of a machine's Performa Invoice.
 *
 * ⚠ NOT AN RPC, unlike the deal workflow. `fms_ocpi_sales_pages` carries a real
 *   write policy (admin, or the machine master's owner), mirroring
 *   `fms_ocpi_machines` — so the TABLE is the boundary and a definer function
 *   would only be a second thing to keep in step with it. Same reasoning as
 *   `setConfig` in ocpiWrites.ts.
 *
 * ⚠ THESE PAGES ARE TRANSCRIPTIONS, NOT COPY SOMEBODY WROTE HERE. All twelve
 *   were lifted verbatim from PIs real customers have already been sent. Editing
 *   one changes what FUTURE invoices say and nothing else — an issued PI is
 *   frozen on its version row like every other paper in this module.
 */

export interface SalesPageInput {
  /** The FAMILY label, for the picker: "Alpha II", "Homer K24". */
  name: string;
  /**
   * The heading exactly as the paper prints it.
   *
   * ⚠ STORED, NEVER DERIVED. Eight of the twelve real pages read "Key Benefits
   *   of …" and four read "Advantages of …". There is no rule that produces
   *   both, and assuming there was is what made the first sweep of this work
   *   miss Pengda, Alpha 15 and Fab Pro entirely.
   */
  heading: string;
  blocks: SalesPageBlock[];
  active: boolean;
  sortOrder: number;
}

const toRow = (p: SalesPageInput) => ({
  name: p.name.trim(),
  heading: p.heading.trim(),
  // Empty blocks are dropped rather than stored: a bullet with no text prints as
  // a bullet with no text, on a customer's invoice.
  blocks: p.blocks.filter((b) => b.text.trim() !== "").map((b) => ({ kind: b.kind, text: b.text })),
  active: p.active,
  sort_order: p.sortOrder,
});

export async function createSalesPage(input: SalesPageInput): Promise<string> {
  const { data, error } = await db
    .from("fms_ocpi_sales_pages")
    .insert(toRow(input))
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateSalesPage(id: string, input: Partial<SalesPageInput>): Promise<void> {
  const full = { ...input } as SalesPageInput;
  const row: Record<string, unknown> = {};
  // Only what the caller actually set — a partial edit must not blank the body
  // it never showed. Same rule as `updateMachine`.
  if (input.name !== undefined) row.name = full.name.trim();
  if (input.heading !== undefined) row.heading = full.heading.trim();
  if (input.blocks !== undefined) row.blocks = toRow(full).blocks;
  if (input.active !== undefined) row.active = full.active;
  if (input.sortOrder !== undefined) row.sort_order = full.sortOrder;

  const { error } = await db.from("fms_ocpi_sales_pages").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Deactivate, never delete.
 *
 * ⚠ MACHINES POINT AT THESE ROWS. Deleting one would either break the foreign
 *   key or, worse, silently strip page 2 from every machine in the family. The
 *   master's standing rule applies here for a concrete reason.
 */
export async function setSalesPageActive(id: string, active: boolean): Promise<void> {
  const { error } = await db.from("fms_ocpi_sales_pages").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}
