/**
 * Production Batch Costing Dashboard — the aggregation layer.
 *
 * Reads NOTHING of its own. It takes the Batch Costing register's rows (lib/batchCosting.ts — the
 * same loader, the same batch collapsing, the same classification) and folds them into one summary
 * per batch, then into the panels. So the dashboard and the register can never disagree: a batch
 * on one is the same batch on the other.
 *
 * ─── COST PER KG ────────────────────────────────────────────────────────────────────────────────
 *
 * Tally values a production voucher's finished good at exactly the cost of what it consumed (on
 * all 591 vouchers of FY 2026-27 output value = consumption value to the paisa), so a batch's
 * cost per KG is simply its finished-good value ÷ finished-good KGS — which is also the rate Tally
 * printed on the FG line. Scrap is produced at no value, so it never dilutes the figure.
 *
 * Only KGS finished goods enter a per-KG figure. One voucher produced DM WATER in LTR; it still
 * counts as a batch and in the value totals, but a litre is not a kilogram.
 *
 * An average over several batches is VALUE-WEIGHTED (Σ value ÷ Σ KGS), never a mean of the batch
 * rates — a 300 KGS trial batch must not weigh the same as a 1,100 KGS production run.
 */
import type { BatchCostingRow } from "./batchCosting";
import type { ItemGroup } from "./batchCostingRules";
import { isScrapItem } from "./batchCostingRules";

export const KGS = "KGS";

/** "20250602" → "2025-26". The Indian FY runs April–March. */
export function fyOfYmd(ymd: string): string {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(4, 6));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Series colours — follow the ENTITY, never its rank, so a filter never repaints a survivor.
 *  Validated with the dataviz palette checker (light surface): all checks pass; contrast is below
 *  3:1, which is why every chart has labels/tooltips and the batch table below it. */
export const GROUP_COLOR: Record<ItemGroup, string> = {
  Reactive: "#e77e23",    // brand orange
  Sublimation: "#17a1cf", // blue
  Others: "#9957db",      // violet
};
export const GROUPS: ItemGroup[] = ["Reactive", "Sublimation", "Others"];
/** Single-series charts use slot 1 (brand orange) for every bar. */
export const SERIES_1 = "#e77e23";
export const SERIES_2 = "#17a1cf";

/** One production batch (one Stock Journal-Production voucher). */
export interface BatchSummary {
  key: string;
  company_guid: string;
  vch_date: string;
  /** YYYYMM */
  month: string;
  /** "2025-26" — the Indian FY the voucher falls in (Apr–Mar), for the year filter and year chart. */
  fy: string;
  voucher_no: string;
  fg_item: string;
  colour: string;
  item_group: ItemGroup | null;
  item_category: string;
  /** Finished good produced, KGS only. */
  fg_kgs: number;
  /** Finished good value (= RM cost of the batch, per Tally). */
  fg_value: number;
  /** Value of every consumption line, scrap re-use included. */
  rm_value: number;
  scrap_out: number;
  scrap_in: number;
  /** fg_value ÷ fg_kgs; null when the batch produced no KGS finished good. */
  cost_per_kg: number | null;
  rm_lines: number;
}

export function summariseBatches(rows: BatchCostingRow[]): BatchSummary[] {
  const byV = new Map<string, BatchCostingRow[]>();
  for (const r of rows) {
    const k = `${r.company_guid}|${r.voucher_guid}`;
    const a = byV.get(k);
    if (a) a.push(r);
    else byV.set(k, [r]);
  }
  const out: BatchSummary[] = [];
  for (const [key, rs] of byV) {
    const h = rs[0];
    let fg_kgs = 0, fg_value = 0, fg_value_kgs = 0, rm_value = 0, scrap_out = 0, scrap_in = 0, rm_lines = 0;
    for (const r of rs) {
      if (r.category === "Finished Good") {
        fg_value += r.amount;
        if ((r.uom ?? "").toUpperCase() === KGS) { fg_kgs += r.qty; fg_value_kgs += r.amount; }
      } else if (r.category === "Scrap") {
        scrap_out += Math.abs(r.qty);
      } else {
        rm_value += Math.abs(r.amount);
        rm_lines++;
        if (isScrapItem(r.item)) scrap_in += Math.abs(r.qty);
      }
    }
    out.push({
      key,
      company_guid: h.company_guid,
      vch_date: h.vch_date,
      month: h.vch_date.slice(0, 6),
      fy: fyOfYmd(h.vch_date),
      voucher_no: h.voucher_no,
      fg_item: h.fg_item,
      colour: h.colour,
      item_group: h.item_group,
      item_category: h.item_category,
      fg_kgs,
      fg_value,
      rm_value,
      scrap_out,
      scrap_in,
      cost_per_kg: fg_kgs > 0 ? fg_value_kgs / fg_kgs : null,
      rm_lines,
    });
  }
  return out.sort((a, b) => a.vch_date.localeCompare(b.vch_date) ||
    a.voucher_no.localeCompare(b.voucher_no, "en", { numeric: true }));
}

/** Σ value ÷ Σ KGS over the batches that produced KGS. */
export function weightedCostPerKg(bs: BatchSummary[]): number | null {
  let v = 0, q = 0;
  for (const b of bs) if (b.cost_per_kg != null) { v += b.cost_per_kg * b.fg_kgs; q += b.fg_kgs; }
  return q > 0 ? v / q : null;
}

export interface Kpis {
  batches: number;
  fgKgs: number;
  fgValue: number;
  costPerKg: number | null;
  rmValue: number;
  scrapOut: number;
  scrapIn: number;
  scrapFinal: number;
  /** Total scrap ÷ (finished good + total scrap), as %. */
  scrapRate: number | null;
  /** Finished good ÷ (finished good + total scrap), as % — the yield of the batches. */
  yieldPct: number | null;
}

export function kpis(bs: BatchSummary[]): Kpis {
  const sum = (f: (b: BatchSummary) => number) => bs.reduce((s, b) => s + f(b), 0);
  const fgKgs = sum((b) => b.fg_kgs);
  const scrapOut = sum((b) => b.scrap_out);
  const scrapIn = sum((b) => b.scrap_in);
  return {
    batches: bs.length,
    fgKgs,
    fgValue: sum((b) => b.fg_value),
    costPerKg: weightedCostPerKg(bs),
    rmValue: sum((b) => b.rm_value),
    scrapOut,
    scrapIn,
    scrapFinal: scrapOut - scrapIn,
    scrapRate: fgKgs + scrapOut > 0 ? (scrapOut / (fgKgs + scrapOut)) * 100 : null,
    yieldPct: fgKgs + scrapOut > 0 ? (fgKgs / (fgKgs + scrapOut)) * 100 : null,
  };
}

/* ------------------------------------------------------------------ months */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Every YYYYMM from `from` to `to` (YYYYMMDD), so an idle month shows as a gap, not a skip. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(4, 6));
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(4, 6));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
export const monthLabel = (ym: string) => `${MON[Number(ym.slice(4, 6)) - 1]}-${ym.slice(2, 4)}`;

/** Every month from the first batch to the last, so an idle month shows as a gap, not a skip. */
export function monthsSpanning(bs: BatchSummary[]): string[] {
  if (!bs.length) return [];
  const ms = bs.map((b) => b.month).sort();
  return monthsBetween(`${ms[0]}01`, `${ms[ms.length - 1]}01`);
}

export interface FyPoint { fy: string; label: string; kgs: number; batches: number; value: number; costPerKg: number | null }

/** One bar per financial year, oldest first. */
export function byFy(bs: BatchSummary[]): FyPoint[] {
  const m = new Map<string, BatchSummary[]>();
  for (const b of bs) (m.get(b.fy) ?? m.set(b.fy, []).get(b.fy)!).push(b);
  return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([fy, list]) => {
    const k = kpis(list);
    return { fy, label: `FY ${fy}`, kgs: k.fgKgs, batches: k.batches, value: k.fgValue, costPerKg: k.costPerKg };
  });
}

export interface MonthPoint {
  month: string;
  label: string;
  batches: number;
  Reactive: number;
  Sublimation: number;
  Others: number;
  totalKgs: number;
  value: number;
  costPerKg: number | null;
  scrapOut: number;
  scrapIn: number;
  scrapFinal: number;
}

export function byMonth(bs: BatchSummary[], months: string[]): MonthPoint[] {
  const rows = new Map<string, BatchSummary[]>();
  for (const b of bs) {
    const a = rows.get(b.month);
    if (a) a.push(b);
    else rows.set(b.month, [b]);
  }
  return months.map((m) => {
    const list = rows.get(m) ?? [];
    const g = (grp: ItemGroup) => list.filter((b) => (b.item_group ?? "Others") === grp).reduce((s, b) => s + b.fg_kgs, 0);
    const k = kpis(list);
    return {
      month: m,
      label: monthLabel(m),
      batches: list.length,
      Reactive: g("Reactive"),
      Sublimation: g("Sublimation"),
      Others: g("Others"),
      totalKgs: k.fgKgs,
      value: k.fgValue,
      costPerKg: k.costPerKg,
      scrapOut: k.scrapOut,
      scrapIn: k.scrapIn,
      scrapFinal: k.scrapFinal,
    };
  });
}

/* ------------------------------------------------------------------ breakdowns */

export interface Slice {
  name: string;
  batches: number;
  kgs: number;
  value: number;
  costPerKg: number | null;
  group?: ItemGroup | null;
}

export function sliceBy(bs: BatchSummary[], key: (b: BatchSummary) => string): Slice[] {
  const m = new Map<string, BatchSummary[]>();
  for (const b of bs) {
    const k = key(b) || "(None)";
    const a = m.get(k);
    if (a) a.push(b);
    else m.set(k, [b]);
  }
  return [...m].map(([name, list]) => ({
    name,
    batches: list.length,
    kgs: list.reduce((s, b) => s + b.fg_kgs, 0),
    value: list.reduce((s, b) => s + b.fg_value, 0),
    costPerKg: weightedCostPerKg(list),
    group: list[0].item_group,
  })).sort((a, b) => b.kgs - a.kgs);
}

export interface RmSlice {
  name: string;
  value: number;
  qty: number;
  unit: string;
  batches: number;
  share: number;
}

/**
 * Raw materials ranked by value consumed, top `n` plus one "All other materials" row so the bars
 * still sum to the whole. Only the consumption lines of the batches that survived the filters.
 */
export function topRawMaterials(rows: BatchCostingRow[], keep: Set<string>, n = 10): RmSlice[] {
  const m = new Map<string, { value: number; qty: number; unit: string; v: Set<string> }>();
  let total = 0;
  for (const r of rows) {
    if (r.type !== "Consumption" || !keep.has(`${r.company_guid}|${r.voucher_guid}`)) continue;
    const v = Math.abs(r.amount);
    total += v;
    const cur = m.get(r.item) ?? { value: 0, qty: 0, unit: r.uom ?? "", v: new Set<string>() };
    cur.value += v;
    cur.qty += Math.abs(r.qty);
    cur.v.add(r.voucher_guid);
    m.set(r.item, cur);
  }
  const all = [...m].map(([name, x]) => ({
    name, value: x.value, qty: x.qty, unit: x.unit, batches: x.v.size, share: total ? (x.value / total) * 100 : 0,
  })).sort((a, b) => b.value - a.value);
  if (all.length <= n) return all;
  const rest = all.slice(n);
  const restValue = rest.reduce((s, r) => s + r.value, 0);
  return [
    ...all.slice(0, n),
    { name: `All other materials (${rest.length})`, value: restValue, qty: 0, unit: "", batches: 0, share: total ? (restValue / total) * 100 : 0 },
  ];
}

/* ------------------------------------------------------------------ formatting */

const nf2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** "5,25,897.83 KGS" — the tiles, at the 2 decimals the register uses. */
export const fmtKgs = (n: number) => `${nf2.format(n)} KGS`;
/** "₹ 245.67 / KG". */
export const fmtPerKg = (n: number | null | undefined) => (n == null ? "—" : `₹ ${nf2.format(n)}`);
export const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${nf2.format(n)} %`);
export const fmtInt = (n: number) => nf0.format(n);

/**
 * Axis tick in TONNES — the axis of every weight chart. The panel title carries the unit, so the
 * tick is a bare number: 5,29,121 KGS on the axis reads "529".
 */
export function tickTonnes(n: number): string {
  const t = n / 1000;
  if (t === 0) return "0";
  return Math.abs(t) >= 100 ? nf0.format(Math.round(t)) : nf2.format(Math.round(t * 10) / 10);
}

/** Compact quantity tick — "1.2L", "45K", "800". Kept for kilogram-scaled panels. */
export function tickQty(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${Number((n / 1e7).toFixed(1))}Cr`;
  if (a >= 1e5) return `${Number((n / 1e5).toFixed(1))}L`;
  if (a >= 1e3) return `${Number((n / 1e3).toFixed(0))}K`;
  return String(Math.round(n));
}
