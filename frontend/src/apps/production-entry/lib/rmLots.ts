import { filledLots, rowsFrom, type LotRow } from "@/apps/order-to-dispatch/components/LotAllocField";
import type { LotOption } from "@/apps/order-to-dispatch/data/lotFetch";
import { useLotsForItems } from "@/apps/order-to-dispatch/lib/lotPicker";
import { PRODUCTION_COMPANY_GUID, PRODUCTION_COMPANY_LABEL } from "@/apps/receivables-hub/lib/batchCosting";

/**
 * Issue lots at Material Handover, picked from Tally's stock — the same picker
 * Order to Dispatch uses at Check Material Status (LotAllocField).
 *
 * The lot used to be typed by hand. Now the raw material's lots with stock left
 * come from ConnectWave, each with its balance; one or several can be picked,
 * with a quantity against each when there is more than one. Typing a lot Tally
 * does not show is still allowed, and an unreachable ConnectWave leaves the plain
 * typed box — the same rules as dispatch.
 *
 * ⚠ ONE BOOK: production is booked only in Enterprises Surat, so lots are read
 *   from that company alone (PRODUCTION_COMPANY_GUID, shared with Batch Costing).
 *
 * ⚠ The raw material is looked up in Tally BY NAME. A name that differs from the
 *   Tally item simply finds no lots, and the box falls back to typing.
 */

/** Batch "Any" is what Tally puts on purchase orders and proforma lines — ordered, not received. */
const isRealLot = (l: LotOption) => l.batchName.trim().toLowerCase() !== "any";

/** Tally's lots per raw-material name, for the Enterprises Surat book. */
export function useRmLots(itemNames: string[]): Record<string, LotOption[]> {
  const raw = useLotsForItems(itemNames, PRODUCTION_COMPANY_GUID);
  const out: Record<string, LotOption[]> = {};
  for (const [name, lots] of Object.entries(raw)) out[name] = lots.filter(isRealLot);
  return out;
}

/** Only one book is ever read, so a lot's book always has this name. */
export const rmBookOf = (): string => PRODUCTION_COMPANY_LABEL;

/**
 * The flat `lot_no` every other screen reads (log book, issue slip, exports).
 * One lot as picked; several as "A (60) / B (40)", the quantity left off when
 * none was given.
 */
export function flatLotNo(rows: LotRow[]): string {
  const picked = filledLots(rows);
  if (picked.length <= 1) return picked[0]?.lot_no.trim() ?? "";
  return picked.map((r) => (r.qty.trim() ? `${r.lot_no.trim()} (${r.qty.trim()})` : r.lot_no.trim())).join(" / ");
}

/**
 * The `lots` array saved on the handover line, each with the quantity shown in
 * its box (a lone lot with an empty box takes the line's handover quantity).
 */
export function lotsPayload(rows: LotRow[], lineQty: string) {
  const picked = filledLots(rows);
  return picked.map((r, i) => ({
    lot_no: r.lot_no.trim(),
    qty: r.qty.trim() || (picked.length === 1 ? lineQty.trim() : ""),
    seq: i,
  }));
}

/**
 * Seed the editor from a saved line. Unlike dispatch, a single lot SHOWS its
 * quantity (the box is always drawn here), so `rowsFrom`'s blank is filled back:
 * from the lot's own saved figure, else the line's — marked `seeded` when it is
 * the line's, so it keeps following the handover qty.
 */
export function handoverLotRows(
  lots: { lotNo: string; qty: number | null; seq: number }[] | undefined,
  flat: string | null,
  lineQty: string,
): LotRow[] {
  const rows = rowsFrom(lots, flat);
  const picked = filledLots(rows);
  if (picked.length !== 1 || picked[0]!.qty.trim() !== "") return rows;
  const own = lots && lots.length === 1 && lots[0]!.qty !== null ? String(lots[0]!.qty) : "";
  if (own && own !== lineQty.trim()) return [{ lot_no: picked[0]!.lot_no, qty: own }];
  return lineQty.trim() ? [{ lot_no: picked[0]!.lot_no, qty: lineQty.trim(), seeded: true }] : rows;
}

/**
 * Why a handover row cannot be saved, or null. Once any lot is picked, the lot
 * quantities must add up to the handover qty.
 */
export function lotSplitError(rows: LotRow[], lineQty: string): string | null {
  const picked = filledLots(rows);
  if (picked.length === 0) return null;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const sum = r3(picked.reduce((a, r) => a + (Number(r.qty) || 0), 0));
  const want = r3(Number(lineQty) || 0);
  if (picked.some((r) => r.qty.trim() === "")) return "enter the quantity against each lot";
  return sum === want ? null : `the lot quantities add up to ${sum}, but the handover qty is ${want}`;
}
