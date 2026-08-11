/**
 * Display helpers for Order to Dispatch — labels, tones and number/date
 * formatting. Everything user-visible about a status lives here so no screen
 * spells one out on its own.
 */
import type {
  CreditStatus,
  DeliveryStatus,
  DispatchOrder,
  DispatchStatus,
  DispatchType,
  SalesReturnMode,
} from "../types";

export type Tone = "grey" | "blue" | "orange" | "green" | "red" | "yellow";

export const STATUS_LABEL: Record<DispatchStatus, string> = {
  awaiting_credit_check: "Awaiting credit",
  awaiting_material_status: "Awaiting stock check",
  awaiting_sales_bill: "Awaiting sales bill",
  awaiting_gate_out: "Awaiting gate out",
  awaiting_dispatch_confirm: "Awaiting delivery",
  awaiting_sales_return: "Cancellation requested",
  closed: "Closed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<DispatchStatus, Tone> = {
  awaiting_credit_check: "blue",
  awaiting_material_status: "blue",
  awaiting_sales_bill: "orange",
  awaiting_gate_out: "orange",
  awaiting_dispatch_confirm: "orange",
  // ⚠ NOT grey. A cancellation whose invoice is still live in Tally is open
  //   financial exposure; dressing it like a settled `cancelled` is the one
  //   thing this status exists to stop.
  awaiting_sales_return: "red",
  closed: "green",
  on_hold: "yellow",
  cancelled: "grey",
};

export const SALES_RETURN_MODE_LABEL: Record<SalesReturnMode, string> = {
  invoice_cancelled: "Invoice cancelled",
  sales_return: "Sales return raised",
};

export const DISPATCH_TYPE_LABEL: Record<DispatchType, string> = {
  local: "Local",
  transport: "Transport",
};

export const CREDIT_STATUS_LABEL: Record<CreditStatus, string> = {
  approved: "Approved",
  partial: "Partially approved",
  credit_hold: "On hold",
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  delivered: "Delivered",
  returned: "Returned",
};

/**
 * Is credit holding this order? True only while the hold is LIVE — approving
 * later leaves `ccStatus` at 'approved', and `ccAt` is what says the step is
 * actually done.
 */
export const isCreditHeld = (o: DispatchOrder): boolean =>
  o.ccStatus === "credit_hold" && !o.ccAt;

/** The outcomes that deserve a red chip wherever they appear. */
export const isExceptionOutcome = (o: DispatchOrder): boolean =>
  isCreditHeld(o) || o.rounds.some((r) => r.dcStatus === "returned") || o.dcStatus === "returned";

/** dd-mm-yyyy, the app-wide date format. Empty input renders an em dash. */
export const dmy = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return "—";
  return `${day}-${m}-${y}`;
};

/** dd-mm-yyyy hh:mm for a timestamp. */
export const dmyTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const numOrDash = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : String(n);

/** ₹ with Indian grouping. */
export const inr = (n: number | null | undefined): string =>
  n === null || n === undefined
    ? "—"
    : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** "SO-2627-0001 · Swastik" — the one-line subject used in modals and emails. */
export const orderSubject = (o: DispatchOrder, customerName: string): string =>
  `${o.orderNo} · ${customerName}`;

/**
 * The four quantities that describe an order at a glance.
 *   ordered   — what the customer asked for (never changes)
 *   dispatched— delivered so far, across every round
 *   shipping  — selected for the round in progress, not yet delivered
 *   pending   — still owed. `ordered - dispatched`, floored at zero per line.
 */
export function qtyTotals(o: DispatchOrder): {
  ordered: number; dispatched: number; shipping: number; pending: number;
} {
  let ordered = 0, dispatched = 0, shipping = 0, pending = 0;
  for (const l of o.lines) {
    const q = Number(l.quantity) || 0;
    const d = Number(l.dispatchedQty) || 0;
    ordered += q;
    dispatched += d;
    shipping += Number(l.shipQty) || 0;
    pending += Math.max(q - d, 0);
  }
  return { ordered, dispatched, shipping, pending };
}

/**
 * The unit to print beside a column TOTAL: the one unit every line shares, or ""
 * when they disagree. A total of 500 KGS and 3 PCS is a number with no unit, and
 * labelling it with either one would be a lie — so the totals row prints the bare
 * figure and the per-line units stay the record.
 */
export const sharedUnit = (lines: { unit: string | null }[]): string => {
  const units = new Set(lines.map((l) => l.unit ?? "").filter(Boolean));
  return units.size === 1 ? ([...units][0] ?? "") : "";
};

/**
 * "dd-mm-yyyy" → "yyyy-mm-dd" so a column whose DISPLAY value is dd-mm-yyyy still
 * sorts and range-filters chronologically instead of lexicographically by day.
 */
export const isoFromDmy = (v: string): string =>
  /^\d{2}-\d{2}-\d{4}$/.test(v) ? v.split("-").reverse().join("-") : v;
