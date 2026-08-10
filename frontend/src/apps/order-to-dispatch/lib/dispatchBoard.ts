/**
 * The dispatch board's arithmetic — what was billed, what left, and the gap.
 *
 * Pure functions, no React: the dashboard is then a layout over these, and the
 * definitions live in one place rather than being re-derived per card.
 *
 * ⚠ A DISPATCH IS A ROUND, NOT AN ORDER. One round gets one invoice, one gate
 *   pass and one gate-out date; an order shipped in three goes is three of them.
 *   Counting orders would merge three invoices into one row and lose two dates.
 *
 * ⚠ AND ROUNDS MUST COME FROM `allRoundViews`, NEVER THE ORDER HEADER. The
 *   header is wiped the moment a round is archived, so reading `o.goActualDate`
 *   would silently drop every dispatch but the most recent on each order — they
 *   physically happened, and would simply vanish from the figures. The old
 *   dashboard carries this same warning for deliveries; it is true of every
 *   number on this screen.
 */
import type { DateRange } from "@/shared/components/ui/DateRangeFilter";
import { dateInRange } from "@/shared/components/ui/DateRangeFilter";
import { allRoundViews } from "./rounds";
import type { DispatchOrder } from "../types";

/**
 * What a consignment is doing right now.
 *
 * ⚠ `returned` IS STILL A DISPATCH. The goods left the gate and came back, so it
 *   counts under the agreed definition (dispatched = gate outward recorded) —
 *   but it is kept as its own state rather than folded into `delivered`, because
 *   silently counting a return as a completed delivery overstates what the
 *   customer actually received.
 */
export type ConsignmentState = "billed" | "dispatched" | "delivered" | "returned";

export interface Consignment {
  /** Unique per ROUND — an order contributes one of these per consignment. */
  key: string;
  orderId: string;
  orderNo: string;
  roundNo: number;
  customerId: string;
  customerLocation: string | null;
  companyId: string | null;
  locationId: string | null;
  invoiceNo: string | null;
  /** The invoice date — stamped by the server as `current_date` (UTC). */
  invoiceDateIso: string | null;
  gpNo: string | null;
  /** The date the goods left. This is what "dispatched" means here. */
  gateOutIso: string | null;
  /**
   * Quantity split BY UNIT, never one total.
   *
   * The units master allows KGS / LTR / PCS / BOX, and 500 KGS + 3 PCS = 503 is
   * wrong in a way nobody notices. Same rule `sharedUnit` already applies to
   * every other total in this app: show the split, never the false sum.
   */
  qtyByUnit: Record<string, number>;
  state: ConsignmentState;
}

const stateOf = (v: {
  goActualDate: string | null;
  dcStatus: string | null;
}): ConsignmentState => {
  if (v.dcStatus === "returned") return "returned";
  if (v.dcStatus === "delivered") return "delivered";
  return v.goActualDate ? "dispatched" : "billed";
};

/**
 * Every consignment across every order, whatever state it is in.
 *
 * ⚠ CANCELLED AND CLOSED ORDERS ARE INCLUDED ON PURPOSE. `cancel_order` archives
 *   the live round whenever material status was recorded, so an order that
 *   dispatched and was cancelled afterwards still holds that consignment in its
 *   archive — it genuinely left the plant. Filtering cancelled orders out is the
 *   obvious-looking tidy-up that would delete real dispatches from the figures.
 */
export function consignmentsOf(orders: DispatchOrder[]): Consignment[] {
  const out: Consignment[] = [];
  for (const o of orders) {
    for (const v of allRoundViews(o)) {
      // A round nobody has billed or shipped yet is not a consignment, it is an
      // intention. Without this the board would count every open order twice.
      if (!v.sbInvoiceNo && !v.sbActualDate && !v.goActualDate) continue;

      const qtyByUnit: Record<string, number> = {};
      for (const i of v.items) {
        const q = Number(i.shipQty) || 0;
        if (q <= 0) continue;
        const unit = (i.unitName ?? "").trim() || "—";
        qtyByUnit[unit] = (qtyByUnit[unit] ?? 0) + q;
      }

      out.push({
        key: `${o.id}:${v.roundNo}`,
        orderId: o.id,
        orderNo: o.orderNo,
        roundNo: v.roundNo,
        customerId: o.customerId,
        customerLocation: o.customerLocation,
        companyId: v.companyId ?? o.companyId,
        locationId: v.locationId ?? o.locationId,
        invoiceNo: v.sbInvoiceNo,
        invoiceDateIso: v.sbActualDate,
        gpNo: v.gpNo,
        gateOutIso: v.goActualDate,
        qtyByUnit,
        state: stateOf(v),
      });
    }
  }
  return out;
}

/**
 * The date a consignment is counted on, which depends on the question asked.
 * "Billed today" and "dispatched today" are different sets of rows, not the same
 * rows filtered twice.
 */
export type Basis = "billed" | "dispatched";
export const dateFor = (c: Consignment, basis: Basis): string | null =>
  basis === "billed" ? c.invoiceDateIso : c.gateOutIso;

export const inRange = (rows: Consignment[], range: DateRange, basis: Basis): Consignment[] =>
  rows.filter((c) => dateInRange(dateFor(c, basis), range));

/** Everything billed but still sitting in the plant, whenever it was billed. */
export const notGone = (rows: Consignment[]): Consignment[] =>
  rows.filter((c) => !!c.invoiceDateIso && !c.gateOutIso);

/* --------------------------------- totals --------------------------------- */

export const sumQty = (rows: Consignment[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const [unit, q] of Object.entries(r.qtyByUnit)) out[unit] = (out[unit] ?? 0) + q;
  }
  return out;
};

export const qtyNum = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString("en-IN") : Number(n.toFixed(3)).toLocaleString("en-IN");
const num = qtyNum;

/**
 * The unit carrying the most volume across a set — KGS, here, essentially always.
 *
 * ⚠ THIS EXISTS SO NOTHING HAS TO ADD KGS TO PCS. Quantity is the headline
 *   measure on this board now, and a headline needs ONE number to size a bar and
 *   order a list by. The honest single number is "how much of the unit that
 *   dominates this set", not a cross-unit sum — 500 KGS + 3 PCS = 503 is the exact
 *   arithmetic `qtyByUnit` was built to prevent. Rows measured in some other unit
 *   still print their real quantity; they simply do not win the ranking.
 */
export function dominantUnit(rows: { qtyByUnit: Record<string, number> }[]): string | null {
  const totals: Record<string, number> = {};
  for (const r of rows) {
    for (const [unit, n] of Object.entries(r.qtyByUnit)) totals[unit] = (totals[unit] ?? 0) + n;
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [unit, n] of Object.entries(totals)) {
    if (n > bestN) { best = unit; bestN = n; }
  }
  return best;
}

/** How much of one unit a quantity split holds — 0 when it holds none. */
export const qtyIn = (q: Record<string, number>, unit: string | null): number =>
  unit ? (q[unit] ?? 0) : 0;

/**
 * "3,450 KGS · 200 LTR", biggest first.
 *
 * Capped because this lands in an 11px KPI hint: four units wrap into a mess, so
 * the tail collapses to "+2 more" and the full picture stays in the table.
 */
export function qtyLabel(q: Record<string, number>, max = 2): string {
  const parts = Object.entries(q)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (parts.length === 0) return "—";
  const shown = parts.slice(0, max).map(([unit, n]) => `${num(n)}${unit === "—" ? "" : ` ${unit}`}`);
  const rest = parts.length - shown.length;
  return shown.join(" · ") + (rest > 0 ? ` · +${rest} more` : "");
}

/* -------------------------------- breakdowns ------------------------------- */

export interface RankRow {
  key: string;
  label: string;
  count: number;
  qtyByUnit: Record<string, number>;
}

/**
 * Group and rank BY QUANTITY — biggest first.
 *
 * ⚠ QUANTITY, NOT COUNT, AND THAT IS THE POINT. This used to sort on the number
 *   of consignments, which put a customer who took four 30 KG parcels above one
 *   who took a single 400 KG load. The business measure is what physically went
 *   out; the count is a supporting detail. Count is the first tie-break, so a
 *   set with no quantity recorded still ranks sensibly.
 */
export function rankBy(
  rows: Consignment[],
  keyOf: (c: Consignment) => string,
  labelOf: (key: string) => string,
): RankRow[] {
  const by = new Map<string, Consignment[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = by.get(k);
    if (list) list.push(r);
    else by.set(k, [r]);
  }
  const out = [...by.entries()].map(([key, list]) => ({
    key,
    label: labelOf(key),
    count: list.length,
    qtyByUnit: sumQty(list),
  }));
  return sortByQty(out);
}

/** Shared ordering for every ranked list on the board. */
export function sortByQty<T extends RankRow>(rows: T[]): T[] {
  const unit = dominantUnit(rows);
  return [...rows].sort(
    (a, b) =>
      qtyIn(b.qtyByUnit, unit) - qtyIn(a.qtyByUnit, unit) ||
      b.count - a.count ||
      a.label.localeCompare(b.label),
  );
}

/* ------------------------------ company blocks ----------------------------- */

/**
 * One selling company, with everything that went out under it.
 *
 * ⚠ THE COMPANY IS THE OUTER GROUPING ON PURPOSE. Both companies operate a site
 *   called SURAT-HOJIWALA, so a flat "dispatched by location" list printed that
 *   name twice with no way to tell the two apart, and a flat customer list gave
 *   no clue which company had billed whom. Nesting site and customer UNDER the
 *   company is what makes those two lists readable — it is not decoration.
 */
export interface CompanyBlock extends RankRow {
  locations: RankRow[];
  customers: RankRow[];
}

export function companyBlocks(
  rows: Consignment[],
  companyLabel: (id: string) => string,
  locationLabel: (id: string) => string,
  customerLabel: (id: string) => string,
): CompanyBlock[] {
  const by = new Map<string, Consignment[]>();
  for (const r of rows) {
    const k = r.companyId ?? "—";
    const list = by.get(k);
    if (list) list.push(r);
    else by.set(k, [r]);
  }
  const out = [...by.entries()].map(([key, list]) => ({
    key,
    label: companyLabel(key),
    count: list.length,
    qtyByUnit: sumQty(list),
    locations: rankBy(list, (c) => c.locationId ?? "—", locationLabel),
    customers: rankBy(list, (c) => c.customerId, customerLabel),
  }));
  return sortByQty(out);
}

/* ---------------------------------- trend ---------------------------------- */

/** Every yyyy-mm-dd from `from` to `to` inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export interface DayPoint {
  dayIso: string;
  /** Quantity in `unit` — what the bar is drawn from. */
  qty: number;
  /** Consignments that day — the supporting number, shown in the tooltip. */
  count: number;
}

/**
 * Quantity (and consignments) per day across the range.
 *
 * ⚠ ZERO-FILLED, and that is the whole point. Plotting only the days that had a
 *   dispatch draws six evenly spaced bars across a month and reads as steady
 *   activity — the empty days ARE the signal.
 *
 * `unit` is the series' basis, normally `dominantUnit(rows)`. Consignments
 * measured in anything else still contribute to `count` but not to `qty`, for
 * the reason spelled out on `dominantUnit`.
 */
export function perDay(
  rows: Consignment[],
  range: DateRange,
  basis: Basis,
  unit: string | null,
): DayPoint[] {
  if (!range.from || !range.to) return [];
  const counts = new Map<string, number>();
  const qtys = new Map<string, number>();
  for (const r of rows) {
    const d = dateFor(r, basis);
    if (!d) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
    qtys.set(d, (qtys.get(d) ?? 0) + qtyIn(r.qtyByUnit, unit));
  }
  return daysBetween(range.from, range.to).map((dayIso) => ({
    dayIso,
    qty: qtys.get(dayIso) ?? 0,
    count: counts.get(dayIso) ?? 0,
  }));
}

/** Whole days since `iso`, for "oldest waiting 4d". */
export const daysSince = (iso: string, todayIso: string): number =>
  Math.max(
    0,
    Math.round(
      (new Date(`${todayIso}T00:00:00Z`).getTime() - new Date(`${iso}T00:00:00Z`).getTime()) /
        86_400_000,
    ),
  );
