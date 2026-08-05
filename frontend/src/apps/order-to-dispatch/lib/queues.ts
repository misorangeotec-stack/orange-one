/**
 * The single source of truth for Order to Dispatch FMS queue membership and due
 * dates.
 *
 * Pure: takes a snapshot, returns plain data, knows nothing about the signed-in
 * user. The per-step queue pages, this app's Control Center, the cross-FMS
 * scoreboard and the My Work provider all consume these, so their counts cannot
 * drift. "Mine vs All" is applied by the PAGE, never here — the Control Center
 * must count everyone's work.
 *
 * PENDING membership is STATUS-DRIVEN and an order sits at exactly one open step
 * at a time — that stays true with rounds, because an order has exactly one round
 * in progress.
 *
 * COMPLETED entries are ROUND-SCOPED. An order that has looped three times has
 * three sales bills, and each is its own row. See `completedFor`.
 */
import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import { dueIsoFrom, type StepSlaMap } from "./sla";
import { allRoundViews, currentRoundView, type RoundView } from "./rounds";
import type { StepKey } from "./steps";
import type { DispatchOrder, DispatchStatus } from "../types";

/** Every step that owns a queue (all but the origin `sales_order`). */
export type QueueStep = Exclude<StepKey, "sales_order">;

export interface DispatchSnapshot {
  orders: DispatchOrder[];
  stepSla: StepSlaMap;
}

/** THE ONE snapshot builder — the store, the adapter and My Work all go through it. */
export function dispatchSnapshotFrom(data: { orders: DispatchOrder[]; stepSla: StepSlaMap }): DispatchSnapshot {
  return { orders: data.orders, stepSla: data.stepSla };
}

export interface QueueEntry extends QueueEntryBase<StepKey> {
  entityType: "order";
  orderId: string;
}

/* -------------------------------------------------------------------------- */
/*  Per-step accessors — the one place a step maps to its columns.            */
/* -------------------------------------------------------------------------- */

/** The step's own completion timestamp on the LIVE order (the round in progress). */
const AT: Record<QueueStep, (o: DispatchOrder) => string | null> = {
  credit_check: (o) => o.ccAt,
  material_status: (o) => o.msAt,
  sales_bill: (o) => o.sbAt,
  gate_out: (o) => o.goAt,
  dispatch_confirm: (o) => o.dcAt,
};

/** The same four steps read off ANY round — live or archived. */
const ROUND_AT: Record<Exclude<QueueStep, "credit_check">, (v: RoundView) => string | null> = {
  material_status: (v) => v.msAt,
  sales_bill: (v) => v.sbAt,
  gate_out: (v) => v.goAt,
  dispatch_confirm: (v) => v.dcAt,
};

const ROUND_BY: Record<Exclude<QueueStep, "credit_check">, (v: RoundView) => string | null> = {
  material_status: (v) => v.msBy,
  sales_bill: (v) => v.sbBy,
  gate_out: (v) => v.goBy,
  dispatch_confirm: (v) => v.dcBy,
};

/** Who completed the step, on the live order. */
const BY: Record<QueueStep, (o: DispatchOrder) => string | null> = {
  credit_check: (o) => o.ccBy,
  material_status: (o) => o.msBy,
  sales_bill: (o) => o.sbBy,
  gate_out: (o) => o.goBy,
  dispatch_confirm: (o) => o.dcBy,
};

/**
 * The anchor whose completion starts a step's SLA clock, for a GIVEN ROUND.
 *
 * ⚠ Two of these are round-scoped for a reason, and getting either wrong is the
 *   most damaging bug available in this module:
 *
 *   material_status anchors on the ROUND START, not on the order receipt. On
 *   round 2 the order was received weeks ago; anchoring there would make every
 *   looped order permanently overdue from the moment it loops — red in the
 *   queue, in My Work and on the scoreboard, for ever.
 *
 *   The rest anchor on the previous step OF THE SAME ROUND, so a historic round
 *   reports its own planned dates rather than the current round's. Without that
 *   every old row in the register reads "0 days late".
 *
 * The 12PM same-day cut-off now applies to the moment the order (re)entered the
 * store's queue, which for round 1 is still the order receipt. lib/sla.ts says
 * the same thing; the two must stay in step.
 */
const ANCHOR_AT: Record<QueueStep, (o: DispatchOrder, v: RoundView | null) => string | null> = {
  credit_check: (o) => o.ccDecidedAt ?? o.submittedAt,
  material_status: (o, v) => v?.roundStartedAt ?? o.roundStartedAt,
  sales_bill: (_o, v) => v?.msAt ?? null,
  gate_out: (_o, v) => v?.sbAt ?? null,
  dispatch_confirm: (_o, v) => v?.goAt ?? null,
};

/** status → the single step an order currently owes. */
const STATUS_STEP: Partial<Record<DispatchStatus, QueueStep>> = {
  awaiting_credit_check: "credit_check",
  awaiting_material_status: "material_status",
  awaiting_sales_bill: "sales_bill",
  awaiting_gate_out: "gate_out",
  awaiting_dispatch_confirm: "dispatch_confirm",
};

/** Edit-lock rules per step — mirror the `fms_dispatch_<pfx>_editable()` predicates. */
const LOCK: Record<QueueStep, { open: DispatchStatus; what: string; nextWhat: string }> = {
  credit_check:     { open: "awaiting_material_status",  what: "credit confirmation",   nextWhat: "the material-status check" },
  material_status:  { open: "awaiting_sales_bill",       what: "material status",       nextWhat: "the sales bill" },
  sales_bill:       { open: "awaiting_gate_out",         what: "sales bill",            nextWhat: "the gate outward entry" },
  gate_out:         { open: "awaiting_dispatch_confirm", what: "gate outward entry",    nextWhat: "the delivery confirmation" },
  dispatch_confirm: { open: "closed",                    what: "delivery confirmation", nextWhat: "" },
};

/** The step's own completion timestamp / actor on the round in progress. */
export const stepDoneAt = (step: QueueStep, o: DispatchOrder): string | null => AT[step](o);
export const stepDoneBy = (step: QueueStep, o: DispatchOrder): string | null => BY[step](o);

/** Still someone's work — a held / closed / cancelled order leaves every queue. */
export const isOpenOrder = (o: DispatchOrder): boolean => STATUS_STEP[o.status] !== undefined;

/** The single step an order currently owes, from its status. */
export function openStep(o: DispatchOrder): QueueStep | null {
  return STATUS_STEP[o.status] ?? null;
}

/** An order's due date for one step = its anchor's completion + the step's rule. */
export function dispatchDueIso(
  snap: DispatchSnapshot,
  o: DispatchOrder,
  step: QueueStep,
  view?: RoundView | null,
): string | null {
  const sla = snap.stepSla[step];
  if (!sla) return null;
  const v = view === undefined ? currentRoundView(o) : view;
  const from = ANCHOR_AT[step](o, v) ?? v?.roundStartedAt ?? o.roundStartedAt;
  return dueIsoFrom(from, sla);
}

/* -------------------------------------------------------------------------- */
/*  Completed entries — the "what I did here" side of a stage                  */
/* -------------------------------------------------------------------------- */

export interface StageEntry<T> {
  /**
   * ⚠ ROUND-UNIQUE. This is `QueueTable`'s React key; an order that has looped
   *   contributes one row per round to the same tab, so keying on the order id
   *   alone would collide the moment anything ships in two goes.
   */
  id: string;
  stepKey: StepKey;
  orderId: string;
  ref: string;
  roundNo: number;
  /** The round this row describes — what the modal must open, not the header. */
  view: RoundView;
  actorId: string | null;
  atIso: string;
  editedAtIso: string | null;
  editedById: string | null;
  lockReason: string | null;
  row: T;
}

/**
 * Every rule below mirrors its `fms_dispatch_<pfx>_editable()` counterpart in the
 * DB. The server is the gate; these exist so the UI can grey a button and SAY WHY.
 * `on_hold` and `cancelled` lock everything.
 */
export function lockReasonFor(step: QueueStep, o: DispatchOrder): string | null {
  const { open, what, nextWhat } = LOCK[step];
  if (o.status === "on_hold") return `This order is on hold — take it off hold before editing its ${what}.`;
  if (o.status === "cancelled") return `This order was cancelled — its ${what} can no longer be changed.`;
  if (step === "credit_check" && o.status === "awaiting_credit_check") {
    return "This credit decision is still open — record it from the Pending tab instead.";
  }
  // Delivery confirmation is the last step of a round; nothing downstream locks
  // it while the round is still live.
  if (step === "dispatch_confirm") {
    return o.status === "closed" ? null : null;
  }
  if (o.status !== open) {
    return `${nextWhat[0].toUpperCase()}${nextWhat.slice(1)} has already been recorded — the ${what} can no longer be changed.`;
  }
  return null;
}

/** What an archived round says when someone tries to edit it in place. */
const ARCHIVED_LOCK = (roundNo: number) =>
  `Round ${roundNo} is finished — open the order and use "Correct this round" to change what was delivered.`;

/**
 * Every completed entry for one step — what the stage view's Completed tab renders.
 *
 * ⚠ Credit is decided ONCE PER ORDER, so it yields at most one row however many
 *   rounds an order has. The other four are per round, and MUST read the archive
 *   as well as the live header: the moment an order loops, its header is wiped,
 *   and a header-only read would make every earlier round's work vanish from the
 *   screen, from the throughput card and from the register.
 */
export function completedFor(snap: DispatchSnapshot, step: QueueStep): StageEntry<DispatchOrder>[] {
  const out: StageEntry<DispatchOrder>[] = [];

  for (const o of snap.orders) {
    if (step === "credit_check") {
      if (!o.ccAt) continue;
      out.push({
        id: `${o.id}:0:credit_check`,
        stepKey: step,
        orderId: o.id,
        ref: o.orderNo,
        roundNo: 0,
        view: currentRoundView(o) ?? { ...EMPTY_VIEW, roundNo: o.roundNo },
        actorId: o.ccBy,
        atIso: o.ccAt,
        editedAtIso: o.ccEditedAt,
        editedById: o.ccEditedBy,
        lockReason: lockReasonFor(step, o),
        row: o,
      });
      continue;
    }

    const at = ROUND_AT[step];
    const by = ROUND_BY[step];
    for (const v of allRoundViews(o)) {
      const done = at(v);
      if (!done) continue;
      out.push({
        id: `${o.id}:${v.roundNo}:${step}`,
        stepKey: step,
        orderId: o.id,
        ref: o.orderNo,
        roundNo: v.roundNo,
        view: v,
        actorId: by(v),
        atIso: done,
        editedAtIso: v.editedAt,
        editedById: v.editedBy,
        lockReason: v.isArchived ? ARCHIVED_LOCK(v.roundNo) : lockReasonFor(step, o),
        row: o,
      });
    }
  }
  return out;
}

/** Placeholder for the impossible case of a credit row on an order with no live round. */
const EMPTY_VIEW: RoundView = {
  roundNo: 1, isArchived: true, roundId: null, roundStartedAt: null, companyId: null,
  msActualDate: null, msTempoNo: null, msPorter: null, msRemarks: null, msAt: null, msBy: null,
  sbActualDate: null, sbInvoiceNo: null, sbAttachmentPath: null, sbAttachmentName: null,
  sbRemarks: null, sbAt: null, sbBy: null,
  goActualDate: null, goOutwardNo: null, goRemarks: null, goAt: null, goBy: null,
  dcActualDate: null, dcStatus: null, dcAttachmentPath: null, dcAttachmentName: null,
  dcRemarks: null, dcAt: null, dcBy: null,
  editedAt: null, editedBy: null, amendedAt: null, amendReason: null, items: [],
};

/** Every open work-item, one per (current step, order). */
export function buildQueueEntries(snap: DispatchSnapshot): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const o of snap.orders) {
    const step = openStep(o);
    if (!step) continue;
    out.push({
      stepKey: step,
      entityType: "order",
      entityId: o.id,
      ref: o.orderNo,
      dueIso: dispatchDueIso(snap, o, step),
      orderId: o.id,
    });
  }
  return out;
}
