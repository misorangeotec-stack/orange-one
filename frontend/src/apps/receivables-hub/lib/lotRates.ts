/**
 * Lot purchase rate vs production rate — what a lot was BOUGHT at, beside what the production
 * entry charged for it.
 *
 * ─── WHY THE TWO DIFFER ─────────────────────────────────────────────────────────────────────────
 *
 * A Stock Journal-Production entry consumes the lot the user picks, but Tally values that line at
 * the item's AVERAGE cost, not at the picked lot's own purchase price. So a batch made from a cheap
 * lot can be costed at the dearer average (lot 2180, MONO ETHYLENE GLYCOL: bought @ ₹69.85,
 * consumed @ ₹99.85), and the other way round (lot 25113962: bought @ ₹626.50, consumed @ ₹538.67).
 *
 * ─── WHERE THE PURCHASE RATE COMES FROM ─────────────────────────────────────────────────────────
 *
 * ConnectWave's `rpt_batch_line` holds every voucher's lot allocations, in every company.
 *
 *   1. PURCHASED. The qty-weighted rate of the item + lot's PURCHASE-IN rows (direction =
 *      'purchase') — Surat's own purchase first, else another group company's (flagged: the
 *      price the group paid outside is not what Surat paid the sister company).
 *
 *   2. CONVERTED. No purchase under this name: find the entry that BROUGHT THE LOT INTO BEING —
 *      a Stock Journal / production entry where the item + lot comes in and the same item + lot
 *      does not go out (a godown transfer does both, so it is never an origin). Its inputs are
 *      priced the same way, recursively, and the output takes Tally's own rate scaled by
 *      (inputs at purchase basis ÷ inputs at Tally value). Two shapes this covers, both found on
 *      batch 26091546 (03-10-2026):
 *        - re-labelled: lot 25124438 was bought as REACTIVE POWDER BLUE PRO 15-LANYU @ ₹1,316.60
 *          and a Stock Journal turned 20 KG of it into REACTIVE POWDER RED 24:1 -LANYU, same lot;
 *        - made in-house: lot 18092026 of COMBINATION LIQUID A12-OTPL was produced from OL-56-UNI
 *          (lot UDC-047), DM WATER and CAUSTIC SODA LYE — its rate comes from those inputs.
 *      An input with no real lot (DM WATER) keeps its Tally value. Up to four steps back.
 *
 *   3. Otherwise none — an opening-balance lot, or a chain that never reaches a purchase. Shown
 *      as "not found", never guessed.
 *
 * The rate is Tally's invoice rate per unit — freight, duty and other landed costs booked as
 * separate ledgers are NOT in it.
 *
 * Read-only. Lots and vouchers are looked up in chunks (indexed), never a whole year. The live
 * and archive books carry the same vouchers, so rows are de-duplicated by voucher line + batch.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { PRODUCTION_COMPANY_GUID, itemKey, type BatchCostingRow } from "./batchCosting";
import { fetchCompanyMap, makeCompanyResolver } from "./companyMap";

export interface LotPurchaseLine {
  company: string;
  ownCompany: boolean;
  vch_date: string;
  voucher_no: string;
  voucher_type: string;
  party: string;
  qty: number;
  rate: number;
}

/** How a converted lot got its rate: the entry that made it, and what went in. */
export interface LotConversion {
  vch_date: string;
  voucher_no: string;
  voucher_type: string;
  inputs: Array<{ item: string; lot: string; qty: number; rate: number; priced: boolean }>;
}

export interface LotPurchase {
  lot: string;
  item: string;
  qty: number;
  value: number;
  /** Qty-weighted purchase rate (or conversion rate). */
  rate: number;
  /** True when the rate is another group company's purchase, not Surat's own. */
  otherCompany: boolean;
  /** Purchase lines — empty for a converted lot. */
  lines: LotPurchaseLine[];
  /** Set when the lot was made from other lots rather than bought under this name. */
  conversion?: LotConversion;
}

interface Raw {
  tenant_id: string;
  company_guid: string;
  voucher_guid: string;
  line_no: number;
  batch_no: number;
  vch_date: string;
  voucher_type: string | null;
  voucher_no: string | null;
  party: string | null;
  direction: string;
  movement: string;
  stock_item: string;
  batch_name: string | null;
  qty: number | null;
  rate: number | null;
  amount: number | null;
}

const COLS = "tenant_id,company_guid,voucher_guid,line_no,batch_no,vch_date,voucher_type,voucher_no,party,direction,movement,stock_item,batch_name,qty,rate,amount";
const NON_LOT = new Set(["", "any", "not applicable", "primary batch", "none", "primary"]);
const isLot = (lot: string | null | undefined) => !!lot && !NON_LOT.has(lot.trim().toLowerCase());
const lotKey = (item: string, lot: string) => `${itemKey(item)}|${lot.trim().toUpperCase()}`;
const lotOfKey = (k: string) => k.slice(k.lastIndexOf("|") + 1);
const MAX_DEPTH = 4;
const PAGE = 1000;

async function pages(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Raw[]> {
  const out: Raw[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await q(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const got = (data ?? []) as Raw[];
    out.push(...got);
    if (got.length < PAGE) return out;
  }
}

/** Every inward row (not a godown transfer) of these lot names, any company. */
async function inRowsOf(lots: string[]): Promise<Raw[]> {
  const cw = getConnectwaveSupabase();
  const CHUNK = 60;
  const parts = await Promise.all(Array.from({ length: Math.ceil(lots.length / CHUNK) }, (_, i) =>
    pages((a, b) => cw.from("rpt_batch_line").select(COLS)
      .in("batch_name", lots.slice(i * CHUNK, (i + 1) * CHUNK))
      .eq("movement", "in")
      .not("voucher_type", "ilike", "%transfer%")
      .order("voucher_guid", { ascending: true }).order("line_no", { ascending: true })
      .order("batch_no", { ascending: true }).order("tenant_id", { ascending: true })
      .range(a, b))));
  return parts.flat();
}

/** Every row of these vouchers (tenant → voucher guids). */
async function voucherRows(byTenant: Map<string, string[]>): Promise<Raw[]> {
  const cw = getConnectwaveSupabase();
  const CHUNK = 40;
  const jobs: Promise<Raw[]>[] = [];
  for (const [tenant, guids] of byTenant) {
    for (let i = 0; i < guids.length; i += CHUNK) {
      const chunk = guids.slice(i, i + CHUNK);
      jobs.push(pages((a, b) => cw.from("rpt_batch_line").select(COLS)
        .eq("tenant_id", tenant).in("voucher_guid", chunk)
        .order("voucher_guid", { ascending: true }).order("line_no", { ascending: true })
        .order("batch_no", { ascending: true }).range(a, b)));
    }
  }
  return (await Promise.all(jobs)).flat();
}

function dedupe(rows: Raw[]): Raw[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.voucher_guid}|${r.line_no}|${r.batch_no}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const qtyOf = (r: Raw) => Math.abs(Number(r.qty) || 0);
const valueOf = (r: Raw) => Math.abs(Number(r.amount) || 0) || qtyOf(r) * (Number(r.rate) || 0);

/** Purchase rate of every (item, lot) the given production rows consumed, keyed by lotKey. */
export async function loadLotPurchases(rows: BatchCostingRow[]): Promise<Map<string, LotPurchase>> {
  const wanted = new Set<string>();
  for (const r of rows) {
    if (r.category !== "RM Consumption") continue;
    for (const lot of r.batches) wanted.add(lotKey(r.item, lot));
  }
  if (!wanted.size) return new Map();
  const resolve = makeCompanyResolver(await fetchCompanyMap());
  const companyOf = (r: Raw) => {
    const id = resolve(r.tenant_id, "");
    return id.location ? `${id.company} — ${id.location}` : id.company || r.company_guid.slice(0, 8);
  };

  /** lotKey → its purchase lines (own / other company). */
  const purchases = new Map<string, { own: LotPurchaseLine[]; other: LotPurchaseLine[]; item: string; lot: string }>();
  /** lotKey → origin voucher keys (tenant|guid) where the lot came into being. */
  const origins = new Map<string, Set<string>>();
  /** tenant|guid → that voucher's rows. */
  const vouchers = new Map<string, Raw[]>();
  const looked = new Set<string>();

  // Walk back level by level: look the lots up, then the vouchers that made the unbought ones,
  // then those vouchers' inputs, … — each level is a handful of chunked requests.
  let frontier = [...wanted];
  for (let depth = 0; depth <= MAX_DEPTH && frontier.length; depth++) {
    frontier.forEach((k) => looked.add(k));
    const lots = [...new Set(frontier.map(lotOfKey))];
    const inRows = dedupe(await inRowsOf(lots));
    const frontierSet = new Set(frontier);
    const needVouchers = new Map<string, Set<string>>();
    for (const r of inRows) {
      if (!isLot(r.batch_name)) continue;
      const k = lotKey(r.stock_item, r.batch_name!);
      if (!frontierSet.has(k)) continue;
      const qty = qtyOf(r);
      if (r.direction === "purchase") {
        const rate = Number(r.rate) || (qty ? valueOf(r) / qty : 0);
        if (!qty || !rate) continue;
        const own = r.company_guid === PRODUCTION_COMPANY_GUID;
        const at = purchases.get(k) ?? { own: [], other: [], item: r.stock_item, lot: r.batch_name! };
        (own ? at.own : at.other).push({
          company: companyOf(r), ownCompany: own, vch_date: r.vch_date, voucher_no: r.voucher_no ?? "",
          voucher_type: r.voucher_type ?? "", party: r.party ?? "", qty, rate,
        });
        purchases.set(k, at);
      } else if (!/return/i.test(r.voucher_type ?? "")) {
        const vk = `${r.tenant_id}|${r.voucher_guid}`;
        origins.set(k, (origins.get(k) ?? new Set()).add(vk));
        if (!vouchers.has(vk)) {
          needVouchers.set(r.tenant_id, (needVouchers.get(r.tenant_id) ?? new Set()).add(r.voucher_guid));
        }
      }
    }
    // Only lots with no purchase need their origin opened.
    for (const k of frontier) if (purchases.has(k)) origins.delete(k);
    const fetchNow = new Map<string, string[]>();
    for (const [k, vs] of origins) {
      if (!frontierSet.has(k)) continue;
      for (const vk of vs) {
        if (vouchers.has(vk)) continue;
        const [tenant, guid] = [vk.slice(0, vk.lastIndexOf("|")), vk.slice(vk.lastIndexOf("|") + 1)];
        if (needVouchers.get(tenant)?.has(guid)) fetchNow.set(tenant, [...(fetchNow.get(tenant) ?? []), guid]);
      }
    }
    for (const r of dedupe(await voucherRows(fetchNow))) {
      const vk = `${r.tenant_id}|${r.voucher_guid}`;
      vouchers.set(vk, [...(vouchers.get(vk) ?? []), r]);
    }
    // A voucher is an origin only if it does not also send the same item + lot OUT (a transfer).
    const next = new Set<string>();
    for (const [k, vs] of origins) {
      if (!frontierSet.has(k)) continue;
      for (const vk of [...vs]) {
        const v = vouchers.get(vk) ?? [];
        const sendsSame = v.some((r) => r.movement === "out" && isLot(r.batch_name) && lotKey(r.stock_item, r.batch_name!) === k);
        const outs = v.filter((r) => r.movement === "out");
        if (sendsSame || !outs.length) { vs.delete(vk); continue; }
        for (const o of outs) {
          if (!isLot(o.batch_name)) continue;
          const ik = lotKey(o.stock_item, o.batch_name!);
          if (!looked.has(ik)) next.add(ik);
        }
      }
      if (!vs.size) origins.delete(k);
    }
    frontier = [...next];
  }

  // Price bottom-up, memoised; a cycle or an unpriceable chain is "not found".
  const memo = new Map<string, LotPurchase | null>();
  const priceOf = (k: string, stack: Set<string>): LotPurchase | null => {
    if (memo.has(k)) return memo.get(k)!;
    if (stack.has(k)) return null;
    const p = purchases.get(k);
    if (p) {
      const lines = (p.own.length ? p.own : p.other).sort((a, b) => a.vch_date.localeCompare(b.vch_date));
      const qty = lines.reduce((s, l) => s + l.qty, 0);
      const value = lines.reduce((s, l) => s + l.qty * l.rate, 0);
      const out: LotPurchase = { lot: p.lot, item: p.item, qty, value, rate: qty ? value / qty : 0, otherCompany: !p.own.length, lines };
      memo.set(k, out);
      return out;
    }
    const vs = origins.get(k);
    if (!vs?.size) { memo.set(k, null); return null; }
    stack.add(k);
    let outQty = 0, outValue = 0, best: LotConversion | undefined, anyPriced = false, item = "", lot = "";
    for (const vk of vs) {
      const v = vouchers.get(vk) ?? [];
      const made = v.filter((r) => r.movement === "in" && isLot(r.batch_name) && lotKey(r.stock_item, r.batch_name!) === k);
      const madeQty = made.reduce((s, r) => s + qtyOf(r), 0);
      const madeTally = made.reduce((s, r) => s + valueOf(r), 0);
      if (!madeQty) continue;
      let inTally = 0, inBasis = 0;
      const inputs: LotConversion["inputs"] = [];
      // A re-label carries the lot number across ("BLUE PRO 15" lot 25124438 → "RED 24:1" lot
      // 25124438). When an input has the output's lot, that input IS the source — other lines on
      // the same entry made other outputs (the same journal turned BLUE 49 into ORANGE).
      const outs = v.filter((r) => r.movement === "out");
      const sameLot = outs.filter((r) => (r.batch_name ?? "").trim().toUpperCase() === lotOfKey(k));
      for (const o of sameLot.length ? sameLot : outs) {
        const tally = valueOf(o), q = qtyOf(o);
        const sub = isLot(o.batch_name) ? priceOf(lotKey(o.stock_item, o.batch_name!), stack) : null;
        inTally += tally;
        inBasis += sub ? q * sub.rate : tally;
        if (sub) anyPriced = true;
        inputs.push({ item: o.stock_item, lot: o.batch_name ?? "", qty: q, rate: sub ? sub.rate : (q ? tally / q : 0), priced: !!sub });
      }
      const ratio = inTally ? inBasis / inTally : 1;
      outQty += madeQty;
      outValue += madeTally * ratio;
      item = made[0].stock_item; lot = made[0].batch_name!;
      best ??= { vch_date: made[0].vch_date, voucher_no: made[0].voucher_no ?? "", voucher_type: made[0].voucher_type ?? "", inputs };
    }
    stack.delete(k);
    const out = anyPriced && outQty
      ? { lot, item, qty: outQty, value: outValue, rate: outValue / outQty, otherCompany: false, lines: [], conversion: best }
      : null;
    memo.set(k, out);
    return out;
  };

  const out = new Map<string, LotPurchase>();
  for (const k of wanted) {
    const p = priceOf(k, new Set());
    if (p) out.set(k, p);
  }
  return out;
}

/** The purchase of one item + lot, or undefined. */
export const purchaseOf = (p: Map<string, LotPurchase> | undefined, item: string, lot: string) =>
  p?.get(lotKey(item, lot));

/** One line of hover text: where the rate came from. */
export function purchaseNote(p: LotPurchase, lot: string): string {
  if (p.conversion) {
    const c = p.conversion;
    const ins = c.inputs.map((i) => `${i.item}${isLot(i.lot) ? ` (${i.lot})` : ""} ${i.qty} @ ${i.rate.toFixed(2)}${i.priced ? "" : " Tally"}`).join(", ");
    return `${lot}: @ ${p.rate.toFixed(2)} · converted on ${c.voucher_type} ${c.voucher_no} from ${ins}`;
  }
  const first = p.lines[0];
  return `${lot}: @ ${p.rate.toFixed(2)} · bought ${first.vch_date.slice(6, 8)}-${first.vch_date.slice(4, 6)}-${first.vch_date.slice(0, 4)} · ${first.party || first.voucher_no}${p.otherCompany ? ` (${first.company})` : ""}`;
}

/* ------------------------------------------------------------------ per batch */

export interface BatchPurchaseCost {
  /** RM consumed, each lot at its own purchase rate; lots with no purchase keep Tally's value. */
  rmAtPurchase: number;
  /** Share (0–100) of the batch's RM value that has a lot purchase rate behind it. */
  covered: number;
}

/** One batch's RM consumption re-valued at each lot's purchase rate. */
export function batchPurchaseCost(lines: BatchCostingRow[], purchases: Map<string, LotPurchase>): BatchPurchaseCost {
  let total = 0, atPurchase = 0, covered = 0;
  for (const l of lines) {
    if (l.category !== "RM Consumption") continue;
    const lineQty = Math.abs(l.qty);
    const lineValue = Math.abs(l.amount);
    total += lineValue;
    if (!l.batches.length || !lineQty) { atPurchase += lineValue; continue; }
    const rate = lineValue / lineQty;
    for (const lot of l.batches) {
      const q = l.lot_qty?.[lot] ?? lineQty / l.batches.length;
      const p = purchaseOf(purchases, l.item, lot);
      if (p) { atPurchase += q * p.rate; covered += q * rate; }
      else atPurchase += q * rate;
    }
  }
  return { rmAtPurchase: atPurchase, covered: total ? (covered / total) * 100 : 0 };
}
