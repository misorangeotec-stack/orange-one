/**
 * The Sales dashboards' FIGURES — one implementation, two callers.
 *
 * Everything here is pure: rows in, numbers out, no React, no browser. The dashboard
 * (pages/BushraSalesDashboard.tsx) draws these; the scheduled mail builds the same ones on a
 * server. That is the whole point of the file — a figure that is emailed at 08:00 and a figure on
 * the screen at 08:05 must not be able to disagree, and the only way to guarantee that is for both
 * to run this code rather than two implementations of it.
 *
 * ⚠ KEEP IT FREE OF `window`, `document`, `localStorage` and React. The mail builder runs on a
 *   runner with none of them, and an import of any of those fails the build there — see
 *   RECEIVABLES-SCHEDULED-EMAIL.md §2.1, which learned this the expensive way.
 */
import type { BushraRegisterRow } from "./bushraSalesRegister";
import type { QtyUnit } from "./bushraSalesDashboards";

type Row = BushraRegisterRow;

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ------------------------------------------------------------------ dates */

/** "20260415" → "2026-27" — the Indian FY a date falls in. */
export const fyOfDate = (d: string) => {
  const y = Number(d.slice(0, 4));
  const s = Number(d.slice(4, 6)) >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
};
/** "202609" → "Sep-26" */
export const monthName = (yyyymm: string) => `${MONTHS[Number(yyyymm.slice(4, 6)) - 1]}-${yyyymm.slice(2, 4)}`;
/** A year earlier, same month and day. "20260916" → "20250916". */
export const yearBefore = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
/** FY quarters: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar. */
export const quarterOf = (yyyymm: string) => {
  const m = Number(yyyymm.slice(4, 6));
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : Math.floor((m + 8) / 3) + 1;
  return Math.min(4, q);
};
export const QUARTER_MONTHS = ["Apr-Jun", "Jul-Sep", "Oct-Dec", "Jan-Mar"];
/** Growth against last year. Null when there is no last year to divide by. */
export const growth = (cur: number, pre: number): number | null =>
  (pre === 0 ? null : ((cur - pre) / Math.abs(pre)) * 100);

/* --------------------------------------------------------------- the rules */

/**
 * A DISCOUNT LINE IS NOT A RETURN. Discounts and rate differences are booked as ledger lines on a
 * credit note (or a debit note when the difference is in our favour), so they are counted as
 * themselves: the cards read Sales → Discount → Net.
 */
const DISCOUNT_LINE = /DISCOUNT|RATE\s*DIFF/i;
export const isDiscountLine = (r: Row) => DISCOUNT_LINE.test(r.particulars);
export const DISCOUNT_TYPE = "Discount";

/** The five the business sells; everything else is one bucket. */
export const MAIN_PRODUCTS = ["Ink", "Machine", "Heads", "Spare Parts", "Paper"] as const;
export const OTHER_PRODUCT = "Other";
const PRODUCT_OF: Record<string, string> = {
  Ink: "Ink", "Provision Ink": "Ink", "Other Ink": "Ink",
  Machine: "Machine", Heads: "Heads", "Spare Parts": "Spare Parts", Paper: "Paper",
};
export const productOf = (salesType: string) => PRODUCT_OF[salesType] ?? OTHER_PRODUCT;

/** Each product's unit, for a figure that is one product's own. */
export const SALES_TYPE_UNIT: Record<string, QtyUnit> = {
  Ink: "kg", Machine: "nos", Heads: "nos", "Spare Parts": "pcs", Paper: "auto",
  [OTHER_PRODUCT]: "auto",
};

export const NOT_SET = "(Not set)";
/** A blank classification is a real, pickable value — "what is still untyped?" — never a gap. */
export const orNotSet = (v: string | null | undefined) => v || NOT_SET;

/**
 * A DISCOUNT LINE HAS NO STOCK ITEM, so it has no Category, Ink Type, Group or Colour to read —
 * and it must not be filed under "(Not set)", which has to mean what it says: the item IS there,
 * its Central Masters record is not filled in.
 *
 * Left together the two swamp each other. On the Ink dashboard for FY 2025-26 the item-less
 * "DISCOUNT & RATE DIFFERENCE@18% (INK)" lines come to about −9 Cr (they take Sales-Type Ink from
 * their own particulars tag, which is the point of that tag); the genuinely untyped ink sales
 * beside them are positive. Netted into one bucket the sum went negative, the ring dropped it —
 * a donut cannot draw a negative slice — and untyped sales read as a deduction instead of as
 * sales. So a discount line answers "Discount" on every dimension, exactly as it already does on
 * Type, and "(Not set)" is left holding sales alone.
 */
const itemDim = (get: (r: Row) => string | null | undefined) => (r: Row) =>
  (isDiscountLine(r) ? DISCOUNT_TYPE : orNotSet(get(r)));

/** How a row is read on every dimension the dashboards, the report tables and the mail share. */
export const DIMS = {
  month: (r: Row) => `${MONTHS[Number(r.vch_date.slice(4, 6)) - 1]}-${r.vch_date.slice(2, 4)}`,
  location: (r: Row) => orNotSet(r.location_name),
  company: (r: Row) => r.company,
  type: (r: Row) => (isDiscountLine(r) ? DISCOUNT_TYPE : r.type),
  salesType: (r: Row) => productOf(r.sales_type),
  category: itemDim((r) => r.item_category),
  inkType: itemDim((r) => r.ink_type),
  group: itemDim((r) => r.item_group),
  colour: itemDim((r) => r.colour),
  party: (r: Row) => r.party,
} as const;
export type DimKey = keyof typeof DIMS;

/* ---------------------------------------------------------------- numbers */

export const fmtInt = (n: number) => new Intl.NumberFormat("en-IN").format(Math.round(n));
/** Compact quantity — "1.2 L", "45 K", "800". */
export function fmtQty(n: number): string {
  const a = Math.abs(n);
  const trim = (x: number) => String(Number(x.toFixed(2)));
  if (a >= 1e7) return `${trim(n / 1e7)} Cr`;
  if (a >= 1e5) return `${trim(n / 1e5)} L`;
  if (a >= 1e3) return `${trim(n / 1e3)} K`;
  return trim(n);
}
export type QtyFmt = (n: number) => string;

/**
 * The dashboard's quantity writer, in the business's own units: ink "850 KG" / "12.5 T", spare
 * parts "1,240 pcs", machines & heads "36 Nos", paper whatever its items carry, and a bare number
 * where units are mixed.
 */
export function makeQtyFmt(unit: QtyUnit, rows: Row[]): QtyFmt {
  const trim = (x: number) => String(Number(x.toFixed(2)));
  switch (unit) {
    case "kg":
      return (n) => (Math.abs(n) >= 1000 ? `${trim(n / 1000)} T` : `${fmtInt(n)} KG`);
    case "pcs":
      return (n) => `${fmtInt(n)} pcs`;
    case "nos":
      return (n) => `${fmtInt(n)} Nos`;
    case "auto": {
      const count = new Map<string, number>();
      for (const r of rows) if (r.unit) count.set(r.unit, (count.get(r.unit) ?? 0) + 1);
      const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
      return (n) => (top ? `${fmtInt(n)} ${top}` : fmtInt(n));
    }
    default:
      return fmtQty;
  }
}

/* ------------------------------------------------------------ the figures */

export interface Pair { name: string; qty: number; value: number; lines: number }

/** Quantity and revenue per value of one dimension, biggest revenue first. */
export function pairBy(rows: Row[], get: (r: Row) => string): Pair[] {
  const m = new Map<string, Pair>();
  for (const r of rows) {
    const k = get(r);
    const p = m.get(k) ?? { name: k, qty: 0, value: 0, lines: 0 };
    p.qty += r.quantity;
    p.value += r.revenue;
    p.lines += 1;
    m.set(k, p);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

export interface Cmp { name: string; curQty: number; curVal: number; preQty: number; preVal: number }

/** Sum one dimension over two windows at once — this year's and last year's same span. */
export function compareBy(
  rows: Row[], get: (r: Row) => string,
  cur: { from: string; to: string }, pre: { from: string; to: string },
): Cmp[] {
  const m = new Map<string, Cmp>();
  const at = (name: string) => {
    const c = m.get(name) ?? { name, curQty: 0, curVal: 0, preQty: 0, preVal: 0 };
    m.set(name, c);
    return c;
  };
  for (const r of rows) {
    const d = r.vch_date;
    if (d >= cur.from && d <= cur.to) { const c = at(get(r)); c.curQty += r.quantity; c.curVal += r.revenue; }
    else if (d >= pre.from && d <= pre.to) { const c = at(get(r)); c.preQty += r.quantity; c.preVal += r.revenue; }
  }
  return [...m.values()].sort((a, b) => b.curVal - a.curVal);
}

export interface SalesKpis {
  /** Everything, netted. */
  net: number;
  /** Billed, before discount and returns. */
  sales: number;
  /** Discount & rate-difference lines (negative, except a difference in our favour). */
  discount: number;
  /** Credit notes and returns, discounts excluded. */
  less: number;
  qty: number;
  vouchers: number;
  parties: number;
}

/** Sales → Discount → Returns, which add up to Net exactly. */
export function salesKpis(rows: Row[]): SalesKpis {
  let net = 0, sales = 0, discount = 0, less = 0, qty = 0;
  const vouchers = new Set<string>();
  const parties = new Set<string>();
  for (const r of rows) {
    net += r.revenue;
    qty += r.quantity;
    if (isDiscountLine(r)) { discount += r.revenue; continue; }
    if (r.revenue < 0) { less += r.revenue; continue; }
    sales += r.revenue;
    // A zero-value FOC line is still a voucher and a customer served.
    vouchers.add(`${r.tenant_id}|${r.voucher_no}`);
    parties.add(r.party);
  }
  return { net, sales, discount, less, qty, vouchers: vouchers.size, parties: parties.size };
}

/** Every month of an FY up to a cut-off date, as YYYYMM. */
export function monthsOfFy(fy: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(fy.slice(0, 4)), m = 4;
  const end = Number(to.slice(0, 6));
  while (y * 100 + m <= end) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
