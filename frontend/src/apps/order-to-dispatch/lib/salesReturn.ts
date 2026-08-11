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
import { roundViewNo, type RoundView } from "./rounds";
import type { DispatchOrder } from "../types";

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
