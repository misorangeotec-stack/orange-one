/**
 * Packing material — the third leg of what a kilogram costs, and the one Tally ties to a product.
 *
 * Batch costing prices the ink a STOCK JOURNAL-PRODUCTION voucher consumed; the expense page prices
 * the P&L. Neither sees the can, the cap or the sticker: packing leaves stock on its own vouchers,
 * at the moment the bulk ink is packed.
 *
 * ─── THE PACKING VOUCHER SAYS WHAT IT PACKED ────────────────────────────────────────────────────
 *
 * A STOCK TRANSFER-WAREHOUSE voucher (26091391, 1-Sep-26) reads:
 *
 *   Source (Consumption)                          Destination (Production)
 *   KY REACTIVE INK YELLOW      980 KGS  1,58,662  KY REACTIVE INK YELLOW  980 KGS  1,76,645
 *   10 LITER ... CAN WITH LOGO   98 PCS    16,660
 *   10L CAP YELLOW               98 PCS     1,078
 *   10L STICKER KY INK YELLOW    98 PCS       245
 *
 * The bulk ink goes in one side and comes out the other, dearer by exactly the packing
 * (1,76,645 − 1,58,662 = 17,983). So every packing line has a finished good ON THE SAME VOUCHER,
 * and through it a colour, an item group and a sub-group — which is why packing, unlike an expense,
 * CAN be read per colour and per product. 99 % of the year's consumption attributes this way
 * (₹91.40 L of ₹92.14 L); the rest is a purchase return, which packed nothing.
 *
 * Where a voucher packs more than one finished good, the packing is split across them by their
 * value — the same proportion Tally itself used to load the cost.
 *
 * ─── OUTWARD IS NOT THE SAME AS CONSUMED ────────────────────────────────────────────────────────
 *
 * Tally's Stock Group Summary prints ₹1.82 Cr of Outwards for FY 2026-27 and this file reproduces
 * it line for line — but half is a godown move: a STOCK TRANSFER TO PRODUCTION voucher carries an
 * equal INWARD of the same item (10L CAP BLACK: 8,360 out, 8,360 in), the cap moving from the
 * warehouse to the floor. Those are listed, flagged, and not costed. What survives is consumption:
 * ₹92.14 L, ₹17.34 a KG. (Agreed with the business on 2026-09-12.)
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { PRODUCTION_COMPANY_GUID, itemKey } from "./batchCosting";
import { colourOf, isScrapItem, itemCategoryOf, itemGroupOf, type ItemGroup } from "./batchCostingRules";
import { fyBounds, tenantForFy } from "./salesReport";
import { monthLabel } from "./batchCostingDashboard";

export const PACKING_PRIMARY_GROUP = "PACKING MATERIAL STOCK";

/** The finished good a packing line packed, and how much of the line belongs to it. */
export interface PackedInto {
  item: string;
  colour: string;
  group: ItemGroup | null;
  category: string;
  /** 0–1: this finished good's share of the voucher's output value. */
  share: number;
  /** Finished good KGS this voucher made of it. */
  kgs: number;
}

/** One outward line of packing material, as the page lists it. */
export interface PackingRow {
  fy: string;
  /** YYYYMMDD */
  vch_date: string;
  /** "Aug-26" */
  month: string;
  voucher_guid: string;
  voucher_no: string;
  voucher_type: string;
  item: string;
  /** The sub-group under PACKING MATERIAL STOCK: "10 LIT CAPS", "EP HD STICKER". */
  group: string;
  qty: number;
  uom: string | null;
  rate: number | null;
  value: number;
  /** This line less the same item's inward on the same voucher — zero on a godown move. */
  consumedQty: number;
  consumedValue: number;
  /** True when the whole line is a godown move rather than a consumption. */
  isTransfer: boolean;
  /** What it packed. Empty when the voucher made no finished good (a purchase return). */
  packed: PackedInto[];
  /** The largest of `packed`, for the table's Finished good / Colour columns. */
  fgItem: string;
  fgColour: string;
  fgGroup: ItemGroup | null;
  fgCategory: string;
}

interface RawLine {
  fy: string;
  vch_date: string;
  voucher_guid: string;
  voucher_no: string | null;
  voucher_type: string;
  line_no: number;
  batch_no: number;
  stock_item: string;
  stock_group: string | null;
  movement: string;
  qty: number | null;
  uom: string | null;
  rate: number | null;
  amount: number | null;
}

const PAGE = 1000;

/** item → its sub-group, for every item whose primary group is PACKING MATERIAL STOCK. */
async function packingItems(tenant: string): Promise<Map<string, string>> {
  const cw = getConnectwaveSupabase();
  const out = new Map<string, string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_stock_summary_item")
      .select("item,stock_group")
      .eq("tenant_id", tenant)
      .eq("primary_group", PACKING_PRIMARY_GROUP)
      .order("item", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<{ item: string; stock_group: string | null }[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) out.set(itemKey(r.item), r.stock_group ?? PACKING_PRIMARY_GROUP);
    if (rows.length < PAGE) return out;
  }
}

async function oneFy(fy: string, currentNames: Map<string, string>): Promise<PackingRow[]> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(PRODUCTION_COMPANY_GUID, fy);
  const bounds = fyBounds(fy);
  const groups = await packingItems(`acct_orange::${PRODUCTION_COMPANY_GUID}`);
  if (!groups.size) return [];
  const isPacking = (item: string) => groups.has(itemKey(item));

  // Every line of the year. The order is a TOTAL one — PostgREST repeats rows across pages
  // without it, which silently inflates every total built from them.
  const raw: RawLine[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_batch_line")
      .select("fy,vch_date,voucher_guid,voucher_no,voucher_type,line_no,batch_no,stock_item,stock_group,movement,qty,uom,rate,amount")
      .eq("tenant_id", tenant)
      .gte("vch_date", bounds.from)
      .lte("vch_date", bounds.to)
      .in("movement", ["in", "out"])
      .order("voucher_guid", { ascending: true })
      .order("line_no", { ascending: true })
      .order("batch_no", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<RawLine[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    raw.push(...rows);
    if (rows.length < PAGE) break;
  }

  const byVoucher = new Map<string, RawLine[]>();
  for (const r of raw) {
    const at = byVoucher.get(r.voucher_guid);
    if (at) at.push(r);
    else byVoucher.set(r.voucher_guid, [r]);
  }

  const out: PackingRow[] = [];
  for (const [, lines] of byVoucher) {
    if (!lines.some((l) => l.movement === "out" && isPacking(l.stock_item))) continue;

    // What the voucher produced: its inward lines that are neither packing nor scrap.
    const fgTotals = new Map<string, { value: number; kgs: number; group: string | null }>();
    for (const l of lines) {
      if (l.movement !== "in" || isPacking(l.stock_item) || isScrapItem(l.stock_item)) continue;
      const name = currentNames.get(itemKey(l.stock_item)) ?? l.stock_item;
      const at = fgTotals.get(name) ?? { value: 0, kgs: 0, group: l.stock_group };
      at.value += Math.abs(Number(l.amount) || 0);
      if ((l.uom ?? "").toUpperCase() === "KGS") at.kgs += Math.abs(Number(l.qty) || 0);
      fgTotals.set(name, at);
    }
    const fgValue = [...fgTotals.values()].reduce((s, f) => s + f.value, 0);
    const packed: PackedInto[] = [...fgTotals].map(([item, f]) => {
      const grp = itemGroupOf(item);
      return {
        item,
        colour: colourOf(item),
        group: grp,
        category: itemCategoryOf(item, grp, f.group).category,
        // Split by value where the voucher packed several goods — the proportion Tally itself
        // used when it loaded the packing onto them. Equal shares if it booked no values.
        share: fgValue > 0 ? f.value / fgValue : 1 / Math.max(1, fgTotals.size),
        kgs: f.kgs,
      };
    }).sort((a, b) => b.share - a.share);

    // A packing inward on the same voucher means the line is a godown move, not a use.
    const inQty = new Map<string, number>();
    const inValue = new Map<string, number>();
    for (const l of lines) {
      if (l.movement !== "in" || !isPacking(l.stock_item)) continue;
      const k = itemKey(l.stock_item);
      inQty.set(k, (inQty.get(k) ?? 0) + Math.abs(Number(l.qty) || 0));
      inValue.set(k, (inValue.get(k) ?? 0) + Math.abs(Number(l.amount) || 0));
    }

    for (const l of lines) {
      if (l.movement !== "out" || !isPacking(l.stock_item)) continue;
      const k = itemKey(l.stock_item);
      const qty = Math.abs(Number(l.qty) || 0);
      const value = Math.abs(Number(l.amount) || 0);
      const offQty = Math.min(qty, inQty.get(k) ?? 0);
      const offValue = Math.min(value, inValue.get(k) ?? 0);
      inQty.set(k, (inQty.get(k) ?? 0) - offQty);
      inValue.set(k, (inValue.get(k) ?? 0) - offValue);
      const first = packed[0];
      out.push({
        fy: l.fy || fy,
        vch_date: l.vch_date,
        month: monthLabel(l.vch_date.slice(0, 6)),
        voucher_guid: l.voucher_guid,
        voucher_no: l.voucher_no ?? "",
        voucher_type: l.voucher_type,
        item: currentNames.get(k) ?? l.stock_item,
        group: groups.get(k) ?? PACKING_PRIMARY_GROUP,
        qty,
        uom: l.uom,
        rate: l.rate == null ? null : Number(l.rate),
        value,
        consumedQty: qty - offQty,
        consumedValue: value - offValue,
        isTransfer: qty - offQty <= 0.0001,
        packed,
        fgItem: first?.item ?? "",
        fgColour: first?.colour ?? "",
        fgGroup: first?.group ?? null,
        fgCategory: first?.category ?? "",
      });
    }
  }
  return out;
}

/** item key → the item's current name, so packing and production spell an item the same way. */
async function currentItemNames(): Promise<Map<string, string>> {
  const cw = getConnectwaveSupabase();
  const out = new Map<string, string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("v_master_stock_item")
      .select("item")
      .eq("tenant_id", `acct_orange::${PRODUCTION_COMPANY_GUID}`)
      .order("item", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<{ item: string }[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) out.set(itemKey(r.item), r.item);
    if (rows.length < PAGE) return out;
  }
}

/** Every packing outward line of the production company, for the given FYs. */
export async function loadPackingMaterial(fys: string[]): Promise<PackingRow[]> {
  if (!fys.length) return [];
  const names = await currentItemNames();
  const perFy = await Promise.all(fys.map((fy) => oneFy(fy, names)));
  return perFy.flat();
}

/* ------------------------------------------------------------------ totals */

export interface PackingTotals {
  /** Tally's own Outwards — transfers included. */
  outwardValue: number;
  outwardQty: number;
  /** What was really used: transfers netted off. This is what a kilogram is charged. */
  consumedValue: number;
  consumedQty: number;
  /** The godown moves that were netted off. */
  transferValue: number;
  /** Consumption on a voucher that produced nothing — a purchase return. */
  unattributedValue: number;
  lines: number;
}

export function packingTotals(rows: PackingRow[]): PackingTotals {
  const t: PackingTotals = {
    outwardValue: 0, outwardQty: 0, consumedValue: 0, consumedQty: 0, transferValue: 0,
    unattributedValue: 0, lines: rows.length,
  };
  for (const r of rows) {
    t.outwardValue += r.value;
    t.outwardQty += r.qty;
    t.consumedValue += r.consumedValue;
    t.consumedQty += r.consumedQty;
    t.transferValue += r.value - r.consumedValue;
    if (!r.packed.length) t.unattributedValue += r.consumedValue;
  }
  return t;
}

/**
 * Packing consumption that belongs to the finished goods a caller cares about.
 *
 * `keep` is asked about each finished good a line packed; the line contributes that good's share.
 * A line that packed nothing (a purchase return) is counted only when nothing is being narrowed,
 * because it belongs to no product.
 */
export function packingFor(rows: PackingRow[], keep?: (p: PackedInto) => boolean): number {
  let total = 0;
  for (const r of rows) {
    if (r.isTransfer) continue;
    if (!r.packed.length) {
      if (!keep) total += r.consumedValue;
      continue;
    }
    for (const p of r.packed) {
      if (!keep || keep(p)) total += r.consumedValue * p.share;
    }
  }
  return total;
}

export interface PackingSlice {
  name: string;
  consumedValue: number;
  consumedQty: number;
  outwardValue: number;
  lines: number;
  uom: string | null;
}

/** Consumption grouped by whatever the caller names — packing item, sub-group, voucher type. */
export function packingBy(rows: PackingRow[], key: (r: PackingRow) => string): PackingSlice[] {
  const m = new Map<string, PackingSlice>();
  for (const r of rows) {
    const k = key(r) || "(None)";
    const at = m.get(k);
    if (at) {
      at.consumedValue += r.consumedValue;
      at.consumedQty += r.consumedQty;
      at.outwardValue += r.value;
      at.lines++;
    } else {
      m.set(k, {
        name: k, consumedValue: r.consumedValue, consumedQty: r.consumedQty,
        outwardValue: r.value, lines: 1, uom: r.uom,
      });
    }
  }
  return [...m.values()].sort((a, b) => b.consumedValue - a.consumedValue);
}

/** Consumption grouped by something about the finished good it packed — colour, group, item. */
export function packingByPacked(rows: PackingRow[], key: (p: PackedInto) => string): PackingSlice[] {
  const m = new Map<string, PackingSlice>();
  for (const r of rows) {
    if (r.isTransfer) continue;
    for (const p of r.packed) {
      const k = key(p) || "(None)";
      const at = m.get(k) ?? { name: k, consumedValue: 0, consumedQty: 0, outwardValue: 0, lines: 0, uom: r.uom };
      at.consumedValue += r.consumedValue * p.share;
      at.consumedQty += r.consumedQty * p.share;
      at.outwardValue += r.value * p.share;
      at.lines++;
      m.set(k, at);
    }
  }
  return [...m.values()].sort((a, b) => b.consumedValue - a.consumedValue);
}

export interface PackingMonth {
  month: string;
  label: string;
  consumedValue: number;
  transferValue: number;
  perKg: number | null;
}

/** Consumption month by month, and what it added to a kilogram that month. */
export function packingByMonth(
  rows: PackingRow[],
  months: string[],
  kgsByMonth: Map<string, number>,
): PackingMonth[] {
  const acc = new Map<string, { c: number; t: number }>();
  for (const r of rows) {
    const ym = r.vch_date.slice(0, 6);
    const at = acc.get(ym) ?? { c: 0, t: 0 };
    at.c += r.consumedValue;
    at.t += r.value - r.consumedValue;
    acc.set(ym, at);
  }
  return months.map((ym) => {
    const a = acc.get(ym) ?? { c: 0, t: 0 };
    const kgs = kgsByMonth.get(ym) ?? 0;
    return {
      month: ym,
      label: monthLabel(ym),
      consumedValue: a.c,
      transferValue: a.t,
      perKg: kgs > 0 ? a.c / kgs : null,
    };
  });
}

/** What packing adds to a kilogram over the period. */
export const packingPerKg = (totals: PackingTotals, kgs: number): number | null =>
  (kgs > 0 ? totals.consumedValue / kgs : null);
