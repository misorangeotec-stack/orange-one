import { useQuery } from "@tanstack/react-query";
import { getConnectwave, hasConnectwave } from "@/core/platform/connectwave";
import { itemKey } from "./stock";

/**
 * LOTS IN TALLY — ConnectWave's lot balances, read-only.
 *
 * Used twice: the Count page offers the lot NAMES as suggestions (never the quantities — the
 * verifier does not see Tally's figures) and freezes the balances on the row at each save, so
 * the Review can show lot-wise closing beside the lot-wise count.
 *
 * ⚠ These balances do not always add up to the item's closing (Otec Surat ink: 45 of 176
 *   items tied on 17-10-2026; some lots are negative). The Review says so where they differ.
 */

export interface Lot { lot: string; qty: number; godown: string }

/** Lots with a balance, keyed by itemKey(company, item). */
export async function fetchLots(pairs: { companyGuid: string; item: string }[]): Promise<Map<string, Lot[]>> {
  const out = new Map<string, Lot[]>();
  if (!pairs.length || !hasConnectwave()) return out;
  const cw = getConnectwave();
  const byCompany = new Map<string, string[]>();
  for (const p of pairs) byCompany.set(p.companyGuid, [...(byCompany.get(p.companyGuid) ?? []), p.item]);
  for (const [guid, items] of byCompany) {
    const list = [...new Set(items)];
    // Chunks keep the URL short (an item list can run past the 16 KB limit).
    for (let i = 0; i < list.length; i += 40) {
      const { data, error } = await cw
        .from("rpt_lot_balance")
        .select("stock_item,batch_name,balance,last_godown")
        .eq("company_guid", guid)
        .in("stock_item", list.slice(i, i + 40))
        .neq("balance", 0)
        .order("stock_item").order("batch_name")
        .returns<{ stock_item: string; batch_name: string | null; balance: number; last_godown: string | null }[]>();
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const k = itemKey(guid, r.stock_item);
        out.set(k, [...(out.get(k) ?? []), { lot: r.batch_name ?? "Primary Batch", qty: Number(r.balance) || 0, godown: r.last_godown ?? "" }]);
      }
    }
  }
  return out;
}

export function useLots(pairs: { companyGuid: string; item: string }[]) {
  const key = [...new Set(pairs.map((p) => itemKey(p.companyGuid, p.item)))].sort();
  return useQuery({
    queryKey: ["physical-verification", "lots", key],
    queryFn: () => fetchLots(pairs),
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
  });
}

/** Lot-wise comparison for the Review: every lot counted or held in Tally, side by side. */
export function lotCompare(counted: { lot: string; qty: number | null }[], closing: Lot[]) {
  const norm = (s: string) => s.trim().toUpperCase();
  const rows = new Map<string, { lot: string; counted: number | null; closing: number | null }>();
  for (const c of counted) {
    const k = norm(c.lot);
    const r = rows.get(k) ?? { lot: c.lot, counted: null, closing: null };
    r.counted = (r.counted ?? 0) + (c.qty ?? 0);
    rows.set(k, r);
  }
  for (const c of closing) {
    const k = norm(c.lot);
    const r = rows.get(k) ?? { lot: c.lot, counted: null, closing: null };
    r.closing = (r.closing ?? 0) + c.qty;
    rows.set(k, r);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, diff: (r.counted ?? 0) - (r.closing ?? 0) }))
    .sort((a, b) => a.lot.localeCompare(b.lot));
}
