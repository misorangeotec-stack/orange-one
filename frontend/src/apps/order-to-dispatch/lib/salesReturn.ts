/**
 * The Sales Return step, as plain predicates.
 *
 * Pure: takes an order, returns a boolean. No React, no store — same contract as
 * lib/queues.ts and lib/rounds.ts, so the queue page, the order page, My Work
 * and the Control Center chip all read one definition of "still owed".
 *
 * ⚠ THERE IS NO CLOCK IN HERE, AND THERE MUST NOT BE. Whether a raised invoice
 *   can still be cancelled outright or needs a sales return against it is a
 *   judgement made against Tally and GST, offline, by the person doing it. The
 *   app records which of the two happened; it never computes it, never times a
 *   24-hour window, and never shows a deadline. If a future change wants to
 *   "help" by deriving the mode from `srInvoiceAt`, that is the thing this
 *   comment exists to argue against.
 */
import { allRoundViews, roundViewNo, type RoundView } from "./rounds";
import type { DispatchOrder, RoundReturn } from "../types";

/** Cancelled after a bill was raised, and the invoice has not been unwound yet. */
export const isSalesReturnPending = (o: DispatchOrder): boolean =>
  o.status === "awaiting_sales_return" && o.srAt == null;

/** The invoice was unwound and the order is cancelled. */
export const isSalesReturnDone = (o: DispatchOrder): boolean => o.srAt != null;

/**
 * Did this cancellation ever involve an invoice at all?
 *
 * True for both the pending and the settled case, so the order page can decide
 * whether to show the sales-return card without repeating the status test. An
 * order cancelled before its bill was raised has nothing here.
 */
export const hasSalesReturn = (o: DispatchOrder): boolean =>
  o.srInvoiceAt != null || o.srAt != null;

/**
 * The round whose invoice is being unwound — where the invoice PDF, the e-way
 * bill and the gate pass live.
 *
 * Before the return is recorded that round is still LIVE (the archive is
 * deliberately deferred, so the invoice stays readable); afterwards it is in the
 * archive. `roundViewNo` spans both, which is the whole point of `RoundView`.
 */
export const salesReturnRound = (o: DispatchOrder): RoundView | null =>
  o.srRoundNo == null ? null : roundViewNo(o, o.srRoundNo);

/* -------------------------------------------------------------------------- */
/*  Returns against an invoice that has LEFT THE GATE (migration 20261230120000) */
/* -------------------------------------------------------------------------- */

/**
 * Where one round's invoice stands for a new sales return:
 *   · "ok"       — it has left the gate: the round in progress awaiting delivery
 *                  confirmation, or any finished round, on an open or closed order;
 *   · "in_plant" — billed but not yet out of the gate. Listed, but refused: the
 *                  route there is Cancel order, which reaches Sales Return itself;
 *   · null       — not an invoice this flow can touch (no bill yet, or one a
 *                  cancellation is already unwinding).
 *
 * Mirrors the refusals in `fms_dispatch_request_round_return` one for one.
 */
export type InvoiceReturnState = "ok" | "in_plant";

export function invoiceReturnState(o: DispatchOrder, v: RoundView): InvoiceReturnState | null {
  if (!v.sbInvoiceNo) return null;
  // An archived round with no delivery outcome was archived by a cancellation.
  if (v.isArchived) return v.dcStatus ? "ok" : null;
  if (o.status === "cancelled" || o.status === "awaiting_sales_return") return null;
  return v.goAt ? "ok" : "in_plant";
}

/** The return still in force on an invoice — pending or recorded — if any. */
export const liveReturnFor = (
  orderId: string, roundNo: number, returns: RoundReturn[],
): RoundReturn | undefined =>
  returns.find((x) => x.orderId === orderId && x.roundNo === roundNo && x.status !== "withdrawn");

/** Every invoice on this order with no return in force yet, and where it stands. */
export const returnCandidates = (
  o: DispatchOrder, returns: RoundReturn[],
): { view: RoundView; state: InvoiceReturnState }[] =>
  allRoundViews(o).flatMap((view) => {
    const state = invoiceReturnState(o, view);
    return state && !liveReturnFor(o.id, view.roundNo, returns) ? [{ view, state }] : [];
  });
