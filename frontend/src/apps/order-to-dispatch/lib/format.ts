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
  MaterialStatus,
} from "../types";

export type Tone = "grey" | "blue" | "orange" | "green" | "red" | "yellow";

export const STATUS_LABEL: Record<DispatchStatus, string> = {
  awaiting_credit_check: "Awaiting credit",
  awaiting_material_status: "Awaiting stock check",
  awaiting_lot_confirm: "Awaiting LOT & qty",
  awaiting_sales_bill: "Awaiting sales bill",
  awaiting_gate_out: "Awaiting gate out",
  awaiting_dispatch_confirm: "Awaiting delivery",
  closed: "Closed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<DispatchStatus, Tone> = {
  awaiting_credit_check: "blue",
  awaiting_material_status: "blue",
  awaiting_lot_confirm: "blue",
  awaiting_sales_bill: "orange",
  awaiting_gate_out: "orange",
  awaiting_dispatch_confirm: "orange",
  closed: "green",
  on_hold: "yellow",
  cancelled: "grey",
};

export const DISPATCH_TYPE_LABEL: Record<DispatchType, string> = {
  local: "Local",
  transport: "Transport",
};

export const CREDIT_STATUS_LABEL: Record<CreditStatus, string> = {
  credit_available: "Credit Available",
  payment_required: "Payment Required",
};

export const MATERIAL_STATUS_LABEL: Record<MaterialStatus, string> = {
  available_for_dispatch: "Available for Dispatch",
  production_required: "Production Required",
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  delivered: "Delivered",
  partially_delivered: "Partially Delivered",
  returned: "Returned",
};

/** The two outcomes that deserve a red chip wherever they appear. */
export const isExceptionOutcome = (o: DispatchOrder): boolean =>
  o.msStatus === "production_required" || o.dcStatus === "returned";

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

/** Total ordered / total confirmed for dispatch, across an order's lines. */
export function qtyTotals(o: DispatchOrder): { ordered: number; final: number } {
  let ordered = 0;
  let final = 0;
  for (const l of o.lines) {
    ordered += Number(l.quantity) || 0;
    final += Number(l.finalQty) || 0;
  }
  return { ordered, final };
}

/**
 * "dd-mm-yyyy" → "yyyy-mm-dd" so a column whose DISPLAY value is dd-mm-yyyy still
 * sorts and range-filters chronologically instead of lexicographically by day.
 */
export const isoFromDmy = (v: string): string =>
  /^\d{2}-\d{2}-\d{4}$/.test(v) ? v.split("-").reverse().join("-") : v;
