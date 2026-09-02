/**
 * What is ON a gate pass — the slip that leaves with the consignment.
 *
 * The paper version is a pre-printed leaf where someone writes the date, the
 * customer and the invoice number by hand and ticks MACHINE / SPARE PARTS /
 * HEAD / INK / OTHER. Everything on it is already in the order, so this states it
 * instead, with the exact items and quantities that were billed in place of the
 * tick-list.
 *
 * This file is the DATA half only. The slip is laid out and sent to the printer
 * in `printGatePass.ts` — it prints, it does not download; see the note there.
 */
import { billedQtyOf, type RoundView } from "./rounds";

export interface GatePassData {
  /** e.g. `OTEC-2608-001`. Null means no invoice yet — callers must not get here. */
  gpNo: string | null;
  companyName: string;
  /**
   * OUR site the consignment left from — the order's Dispatch location.
   *
   * ⚠ THE COUNTERPART TO `customerLocation`, NOT A SYNONYM. This one is a master
   *   naming one of our own places (SURAT / NOIDA); that one is free text saying
   *   where the buyer takes delivery. Both print on the slip, which is exactly
   *   why the customer's row is labelled CUSTOMER LOCATION rather than LOCATION.
   *   Null when the order has no location, and then no line is drawn at all.
   */
  companyLocation: string | null;
  customerName: string;
  /** Where the CUSTOMER takes delivery — free text on the order. */
  customerLocation: string | null;
  invoiceNo: string | null;
  /** The invoice date, ISO. Printed dd-mm-yyyy. */
  invoiceDateIso: string | null;
  orderNo: string;
  lines: { name: string; qty: number; unit: string | null }[];
}

/**
 * Turn a round into the slip's contents.
 *
 * ⚠ `itemName` IS REQUIRED, AND IS NOT OPTIONAL POLISH. `lib/rounds.ts`
 *   `liveItems()` returns `itemName: ""` — only the ARCHIVE freezes names, and a
 *   gate pass is printed at Gate Outward Entry, which is always the live round.
 *   Without this resolver every pass prints a blank Particulars column, which is
 *   precisely the part the printed pad exists to carry.
 */
export function gatePassFromRound(
  view: RoundView,
  meta: {
    orderNo: string;
    companyName: string;
    companyLocation: string | null;
    customerName: string;
    customerLocation: string | null;
    itemName: (id: string | null) => string;
  },
): GatePassData {
  return {
    gpNo: view.gpNo,
    companyName: meta.companyName,
    companyLocation: meta.companyLocation,
    customerName: meta.customerName,
    customerLocation: meta.customerLocation,
    invoiceNo: view.sbInvoiceNo,
    invoiceDateIso: view.sbActualDate,
    orderNo: meta.orderNo,
    /*
      ⚠ THE BILLED QUANTITY, NOT THE PICKED ONE. The slip travels with the
        invoice and is checked against it at the gate, so it must state what was
        invoiced. A line released but left off the bill carries no quantity at
        all and drops off the slip entirely — it is not on this consignment's
        paperwork, and printing it would put a figure in a guard's hand that no
        invoice backs.
    */
    lines: view.items
      .filter((i) => billedQtyOf(i) > 0)
      .map((i) => ({
        // The frozen name on a reprint of an archived round, the master's
        // current name on a live one. Both are right for their case: history
        // should not be rewritten by a rename, and a live round has no snapshot.
        name: i.itemName || meta.itemName(i.itemId) || "Item",
        qty: billedQtyOf(i),
        unit: i.unitName,
      })),
  };
}

