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
import type { RoundItem } from "../types";

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
  lines: GatePassLine[];
}

/** One billed item on the slip, with the lots it went out from. */
export interface GatePassLine {
  name: string;
  /** The BILLED quantity of the whole line. */
  qty: number;
  unit: string | null;
  /**
   * Its lots, in pick order. Empty when no lot was recorded. `qty` per lot is set
   * only when the split adds up to the billed figure — otherwise the slip prints
   * the line's quantity once against all its lots rather than invent a split.
   */
  lots: { lotNo: string; expiryIso: string | null; qty: number | null }[];
}

/** Resolves a lot's expiry (ISO) — Tally first, then typed. Null = unknown. */
export type ExpiryOf = (itemId: string | null, itemName: string, lotNo: string) => string | null;

/** The lots a round item went out from, best record first (see LotAllocation). */
export function lotsOfItem(i: RoundItem): { lotNo: string; qty: number | null }[] {
  if (i.lots.length > 0) {
    return [...i.lots]
      .sort((a, b) => a.seq - b.seq)
      .filter((l) => l.lotNo.trim() !== "")
      .map((l) => ({ lotNo: l.lotNo.trim(), qty: l.qty }));
  }
  // Pre-OD-15 lines: the typed text, whole — never parsed.
  return i.lotNo?.trim() ? [{ lotNo: i.lotNo.trim(), qty: null }] : [];
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
    /** Omitted ⇒ every expiry prints blank. */
    expiryOf?: ExpiryOf;
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
      .map((i): GatePassLine => {
        // The frozen name on a reprint of an archived round, the master's
        // current name on a live one. Both are right for their case: history
        // should not be rewritten by a rename, and a live round has no snapshot.
        const name = i.itemName || meta.itemName(i.itemId) || "Item";
        const billed = billedQtyOf(i);
        const lots = lotsOfItem(i);
        /*
          ⚠ PER-LOT QUANTITIES ONLY WHEN THEY ADD UP TO THE BILL. The split was
            recorded against what was SHIPPED; the slip states what was BILLED.
            When the two differ (or a lot has no figure) the per-lot numbers
            would not sum to the line, so they are dropped, not printed.
        */
        const single = lots.length === 1;
        const sum = lots.reduce((a, l) => a + (l.qty ?? NaN), 0);
        const splitHolds = !single && lots.length > 0 && Math.abs(sum - billed) < 0.001;
        return {
          name,
          qty: billed,
          unit: i.unitName,
          lots: lots.map((l) => ({
            lotNo: l.lotNo,
            expiryIso: meta.expiryOf?.(i.itemId, name, l.lotNo) ?? null,
            qty: single ? billed : splitHolds ? l.qty : null,
          })),
        };
      }),
  };
}

