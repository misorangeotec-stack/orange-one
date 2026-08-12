/**
 * ONE shape for "a dispatch round", whether it is finished or still running.
 *
 * THE PROBLEM THIS SOLVES
 *   The order row holds the round in progress; finished rounds live in
 *   `fms_dispatch_rounds`. Those are two different row shapes describing the
 *   same thing. Without a projection, every consumer — the Completed tabs, the
 *   dashboard tiles, the register export, the step modal — would have to branch
 *   on "is this the live one?", and each would get it subtly wrong.
 *
 * So: the live header projects into `RoundView`, an archived row projects into
 * `RoundView`, and nothing downstream can tell (or needs to tell) them apart.
 *
 * ⚠ `currentRoundView` returns NULL when there is no round in progress — which
 *   is the case for every closed and cancelled order, because the RPC archives
 *   AND wipes the header in the same transaction. Appending it unconditionally
 *   would list the final round twice: once from the archive, once from the
 *   stale header. Every count in the app would double.
 *
 * This module stays PURE — no React, no store import.
 */
import type {
  CreditStatus, DeliveryStatus, DispatchOrder, DispatchRound, OrderLine, RoundItem, StepDoc,
} from "../types";

export interface RoundView {
  roundNo: number;
  /** True ⇒ this round is finished and immutable; corrections go through Amend. */
  isArchived: boolean;
  /** Present only on an archived round — the id needed to amend it. */
  roundId: string | null;
  roundStartedAt: string | null;
  /**
   * ⚠ ORDER-scoped in everything but name. The company is chosen at intake and
   *   is the same on every round; the archive keeps its own copy purely so a
   *   historic round stays self-describing. Both projections below source it
   *   from their own row, which agree by construction.
   */
  companyId: string | null;
  /** ORDER-scoped too, and frozen onto the archive for the same reason. */
  locationId: string | null;

  /**
   * The credit decision MADE IN THIS ROUND, or null when the round ran under a
   * decision an earlier round had already made.
   *
   * ⚠ THIS IS NOT "the decision governing the order" — for that, read the order
   *   header. The two answer different questions and the difference is visible:
   *   a partial approval large enough to cover two rounds is recorded against
   *   the first only, so the Completed tab lists one row per DECISION rather
   *   than one per round that happened to run under it.
   */
  ccStatus: CreditStatus | null;
  ccApprovedQty: number | null;
  ccRemarks: string | null;
  ccAt: string | null;
  ccBy: string | null;

  msActualDate: string | null;
  /** The vehicle that carried THIS round. Optional. */
  msTempoNo: string | null;
  /** Whether THIS round went by porter. Null ⇒ unanswered. */
  msPorter: boolean | null;
  msRemarks: string | null;
  msAt: string | null;
  msBy: string | null;

  sbActualDate: string | null;
  sbInvoiceNo: string | null;
  sbAttachmentPath: string | null;
  sbAttachmentName: string | null;
  /** The e-way bill that went with this invoice, when one was needed. */
  sbEwayPath: string | null;
  sbEwayName: string | null;
  sbRemarks: string | null;
  sbAt: string | null;
  sbBy: string | null;
  /**
   * The gate pass issued for this round's invoice.
   *
   * ⚠ NO ROUND-OWNERSHIP TEST, unlike the `cc*` fields above. A credit decision
   *   can span several rounds, so those have to ask whether THIS round made it;
   *   `gp_no` is cleared on archive, so whatever the header holds always belongs
   *   to the round in progress.
   */
  gpNo: string | null;

  goActualDate: string | null;
  goOutwardNo: string | null;
  goRemarks: string | null;
  goAt: string | null;
  goBy: string | null;

  dcActualDate: string | null;
  dcStatus: DeliveryStatus | null;
  dcAttachmentPath: string | null;
  dcAttachmentName: string | null;
  /** Pages 2..N of the receiver copy. Page one is the pair above, not in here. */
  dcAttachmentPages: StepDoc[];
  dcRemarks: string | null;
  dcAt: string | null;
  dcBy: string | null;

  editedAt: string | null;
  editedBy: string | null;
  amendedAt: string | null;
  amendReason: string | null;

  /** What is going out (live) or what went out (archived). */
  items: RoundItem[];
}

/** How much of a line is still owed. */
export const pendingQtyOf = (l: OrderLine): number =>
  Math.max(l.quantity - l.dispatchedQty, 0);

/** A line nobody needs to touch again. */
export const isLineComplete = (l: OrderLine): boolean => pendingQtyOf(l) <= 0;

/** What the customer asked for, across every line. */
export const orderedTotalOf = (o: DispatchOrder): number =>
  o.lines.reduce((a, l) => a + (Number(l.quantity) || 0), 0);

/** Delivered so far, across every line and every round. */
export const dispatchedTotalOf = (o: DispatchOrder): number =>
  o.lines.reduce((a, l) => a + (Number(l.dispatchedQty) || 0), 0);

/** Still owed. `qtyTotals` returns this too — use that when you want all four. */
export const pendingTotalOf = (o: DispatchOrder): number =>
  o.lines.reduce((a, l) => a + pendingQtyOf(l), 0);

/**
 * How much may still go out under the credit decision governing this order.
 *
 * ⚠ NULL MEANS UNCAPPED, and every caller must treat it that way. Every order
 *   raised before partial approval existed has a null `ccApprovedQty`, and
 *   reading that as "nothing authorised" would freeze the whole back catalogue.
 */
export const creditHeadroomOf = (o: DispatchOrder): number | null =>
  o.ccApprovedQty == null ? null : Math.max(o.ccApprovedQty - dispatchedTotalOf(o), 0);

/**
 * The live header's selected lines, in the same shape the archive stores.
 * `itemName` / `unitName` are resolved by the caller for the live case (the
 * archive freezes them at dispatch time so history survives a master rename).
 */
function liveItems(order: DispatchOrder): RoundItem[] {
  return order.lines
    .filter((l) => (l.shipQty ?? 0) > 0)
    .map((l) => ({
      id: l.id,
      roundId: "",
      orderItemId: l.id,
      lineNo: l.lineNo,
      itemId: l.itemId,
      itemName: "",
      unitName: l.unit,
      orderedQty: l.quantity,
      shipQty: l.shipQty ?? 0,
      lotNo: l.lotNo,
    }));
}

/**
 * The round in progress, or null when the order is between nothing — closed,
 * cancelled, or (harmlessly) sitting at the credit check with nothing selected.
 *
 * ⚠ `awaiting_sales_return` IS DELIBERATELY ABSENT FROM THE GUARD BELOW, and
 *   that omission is load-bearing in both directions.
 *
 *   A cancellation waiting on its sales return has NOT had its round archived —
 *   `fms_dispatch_cancel_order` defers that to `record_sales_return`, precisely
 *   so the invoice number stays readable on the Sales Return screen. The round
 *   really is still live, so it must still project here; adding the status would
 *   blank the very screen the deferral exists to feed.
 *
 *   Equally, it must not be added "for tidiness" once the return IS recorded:
 *   by then the status is `cancelled` and the first clause already covers it. If
 *   the archive had instead happened at request time, this same line would have
 *   double-counted the round — once from the archive, once from the stale header
 *   — which is the failure this file's header warning describes.
 */
export function currentRoundView(order: DispatchOrder): RoundView | null {
  if (order.status === "closed" || order.status === "cancelled") return null;
  // Credit only belongs to this round if this round is what it was decided for.
  // An order looping under an earlier approval carries that approval on its
  // header but must project NO decision here, or the Completed tab would grow a
  // fresh credit row on every lap.
  const ownCredit = order.ccRoundNo === order.roundNo;
  return {
    roundNo: order.roundNo,
    isArchived: false,
    roundId: null,
    roundStartedAt: order.roundStartedAt,
    companyId: order.companyId,
    locationId: order.locationId,

    ccStatus: ownCredit ? order.ccStatus : null,
    ccApprovedQty: ownCredit ? order.ccApprovedQty : null,
    ccRemarks: ownCredit ? order.ccRemarks : null,
    ccAt: ownCredit ? order.ccAt : null,
    ccBy: ownCredit ? order.ccBy : null,

    msActualDate: order.msActualDate,
    msTempoNo: order.msTempoNo,
    msPorter: order.msPorter,
    msRemarks: order.msRemarks,
    msAt: order.msAt,
    msBy: order.msBy,

    sbActualDate: order.sbActualDate,
    sbInvoiceNo: order.sbInvoiceNo,
    sbAttachmentPath: order.sbAttachmentPath,
    sbAttachmentName: order.sbAttachmentName,
    sbEwayPath: order.sbEwayPath,
    sbEwayName: order.sbEwayName,
    sbRemarks: order.sbRemarks,
    sbAt: order.sbAt,
    sbBy: order.sbBy,
    gpNo: order.gpNo,

    goActualDate: order.goActualDate,
    goOutwardNo: order.goOutwardNo,
    goRemarks: order.goRemarks,
    goAt: order.goAt,
    goBy: order.goBy,

    dcActualDate: order.dcActualDate,
    dcStatus: order.dcStatus,
    dcAttachmentPath: order.dcAttachmentPath,
    dcAttachmentName: order.dcAttachmentName,
    dcAttachmentPages: order.dcAttachmentPages,
    dcRemarks: order.dcRemarks,
    dcAt: order.dcAt,
    dcBy: order.dcBy,

    editedAt: order.editedAt,
    editedBy: order.editedBy,
    amendedAt: null,
    amendReason: null,

    items: liveItems(order),
  };
}

/** An archived round, projected into the same shape. */
export function archivedRoundView(r: DispatchRound): RoundView {
  return {
    roundNo: r.roundNo,
    isArchived: true,
    roundId: r.id,
    roundStartedAt: r.roundStartedAt,
    companyId: r.companyId,
    locationId: r.locationId,

    ccStatus: r.ccStatus,
    ccApprovedQty: r.ccApprovedQty,
    ccRemarks: r.ccRemarks,
    ccAt: r.ccAt,
    ccBy: r.ccBy,

    msActualDate: r.msActualDate,
    msTempoNo: r.msTempoNo,
    msPorter: r.msPorter,
    msRemarks: r.msRemarks,
    msAt: r.msAt,
    msBy: r.msBy,

    sbActualDate: r.sbActualDate,
    sbInvoiceNo: r.sbInvoiceNo,
    sbAttachmentPath: r.sbAttachmentPath,
    sbAttachmentName: r.sbAttachmentName,
    sbEwayPath: r.sbEwayPath,
    sbEwayName: r.sbEwayName,
    sbRemarks: r.sbRemarks,
    sbAt: r.sbAt,
    sbBy: r.sbBy,
    gpNo: r.gpNo,

    goActualDate: r.goActualDate,
    goOutwardNo: r.goOutwardNo,
    goRemarks: r.goRemarks,
    goAt: r.goAt,
    goBy: r.goBy,

    dcActualDate: r.dcActualDate,
    dcStatus: r.dcStatus,
    dcAttachmentPath: r.dcAttachmentPath,
    dcAttachmentName: r.dcAttachmentName,
    dcAttachmentPages: r.dcAttachmentPages,
    dcRemarks: r.dcRemarks,
    dcAt: r.dcAt,
    dcBy: r.dcBy,

    editedAt: r.editedAt,
    editedBy: r.editedBy,
    amendedAt: r.amendedAt,
    amendReason: r.amendReason,

    items: r.items,
  };
}

/**
 * Every round of an order, oldest first — the archive plus the live one if there
 * is one. THE list to iterate for anything historical.
 */
export function allRoundViews(order: DispatchOrder): RoundView[] {
  const out = order.rounds.map(archivedRoundView);
  const live = currentRoundView(order);
  if (live) out.push(live);
  return out.sort((a, b) => a.roundNo - b.roundNo);
}

/** One round by number, for deep links and the detail page. */
export const roundViewNo = (order: DispatchOrder, roundNo: number): RoundView | null =>
  allRoundViews(order).find((v) => v.roundNo === roundNo) ?? null;

/** Totals for one round's consignment. */
export const roundShipTotal = (v: RoundView): number =>
  v.items.reduce((a, i) => a + (Number(i.shipQty) || 0), 0);

/** Has this order ever been split across more than one consignment? */
export const isMultiRound = (o: DispatchOrder): boolean =>
  o.rounds.length > 0 || o.roundNo > 1;

/** Delivered rounds across the whole order — what the dashboard counts. */
export const deliveredRounds = (o: DispatchOrder): RoundView[] =>
  allRoundViews(o).filter((v) => v.dcStatus === "delivered" && !!v.dcAt);
