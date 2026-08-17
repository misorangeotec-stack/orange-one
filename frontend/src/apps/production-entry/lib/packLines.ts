import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";

/**
 * The packing-material line model + its auto-fill rules.
 *
 * Extracted from StepModal so the SAME grid and the SAME rules serve both places
 * packaging is captured: the Log Book Entry (production cards) and the
 * Repackaging issue slip. A repackaging card records no wastage, so its packed
 * quantity IS its FG quantity — which is what `packQtyFromPrefix` divides by
 * there, exactly as the log book divides by its own Packed Qty.
 *
 * These are the client-side conveniences only. `total` is recomputed SERVER-side
 * by `fms_production_pack_lines()` on every save, so the stored numbers can never
 * drift from what the grid showed.
 */

/** One packing-material row: the picked packaging item (with its own unit), the
 *  base/auto quantity, and an EXTRA quantity (manual for most items; auto-filled
 *  to 7% of qty for CAP items). Line total = qty + extra. Drives the LineGrid. */
export interface PackRow extends LineGridRow {
  packagingItemId: string | null;
  unitId: string | null;
  qty: string;
  extra: string;
}

export const makeEmptyPackRow = (): PackRow => ({ uid: newUid(), packagingItemId: null, unitId: null, qty: "", extra: "" });

// Blank means blank — no default qty here (see LineGrid's trailing-blank invariant).
export const isPackRowBlank = (r: PackRow) => !r.packagingItemId && !(r.qty ?? "").trim() && !(r.extra ?? "").trim();

/** Line total = base qty + extra (no buffer). */
export const packLineTotal = (qty: string, extra: string) => Math.round(((Number(qty) || 0) + (Number(extra) || 0)) * 1000) / 1000;

/** CAP items auto-fill Extra as 7% of the qty, ROUNDED to a whole number (never decimals). */
export const isCapItem = (name: string | undefined) => /\bcap\b/i.test(name ?? "");
export const capExtra = (qty: string) => String(Math.round((Number(qty) || 0) * 0.07));

/** Suggested packaging qty from the item's numeric name PREFIX (its pack size):
 *  FG packed qty ÷ prefix, rounded. e.g. "10 Kg Can" → fgQty/10; "5 Ltr" → fgQty/5.
 *  Blank when there is no numeric prefix or no FG packed qty yet. The user can override. */
export const packQtyFromPrefix = (name: string | undefined, fgPackedQty: string): string => {
  const m = (name ?? "").trim().match(/^(\d+)/);
  const div = m ? Number(m[1]) : 0;
  const fg = Number(fgPackedQty);
  if (!div || !fg || !Number.isFinite(fg)) return "";
  return String(Math.round(fg / div));
};

/** Grand total of a numeric column (sum across all rows, all units). */
export const packGsum = (vals: Array<number | null | undefined>) =>
  Math.round(vals.reduce<number>((a, v) => a + (v ?? 0), 0) * 1000) / 1000;

/** The jsonb element shape both the log book and the repackaging intake send —
 *  read verbatim by `fms_production_pack_lines()`, which recomputes extra/total. */
export const packLinePayload = (rows: PackRow[]) =>
  rows
    .filter((r) => r.packagingItemId)
    .map((r) => ({ packaging_item_id: r.packagingItemId, unit_id: r.unitId, qty: r.qty ?? "", extra: r.extra ?? "" }));
