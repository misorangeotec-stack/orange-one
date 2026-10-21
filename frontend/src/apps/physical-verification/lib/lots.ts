import { useQuery } from "@tanstack/react-query";
import { getConnectwave, hasConnectwave } from "@/core/platform/connectwave";
import { itemKey } from "./stock";

/**
 * TALLY'S LOT-WISE CLOSING — rebuilt from Tally's own stock lines (ConnectWave, read-only).
 *
 * Asked 20-10-2026: show each lot's closing exactly as Tally has it, adding up to the item's
 * closing. ConnectWave's ready-made `rpt_lot_balance` does NOT: it counts purchase orders and
 * proforma invoices as stock under the batch "Any" (Sublimation F-Series Magenta: 75,350 kg of
 * "Any" against a closing of 8,615), and counts a delivery challan and its invoice twice.
 *
 * So the lots are netted here from `rpt_batch_line`, with the SAME rules as the accountant's
 * lot-wise ageing tool (Tally Operating System · tools/fetch_stock_ageing_lotwise.py):
 *   1. base tenant only (a `~YYYYMMDD` tenant is an earlier year's book);
 *   2. only lines that move stock — affects_stock, and never an order / proforma voucher;
 *   3. a Delivery Challan and the invoice raised against it share a tracking number: ONE move;
 *   4. net each real lot (not "Any" / "Primary Batch" / "Not applicable");
 *   5. tie to Tally's closing: newest lots first up to the closing; whatever no lot accounts
 *      for (opening stock older than the synced vouchers) is one "(no lot record)" line.
 * Checked 20-10-2026: Magenta's 8 lots come to exactly 8,615; Cyan 5,184.7 + 215.3 = 5,400.
 *
 * The Count page uses only the lot NAMES (suggestions); the quantities are frozen on the row at
 * each save for the Review, never shown to the counter.
 */

export interface Lot { lot: string; qty: number; godown: string }

export const NO_LOT = "(no lot record)";

const ORDERISH = /(PURCHASE\s+OREDR|PURCHASE\s+ORDER|SALES\s+ORDER|PROFORMA)/i;
const NON_LOT = new Set(["", "any", "not applicable", "primary batch", "none"]);
const ymd = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(0, 8);

interface Line {
  stock_item: string; vch_date: string | null; voucher_guid: string | null; voucher_type: string | null;
  movement: string | null; affects_stock: boolean | null; batch_name: string | null; is_real_lot: boolean | null;
  tracking_number: string | null; godown_name: string | null; qty: number | null;
}

export interface LotRequest {
  companyGuid: string;
  item: string;
  /** Tally's closing to tie to; null = report the lots as they net, untied. */
  closing: number | null;
  /** Count lines up to this date (YYYY-MM-DD or a timestamp); null = up to today. */
  asOf?: string | null;
}

/** Tally's lot-wise closing per item, keyed by itemKey(company, item). */
export async function fetchLots(reqs: LotRequest[]): Promise<Map<string, Lot[]>> {
  const out = new Map<string, Lot[]>();
  if (!reqs.length || !hasConnectwave()) return out;
  const cw = getConnectwave();
  const byCompany = new Map<string, string[]>();
  for (const r of reqs) byCompany.set(r.companyGuid, [...new Set([...(byCompany.get(r.companyGuid) ?? []), r.item])]);

  const linesBy = new Map<string, Line[]>();
  for (const [guid, items] of byCompany) {
    // Small chunks: one ink item can carry ~2,000 lines.
    for (let i = 0; i < items.length; i += 8) {
      const chunk = items.slice(i, i + 8);
      for (let off = 0; ; off += 1000) {
        const { data, error } = await cw
          .from("rpt_batch_line")
          .select("stock_item,vch_date,voucher_guid,voucher_type,movement,affects_stock,batch_name,is_real_lot,tracking_number,godown_name,qty")
          .eq("tenant_id", `acct_orange::${guid}`)
          .in("stock_item", chunk)
          // A TOTAL order — unordered offset paging drops and repeats rows.
          .order("vch_date").order("voucher_guid").order("line_no")
          .range(off, off + 999)
          .returns<Line[]>();
        if (error) throw new Error(error.message);
        for (const l of data ?? []) {
          const k = itemKey(guid, l.stock_item);
          linesBy.set(k, [...(linesBy.get(k) ?? []), l]);
        }
        if ((data ?? []).length < 1000) break;
      }
    }
  }

  for (const r of reqs) {
    const k = itemKey(r.companyGuid, r.item);
    const asOf = r.asOf ? ymd(r.asOf) : "99999999";
    const moves = (linesBy.get(k) ?? []).filter((x) => x.affects_stock && !ORDERISH.test(x.voucher_type ?? "")
      && (x.movement === "in" || x.movement === "out") && ymd(x.vch_date) <= asOf);
    // A challan and its invoice: one stock move.
    const seen = new Set<string>();
    const bal = new Map<string, number>();
    const lastIn = new Map<string, string>();
    const godown = new Map<string, string>();
    for (const x of moves) {
      if (x.tracking_number) {
        const t = [x.tracking_number, x.batch_name, x.movement, Math.round((Number(x.qty) || 0) * 1000)].join("|");
        if (seen.has(t)) continue;
        seen.add(t);
      }
      const lot = (x.batch_name ?? "").trim();
      if (!x.is_real_lot || NON_LOT.has(lot.toLowerCase())) continue;
      bal.set(lot, (bal.get(lot) ?? 0) + (x.movement === "in" ? 1 : -1) * (Number(x.qty) || 0));
      if (x.movement === "in") lastIn.set(lot, ymd(x.vch_date));
      if (x.godown_name) godown.set(lot, x.godown_name);
    }
    const lots = [...bal.entries()].filter(([, v]) => v > 0.0005)
      .sort((a, b) => (lastIn.get(b[0]) ?? "").localeCompare(lastIn.get(a[0]) ?? ""));
    const tied: Lot[] = [];
    if (r.closing === null) {
      for (const [lot, v] of lots) tied.push({ lot, qty: round3(v), godown: godown.get(lot) ?? "" });
    } else {
      // Newest lots first up to Tally's closing; the remainder has no lot record.
      let left = r.closing;
      for (const [lot, v] of lots) {
        if (left <= 0.0005) break;
        const q = Math.min(v, left);
        tied.push({ lot, qty: round3(q), godown: godown.get(lot) ?? "" });
        left -= q;
      }
      if (left > 0.0005) tied.push({ lot: NO_LOT, qty: round3(left), godown: "" });
    }
    out.set(k, tied);
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function useLots(reqs: LotRequest[]) {
  const key = reqs.map((r) => `${itemKey(r.companyGuid, r.item)}|${r.closing ?? ""}|${r.asOf ? ymd(r.asOf) : ""}`).sort();
  return useQuery({
    queryKey: ["physical-verification", "lots", key],
    queryFn: () => fetchLots(reqs),
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
  // Tally's own lots first in the order Tally holds them; "(no lot record)" last.
  return [...rows.values()]
    .map((r) => ({ ...r, diff: (r.counted ?? 0) - (r.closing ?? 0) }))
    .sort((a, b) => Number(a.lot === NO_LOT) - Number(b.lot === NO_LOT) || a.lot.localeCompare(b.lot));
}
