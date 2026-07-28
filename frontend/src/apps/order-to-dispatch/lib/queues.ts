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
 * Membership is STATUS-DRIVEN (the RPCs set `status`), and the chain is strictly
 * linear, so an order sits at exactly one open step at a time.
 */
import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import { dueIsoFrom, type StepSlaMap } from "./sla";
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

/** The step's own completion timestamp (`*At`). */
const AT: Record<QueueStep, (o: DispatchOrder) => string | null> = {
  credit_check: (o) => o.ccAt,
  material_status: (o) => o.msAt,
  lot_confirm: (o) => o.lcAt,
  sales_bill: (o) => o.sbAt,
  gate_out: (o) => o.goAt,
  dispatch_confirm: (o) => o.dcAt,
};

/** Who completed the step (`*By`). */
const BY: Record<QueueStep, (o: DispatchOrder) => string | null> = {
  credit_check: (o) => o.ccBy,
  material_status: (o) => o.msBy,
  lot_confirm: (o) => o.lcBy,
  sales_bill: (o) => o.sbBy,
  gate_out: (o) => o.goBy,
  dispatch_confirm: (o) => o.dcBy,
};

/**
 * The anchor whose completion starts a step's SLA clock.
 *
 * `material_status` deliberately anchors on the ORDER RECEIPT, not on the credit
 * confirmation before it: the sheet's rule is "order received before 12PM →
 * same-day dispatch", so the clock starts when the order arrived. lib/sla.ts
 * declares the matching `same_day_cutoff` unit; the two must stay in step.
 */
const ANCHOR_AT: Record<QueueStep, (o: DispatchOrder) => string | null> = {
  credit_check: (o) => o.submittedAt,
  material_status: (o) => o.submittedAt,
  lot_confirm: (o) => o.msAt,
  sales_bill: (o) => o.lcAt,
  gate_out: (o) => o.sbAt,
  dispatch_confirm: (o) => o.goAt,
};

/** status → the single step an order currently owes. */
const STATUS_STEP: Partial<Record<DispatchStatus, QueueStep>> = {
  awaiting_credit_check: "credit_check",
  awaiting_material_status: "material_status",
  awaiting_lot_confirm: "lot_confirm",
  awaiting_sales_bill: "sales_bill",
  awaiting_gate_out: "gate_out",
  awaiting_dispatch_confirm: "dispatch_confirm",
};

/** Edit-lock rules per step — mirror the `fms_dispatch_<pfx>_editable()` predicates. */
const LOCK: Record<QueueStep, { open: DispatchStatus; what: string; nextWhat: string }> = {
  credit_check:     { open: "awaiting_material_status",  what: "credit confirmation",   nextWhat: "the material-status check" },
  material_status:  { open: "awaiting_lot_confirm",      what: "material status",       nextWhat: "LOT confirmation" },
  lot_confirm:      { open: "awaiting_sales_bill",       what: "LOT confirmation",      nextWhat: "the sales bill" },
  sales_bill:       { open: "awaiting_gate_out",         what: "sales bill",            nextWhat: "the gate-out entry" },
  gate_out:         { open: "awaiting_dispatch_confirm", what: "gate-out entry",        nextWhat: "the delivery confirmation" },
  dispatch_confirm: { open: "closed",                    what: "delivery confirmation", nextWhat: "" },
};

/** The step's own completion timestamp / actor — for the detail progress panel. */
export const stepDoneAt = (step: QueueStep, o: DispatchOrder): string | null => AT[step](o);
export const stepDoneBy = (step: QueueStep, o: DispatchOrder): string | null => BY[step](o);

/** Still someone's work — a held / closed / cancelled order leaves every queue. */
export const isOpenOrder = (o: DispatchOrder): boolean => STATUS_STEP[o.status] !== undefined;

/** The single step an order currently owes, from its status. */
export function openStep(o: DispatchOrder): QueueStep | null {
  return STATUS_STEP[o.status] ?? null;
}

/** An order's due date for one step = its anchor's completion + the step's rule. */
export function dispatchDueIso(snap: DispatchSnapshot, o: DispatchOrder, step: QueueStep): string | null {
  const sla = snap.stepSla[step];
  if (!sla) return null;
  const from = ANCHOR_AT[step](o) ?? o.submittedAt;
  return dueIsoFrom(from, sla);
}

/**
 * The date the customer was PROMISED, which is not an internal SLA and is not
 * derived from one. Present only when Sales committed to a date.
 */
export const promisedIso = (o: DispatchOrder): string | null => o.promisedDate;

/**
 * Is the promise to the customer already broken? True once the promised date has
 * passed with the consignment still inside the plant (no gate-out recorded).
 * Cancelled orders can't breach anything.
 */
export function isTatBreached(o: DispatchOrder, todayIso: string): boolean {
  if (!o.promisedDate) return false;
  if (o.status === "cancelled") return false;
  if (o.goAt) return false;
  return o.promisedDate < todayIso;
}

/* -------------------------------------------------------------------------- */
/*  Completed entries — the "what I did here" side of a stage                  */
/* -------------------------------------------------------------------------- */

export interface StageEntry<T> {
  id: string;
  stepKey: StepKey;
  orderId: string;
  ref: string;
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
  // Delivery confirmation is the last step; nothing downstream can lock it, so it
  // stays correctable after the order closes.
  if (step === "dispatch_confirm") return null;
  if (o.status !== open) {
    return `${nextWhat[0].toUpperCase()}${nextWhat.slice(1)} has already been recorded — the ${what} can no longer be changed.`;
  }
  return null;
}

/** Every completed entry for one step — what the stage view's Completed tab renders. */
export function completedFor(snap: DispatchSnapshot, step: QueueStep): StageEntry<DispatchOrder>[] {
  const at = AT[step];
  const by = BY[step];
  return snap.orders
    .filter((o) => !!at(o))
    .map((o) => ({
      id: o.id,
      stepKey: step,
      orderId: o.id,
      ref: o.orderNo,
      actorId: by(o),
      atIso: at(o)!,
      editedAtIso: o.editedAt,
      editedById: o.editedBy,
      lockReason: lockReasonFor(step, o),
      row: o,
    }));
}

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
