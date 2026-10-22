/**
 * ACTIVE / IN-ACTIVE INK CUSTOMERS — who still buys our ink, and who has gone quiet.
 *
 * Built on the business's own Excel (shared 10-10-2026): an "Inactive Months" slicer of 1–15, the
 * customer list with its Last Sales Date, and a pivot of ink quantity by customer → main category →
 * colour, month by month. Each pivot row also names the ITEM (the Tally item description), since
 * one category and colour can be several items. This keeps that reading and adds what the sheet could not hold: the
 * salesperson, company, location, the ageing band and the ink each customer used to buy.
 *
 *   months inactive   whole months from the customer's LAST INK SALE to today — "25-05-2026" read on
 *                     10-10-2026 is 4 (Excel's DATEDIF "m"). 0 = bought this month or within a month.
 *   In-active         months inactive ≥ the threshold the reader picks (default 3)
 *   Active            bought ink more recently than that
 *
 * One customer = one hub Customer Group (lib/bushraLedgerLink.ts), so ink on any of their ledgers
 * keeps them active. Only ink lines, pure sales (no FOC, branch or related-party lines). A customer's
 * last sale is its last POSITIVE ink line — a credit note or a discount is not a purchase.
 *
 * ⚠ The register holds two FYs. A customer whose last ink was before that is not in it at all, so
 *   "12 m+" here means 12 months and up to the start of the data, not "ever".
 *
 * Kept free of React and the browser, like lib/bushraSalesFigures.ts.
 */
import { DIMS, NOT_SET, productOf } from "./bushraSalesFigures";
import { isPureSale } from "./bushraSalesDashboards";
import type { BushraRegisterRow } from "./bushraSalesRegister";

type Row = BushraRegisterRow;

export const isInkLine = (r: Row) => isPureSale(r) && productOf(r.sales_type) === "Ink";

/** Whole months from `from` to `to` (YYYYMMDD), Excel DATEDIF "m": a month counts once its day is reached. */
export function monthsBetween(from: string, to: string): number {
  const fy = Number(from.slice(0, 4)), fm = Number(from.slice(4, 6)), fd = Number(from.slice(6));
  const ty = Number(to.slice(0, 4)), tm = Number(to.slice(4, 6)), td = Number(to.slice(6));
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}

export const BANDS = ["Active", "Under 3 m", "3–6 m", "6–12 m", "12 m+"] as const;
export type Band = (typeof BANDS)[number];
/**
 * The ageing band. "Active" is under the reader's threshold; the in-active bands are fixed, so a
 * threshold of 1 or 2 months puts its newest in-actives in "Under 3 m".
 */
export function bandOf(months: number, threshold: number): Band {
  if (months < threshold) return "Active";
  if (months < 3) return "Under 3 m";
  if (months < 6) return "3–6 m";
  if (months < 12) return "6–12 m";
  return "12 m+";
}

export interface InkLedger { ledger: string; company: string; location: string; qty: number; value: number; last: string }

/** One pivot row: a colour and the exact item, KG per month. */
export interface PivotRow { colour: string; item: string; byMonth: Map<string, number> }

export interface InkCustomer {
  group: string;
  grouped: boolean;
  /** The salesperson on the ledger that bought the most ink; "" when none is tagged. */
  salesperson: string;
  companies: string[];
  locations: string[];
  ledgers: InkLedger[];
  /** YYYYMMDD of the last positive ink line. */
  lastSale: string;
  firstSale: string;
  /** Ink over the whole window, net. */
  qty: number; value: number;
  /** Ink in the 12 months up to today — the "what they used to buy" figure. */
  qty12: number; value12: number;
  /** Months that had any ink purchase — how regular the customer was. */
  activeMonths: number;
  /** Main categories (Central Masters Category) bought, biggest first. */
  categories: string[];
  /** The Excel pivot: category → one row per colour + item → KG by YYYYMM. */
  pivot: Map<string, Map<string, PivotRow>>;
}

/**
 * Every ink customer in the window. `groupOf` and `salespersonOf` are the hub masters' links
 * (lib/bushraLedgerLink.ts); `today` is YYYYMMDD.
 */
export function inkCustomers(
  rows: Row[],
  groupOf: (tenantId: string, ledger: string) => { group: string; grouped: boolean },
  salespersonOf: (tenantId: string, ledger: string) => string | null,
  today: string,
): InkCustomer[] {
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  type Acc = InkCustomer & {
    led: Map<string, InkLedger & { sp: string | null }>; months: Set<string>; cats: Map<string, number>;
    compSet: Set<string>; locSet: Set<string>;
  };
  const m = new Map<string, Acc>();
  for (const r of rows) {
    if (!isInkLine(r)) continue;
    const { group, grouped } = groupOf(r.tenant_id, r.party);
    let a = m.get(group);
    if (!a) {
      a = {
        group, grouped, salesperson: "", companies: [], locations: [], ledgers: [], lastSale: "", firstSale: "",
        qty: 0, value: 0, qty12: 0, value12: 0, activeMonths: 0, categories: [], pivot: new Map(),
        led: new Map(), months: new Set(), cats: new Map(), compSet: new Set(), locSet: new Set(),
      };
      m.set(group, a);
    }
    if (grouped) a.grouped = true;
    const company = DIMS.company(r), location = DIMS.location(r);
    const lk = `${r.tenant_id}|${r.party}`;
    const l = a.led.get(lk) ?? { ledger: r.party, company, location, qty: 0, value: 0, last: "", sp: salespersonOf(r.tenant_id, r.party) };
    a.led.set(lk, l);
    l.qty += r.quantity; l.value += r.revenue;
    a.qty += r.quantity; a.value += r.revenue;
    if (r.vch_date > yearAgo) { a.qty12 += r.quantity; a.value12 += r.revenue; }
    a.compSet.add(company); a.locSet.add(location);
    // A purchase is a positive line with goods on it — a credit note or a discount is not one.
    if (r.revenue > 0 && r.quantity > 0) {
      if (r.vch_date > a.lastSale) a.lastSale = r.vch_date;
      if (!a.firstSale || r.vch_date < a.firstSale) a.firstSale = r.vch_date;
      if (r.vch_date > l.last) l.last = r.vch_date;
      a.months.add(r.vch_date.slice(0, 6));
    }
    if (r.quantity) {
      const cat = DIMS.category(r) === NOT_SET ? "(No category)" : DIMS.category(r);
      const colour = DIMS.colour(r) === NOT_SET ? "(No colour)" : DIMS.colour(r);
      a.cats.set(cat, (a.cats.get(cat) ?? 0) + r.quantity);
      const rowsOf = a.pivot.get(cat) ?? a.pivot.set(cat, new Map()).get(cat)!;
      const rk = `${colour}|${r.particulars}`;
      const pr = rowsOf.get(rk) ?? rowsOf.set(rk, { colour, item: r.particulars, byMonth: new Map() }).get(rk)!;
      const mk = r.vch_date.slice(0, 6);
      pr.byMonth.set(mk, (pr.byMonth.get(mk) ?? 0) + r.quantity);
    }
  }
  const out: InkCustomer[] = [];
  for (const a of m.values()) {
    // Only customers who actually BOUGHT ink in the window; a group with nothing but credit notes is not one.
    if (!a.lastSale) continue;
    const ledgers = [...a.led.values()].sort((x, y) => y.value - x.value);
    const { led, months, cats, compSet, locSet, ...rest } = a;
    out.push({
      ...rest,
      salesperson: ledgers.find((l) => l.sp)?.sp ?? "",
      ledgers: ledgers.map(({ sp: _sp, ...l }) => l),
      companies: [...compSet].sort(), locations: [...locSet].sort(),
      activeMonths: months.size,
      categories: [...cats].filter(([, q]) => q > 0).sort((x, y) => y[1] - x[1]).map(([c]) => c),
    });
  }
  return out.sort((x, y) => y.value - x.value);
}
