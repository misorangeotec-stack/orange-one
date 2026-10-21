import { filledLots, type LotRow } from "@/apps/order-to-dispatch/components/LotAllocField";
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
 * The `lots` array saved on the handover line. A single lot carries the line's
 * whole handover quantity; several carry what was typed against each.
 */
export function lotsPayload(rows: LotRow[], lineQty: string) {
  const picked = filledLots(rows);
  return picked.map((r, i) => ({
    lot_no: r.lot_no.trim(),
    qty: picked.length === 1 ? lineQty.trim() : r.qty.trim(),
    seq: i,
  }));
}
