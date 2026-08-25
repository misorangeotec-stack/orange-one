import type { OcpiDeal, OcpiStatus } from "../types";

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
  // ⚠ RETIRED, AND STILL LABELLED. The chain no longer routes through these two
  //   steps, but historical deals parked at them must still read as something.
  awaiting_order_confirmation: "Order confirmation — to complete (retired step)",
  awaiting_oc_approval: "Order confirmation — awaiting approval (retired step)",
  awaiting_customer_sign: "Awaiting customer signature",
  awaiting_management_sign: "Awaiting management signature",
  awaiting_finance_handover: "To hand over to Finance",
  awaiting_finance_receipt: "Awaiting Finance receipt",
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

/**
 * What the papers are HEADED, which is a function of the stage and not of the
 * machine.
 *
 * ⚠ IT IS RESOLVED AT RENDER, NEVER STORED. One commercial act produces one
 *   document set: it goes out as an ORDER QUOTATION while it is still an offer,
 *   and the same set becomes the ORDER CONFIRMATION the moment the Directors
 *   approve it and the OC number is minted. `oc_no` is therefore the only test —
 *   a version frozen before approval keeps the heading it was issued under,
 *   because its stored payload was rendered when `oc_no` was still null.
 */
export function docHeading(deal: OcpiDeal): string {
  return deal.ocNo ? "ORDER CONFIRMATION" : "ORDER QUOTATION";
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

/**
 * The Indian financial year as an OC number spells it: Apr-2026 → `2627`.
 *
 * ⚠ A SECOND COPY OF `fms_ocpi_fy_code`, and it must stay identical to it. The
 *   database mints the real number; this exists so Settings can name which
 *   year's counter it is about to move before anything is minted.
 */
export function fyCode(d: Date = new Date()): string {
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return two(startYear) + two(startYear + 1);
}

/**
 * An order-confirmation number from its sequence value: 9 → `OTPL/OC/2627/0009`.
 *
 * ⚠ THE SAME KNOWN DUPLICATE AS `quotationNoFor`, and the more expensive one to
 *   get wrong. The authority is `fms_ocpi_decide_quotation`, which builds
 *   `'OTPL/OC/' || fy_code(current_date) || '/' || lpad(next_seq(...), 4, '0')`
 *   at the approval. Change that and change this to match.
 *
 * ⚠ THE OC SERIES RESTARTS EACH APRIL and the quotation series does not, which
 *   is why this takes a year and `quotationNoFor` does not.
 */
export function ocNoFor(seq: number, fy: string = fyCode()): string {
  return `OTPL/OC/${fy}/${String(Math.max(0, Math.trunc(seq))).padStart(4, "0")}`;
}
