import type { OcpiStatus } from "../types";

/**
 * How OCPI values are worded on screen.
 *
 * One place, because the same status appears on the dashboard, three lists, five
 * queues and the register export — and "Awaiting approval" in one and "Pending
 * approval" in another reads as two different states to somebody scanning.
 */

export const STATUS_LABEL: Record<OcpiStatus, string> = {
  draft: "Draft",
  awaiting_quotation_approval: "Quotation — awaiting approval",
  awaiting_order_confirmation: "Order confirmation — to complete",
  awaiting_oc_approval: "Order confirmation — awaiting approval",
  awaiting_customer_sign: "Awaiting customer signature",
  awaiting_management_sign: "Awaiting management signature",
  closed: "Completed",
  rejected: "Rejected",
  rework: "Sent back for rework",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

/**
 * Money, with the currency the deal was actually quoted in.
 *
 * ⚠ NEVER ASSUME RUPEES. A real submission recorded a total as "1.8 lakh
 *   dollar"; printing that with a ₹ would be an ~85× misstatement on a contract.
 */
export function fmtDealValue(amount: number | null, currency: string | null): string {
  if (amount === null) return "";
  const n = amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return `${currency === "USD" ? "$" : "₹"} ${n}`;
}

/** dd-mm-yyyy, the form people here read dates in. */
export function dmy(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * A quotation number from its sequence value: 24 → `QT-M0024`.
 *
 * ⚠ THE FORMAT LIVES IN TWO PLACES AND THAT IS A KNOWN DUPLICATE. The number a
 *   deal actually carries is minted in SQL — `'QT-M' || lpad(next_seq, 4, '0')`
 *   in fms_ocpi_generate_quotation — because minting must be atomic with the
 *   counter. This copy exists ONLY to show a person what the next one will look
 *   like before it is minted (Settings → Quotation numbering). Nothing stores
 *   what this returns; change the SQL and change this to match.
 */
export function quotationNoFor(seq: number): string {
  return `QT-M${String(Math.max(0, Math.trunc(seq))).padStart(4, "0")}`;
}
