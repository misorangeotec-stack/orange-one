import { useEffect, useState } from "react";
import { supabase } from "@/core/platform/supabase";
import { getConnectwave, hasConnectwave } from "@/core/platform/connectwave";
import { tallyDate } from "@/apps/ink-expiry/lib/expiry";

const db = supabase as any;

/**
 * A lot's EXPIRY DATE, for the gate pass and for Check Material Status.
 *
 * TALLY FIRST. `rpt_batch_line.batch_expiry_raw` is what Tally holds ('8-Dec-26').
 * Tally carries one on only a small share of lots, so the store keeper may type the
 * rest at Check Material Status; those live in `fms_dispatch_lot_expiry`, keyed by
 * ITEM + LOT (an expiry belongs to the lot, not to one shipment of it).
 *
 * ⚠ TALLY WINS when both exist. A typed date only fills a gap.
 *
 * ⚠ NEVER BLOCKS. Both reads swallow their errors and come back empty: a gate pass
 *   without an expiry still prints, and Material Status still records.
 */

export const lotKey = (lot: string): string => lot.trim().toLowerCase();
/** Map key for one item's lot. NUL-joined — item names contain spaces and commas. */
export const expiryKey = (item: string, lot: string): string => `${item}\u0000${lotKey(lot)}`;

// 'Primary Batch' is Tally's placeholder for "no lot", never a real one.
const isRealLot = (lot: string) => lot.trim() !== "" && lotKey(lot) !== "primary batch";

interface TallyRow {
  company_guid: string;
  vch_date: string;
  stock_item: string;
  batch_name: string;
  batch_expiry_raw: string;
}

/**
 * Tally's expiry per (item NAME, lot), ISO dates, keyed by `expiryKey(itemName, lot)`.
 *
 * Match order, best first: same item in the order's own book → same item in any
 * book → same lot number in the order's book → same lot number anywhere. The last
 * two exist because a lot made at Ent Surat is booked under a different ink name at
 * Otec; they apply only to lot numbers of 6+ characters, so a short "1725" can never
 * borrow another item's date. Within a tier the latest voucher wins.
 */
export async function fetchTallyExpiries(
  wanted: { item: string; lot: string }[],
  companyGuid: string | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const lots = [...new Set(wanted.filter((w) => isRealLot(w.lot)).map((w) => w.lot.trim()))];
  if (!hasConnectwave() || lots.length === 0) return out;
  try {
    const { data, error } = await getConnectwave()
      .from("rpt_batch_line")
      .select("company_guid,vch_date,stock_item,batch_name,batch_expiry_raw")
      .in("batch_name", lots)
      .not("batch_expiry_raw", "is", null)
      .limit(2000);
    if (error) {
      console.warn("[lotExpiry] ConnectWave rejected the expiry lookup:", error.message);
      return out;
    }
    const rows = (data ?? []) as TallyRow[];
    for (const w of wanted) {
      if (!isRealLot(w.lot)) continue;
      const k = lotKey(w.lot);
      const item = w.item.trim().toLowerCase();
      let best: { score: number; date: string; iso: string } | null = null;
      for (const r of rows) {
        if (lotKey(r.batch_name ?? "") !== k) continue;
        const iso = tallyDate(r.batch_expiry_raw);
        if (!iso) continue;
        const sameItem = (r.stock_item ?? "").trim().toLowerCase() === item;
        if (!sameItem && k.length < 6) continue;
        const score = (sameItem ? 2 : 0) + (companyGuid && r.company_guid === companyGuid ? 1 : 0);
        if (!best || score > best.score || (score === best.score && r.vch_date > best.date)) {
          best = { score, date: r.vch_date, iso };
        }
      }
      if (best) out.set(expiryKey(w.item, w.lot), best.iso);
    }
  } catch (e) {
    console.warn("[lotExpiry] expiry lookup failed, printing without Tally expiry:", e);
  }
  return out;
}

/**
 * Expiries the store keeper typed, keyed by `expiryKey(itemId, lot)`.
 *
 * `available` is false when the table cannot be read — the migration not yet
 * applied — and Material Status then hides the date box rather than offering one
 * that cannot save.
 */
export async function fetchTypedExpiries(
  itemIds: string[],
): Promise<{ available: boolean; map: Map<string, string> }> {
  const map = new Map<string, string>();
  const ids = [...new Set(itemIds.filter(Boolean))];
  try {
    let q = db.from("fms_dispatch_lot_expiry").select("item_id,lot_no,expiry_date");
    // Even with no items, ask once — it is how we learn whether the table exists.
    q = ids.length ? q.in("item_id", ids) : q.limit(1);
    const { data, error } = await q;
    if (error) return { available: false, map };
    for (const r of (data ?? []) as { item_id: string; lot_no: string; expiry_date: string }[]) {
      map.set(expiryKey(r.item_id, r.lot_no), r.expiry_date);
    }
    return { available: true, map };
  } catch {
    return { available: false, map };
  }
}

/** Save or clear typed expiries for one order's lots. `expiry` '' clears. */
export async function saveLotExpiries(
  orderId: string,
  rows: { itemId: string; lotNo: string; expiry: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.rpc("fms_dispatch_set_lot_expiry", {
    p_order: orderId,
    p_rows: rows.map((r) => ({ item_id: r.itemId, lot_no: r.lotNo.trim(), expiry: r.expiry || null })),
  });
  if (error) throw new Error(`The lot expiry could not be saved: ${error.message}`);
}

/**
 * Both sources for a set of item lots, for a screen.
 *
 * Refetches Tally only when the set of (item, lot) pairs changes — joined into a
 * string because useEffect compares deps by identity (same trick as lotPicker).
 */
export function useLotExpiries(
  wanted: { itemId: string; itemName: string; lot: string }[],
  companyGuid: string | null,
) {
  const [tally, setTally] = useState<Map<string, string>>(new Map());
  const [typed, setTyped] = useState<{ available: boolean; map: Map<string, string> }>({
    available: false,
    map: new Map(),
  });

  const real = wanted.filter((w) => isRealLot(w.lot));
  // The lot is kept AS TYPED here, not lower-cased: Tally's batch_name match is exact.
  const tallyKey = [...new Set(real.map((w) => `${w.itemName}\u0000${w.lot.trim()}`))].sort().join("\u0001");
  const idsKey = [...new Set(wanted.map((w) => w.itemId))].sort().join("\u0001");

  useEffect(() => {
    if (!tallyKey) return;
    let live = true;
    const pairs = tallyKey.split("\u0001").map((k) => {
      const [item, lot] = k.split("\u0000");
      return { item, lot };
    });
    void fetchTallyExpiries(pairs, companyGuid).then((m) => { if (live) setTally(m); });
    return () => { live = false; };
  }, [tallyKey, companyGuid]);

  useEffect(() => {
    let live = true;
    void fetchTypedExpiries(idsKey ? idsKey.split("\u0001") : []).then((r) => { if (live) setTyped(r); });
    return () => { live = false; };
  }, [idsKey]);

  return { tally, typed: typed.map, typedAvailable: typed.available };
}
