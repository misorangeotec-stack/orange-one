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
  DeliveryStatus, DispatchOrder, DispatchRound, OrderLine, RoundItem,
} from "../types";

export interface RoundView {
  roundNo: number;
  /** True ⇒ this round is finished and immutable; corrections go through Amend. */
  isArchived: boolean;
  /** Present only on an archived round — the id needed to amend it. */
  roundId: string | null;
  roundStartedAt: string | null;
  companyId: string | null;

  msActualDate: string | null;
  msRemarks: string | null;
  msAt: string | null;
  msBy: string | null;

  sbActualDate: string | null;
  sbInvoiceNo: string | null;
  sbAttachmentPath: string | null;
  sbAttachmentName: string | null;
  sbRemarks: string | null;
  sbAt: string | null;
  sbBy: string | null;

  goActualDate: string | null;
  goOutwardNo: string | null;
  goRemarks: string | null;
  goAt: string | null;
  goBy: string | null;

  dcActualDate: string | null;
  dcStatus: DeliveryStatus | null;
  dcAttachmentPath: string | null;
  dcAttachmentName: string | null;
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
      unitId: l.unitId,
      unitName: null,
      orderedQty: l.quantity,
      shipQty: l.shipQty ?? 0,
      lotNo: l.lotNo,
    }));
}

/**
 * The round in progress, or null when the order is between nothing — closed,
 * cancelled, or (harmlessly) sitting at the credit check with nothing selected.
 */
export function currentRoundView(order: DispatchOrder): RoundView | null {
  if (order.status === "closed" || order.status === "cancelled") return null;
  return {
    roundNo: order.roundNo,
    isArchived: false,
    roundId: null,
    roundStartedAt: order.roundStartedAt,
    companyId: order.companyId,

    msActualDate: order.msActualDate,
    msRemarks: order.msRemarks,
    msAt: order.msAt,
    msBy: order.msBy,

    sbActualDate: order.sbActualDate,
    sbInvoiceNo: order.sbInvoiceNo,
    sbAttachmentPath: order.sbAttachmentPath,
    sbAttachmentName: order.sbAttachmentName,
    sbRemarks: order.sbRemarks,
    sbAt: order.sbAt,
    sbBy: order.sbBy,

    goActualDate: order.goActualDate,
    goOutwardNo: order.goOutwardNo,
    goRemarks: order.goRemarks,
    goAt: order.goAt,
    goBy: order.goBy,

    dcActualDate: order.dcActualDate,
    dcStatus: order.dcStatus,
    dcAttachmentPath: order.dcAttachmentPath,
    dcAttachmentName: order.dcAttachmentName,
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

    msActualDate: r.msActualDate,
    msRemarks: r.msRemarks,
    msAt: r.msAt,
    msBy: r.msBy,

    sbActualDate: r.sbActualDate,
    sbInvoiceNo: r.sbInvoiceNo,
    sbAttachmentPath: r.sbAttachmentPath,
    sbAttachmentName: r.sbAttachmentName,
    sbRemarks: r.sbRemarks,
    sbAt: r.sbAt,
    sbBy: r.sbBy,

    goActualDate: r.goActualDate,
    goOutwardNo: r.goOutwardNo,
    goRemarks: r.goRemarks,
    goAt: r.goAt,
    goBy: r.goBy,

    dcActualDate: r.dcActualDate,
    dcStatus: r.dcStatus,
    dcAttachmentPath: r.dcAttachmentPath,
    dcAttachmentName: r.dcAttachmentName,
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
