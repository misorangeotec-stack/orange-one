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

const num = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString("en-IN") : Number(n.toFixed(3)).toLocaleString("en-IN");

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
 * Group and rank by volume — biggest first, which is the only order that makes
 * sense for "who did we ship the most to". Ties break on the name so the list
 * does not reshuffle between renders on equal counts.
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
  return [...by.entries()]
    .map(([key, list]) => ({ key, label: labelOf(key), count: list.length, qtyByUnit: sumQty(list) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
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

/**
 * Consignments per day across the range.
 *
 * ⚠ ZERO-FILLED, and that is the whole point. Plotting only the days that had a
 *   dispatch draws six evenly spaced bars across a month and reads as steady
 *   activity — the empty days ARE the signal.
 */
export function perDay(
  rows: Consignment[],
  range: DateRange,
  basis: Basis,
): { dayIso: string; count: number }[] {
  if (!range.from || !range.to) return [];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const d = dateFor(r, basis);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return daysBetween(range.from, range.to).map((dayIso) => ({
    dayIso,
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
