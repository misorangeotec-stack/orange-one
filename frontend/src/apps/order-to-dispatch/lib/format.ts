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
import type { QueueStep } from "./queues";

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

/**
 * What a reader is told when the intake has not been finished yet.
 *
 * ⚠ NOT a bare "—", and the difference matters on screen. A dash reads as *missing
 *   data* — something that should be there and is not. On a customer-raised order
 *   the billing company, our dispatch site and the dispatch type are legitimately
 *   empty until credit check fills them in (OD-13 Q1/Q2), so the honest word is
 *   that nobody has decided yet. The dash is kept for the genuinely old orders
 *   that predate these columns, where "not yet decided" would be a lie.
 */
export const NOT_YET_DECIDED = "Not yet decided";

type IntakeFields = {
  dispatchType: DispatchType | null;
  intakeSource: "customer" | null;
  intakeCompletedAt: string | null;
};

/** "Local" · "Transport" · "Not yet decided" · "—". Never an index into a Record with null. */
export const dispatchTypeText = (o: IntakeFields): string =>
  o.dispatchType
    ? DISPATCH_TYPE_LABEL[o.dispatchType]
    : o.intakeSource === "customer" && !o.intakeCompletedAt
      ? NOT_YET_DECIDED
      : "—";

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

/**
 * Is the invoice parked? Same shape, one step further down: recording the bill
 * leaves the `sbHold*` stamps standing as history, so `sbAt` is what says the
 * step is actually done.
 *
 * ⚠ NOT `status === "on_hold"`. That is the ORDER-level hold, which pulls the
 *   order out of every queue. This one leaves it exactly where it is.
 */
export const isBillHeld = (o: DispatchOrder): boolean => !!o.sbHoldAt && !o.sbAt;

/**
 * The steps that can park a row INSIDE their own queue, and where each one
 * keeps its reason and its "held since".
 *
 * A step-level hold is not a status: the order stays where it is, still owed by
 * the same desk, and the only thing that tells it apart from a row nobody has
 * touched is the chip and the remark. Anything drawing that chip — the queue,
 * the dashboard, the Control Center — reads this map rather than naming a step,
 * so a third held step needs one entry here and no new branches.
 */
export const STEP_HOLD: Partial<Record<QueueStep, {
  held: (o: DispatchOrder) => boolean;
  reason: (o: DispatchOrder) => string | null;
  since: (o: DispatchOrder) => string | null;
  /** Distinct wording per step — two holds must never share one word. */
  label: string;
}>> = {
  credit_check: {
    held: isCreditHeld,
    reason: (o) => o.ccRemarks,
    since: (o) => o.ccDecidedAt,
    label: "Credit on hold",
  },
  sales_bill: {
    held: isBillHeld,
    reason: (o) => o.sbHoldReason,
    since: (o) => o.sbHoldAt,
    label: "Bill on hold",
  },
};

/** Is this order parked at whichever step currently owes it? */
export const isStepHeld = (o: DispatchOrder): boolean =>
  isCreditHeld(o) || isBillHeld(o);

/** Why it is parked, whichever hold is live. Null when it is not. */
export const stepHoldReason = (o: DispatchOrder): string | null =>
  isCreditHeld(o) ? o.ccRemarks : isBillHeld(o) ? o.sbHoldReason : null;

/** What to call this order's live hold, for a chip or a filter value. */
export const stepHoldLabel = (o: DispatchOrder): string | null =>
  isCreditHeld(o) ? "Credit on hold" : isBillHeld(o) ? "Bill on hold" : null;

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
